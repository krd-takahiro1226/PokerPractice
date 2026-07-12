# GTOソルバー機能 設計ドキュメント

対象: 対戦機能（CPU対戦・セッション・オンライン）で保存されたハンド履歴の各ヒーロー判断を、
プリフロップ〜リバーまで **GTO（サブゲーム均衡解）** でレビューする機能。

ステータス: 設計確定（実装前）。実装は本ドキュメントのフェーズ順に行う。

## 0. 方針（v2 改訂の要点）

**主目的は「完全GTOに可能な限り近い解析」であり、近似アドバイザーの作り込みではない。**

- 解析の主軸は **CFR+ による HU サブゲーム厳密解**（river → turn）と、
  **ソルバー出力由来の事前計算データ**（プリフロップチャート・flop プリソルブDB）。
- 旧計画にあった「既存機能の組み合わせによる近似層の強化」
  （board texture ベースの頻度近似・簡易EVモデル・equity realization 係数・hand bucket 判定則・
  population heuristic チャネル・vs3bet ヒューリスティック）は**作成しない**。
- 既存の `reviewHand.ts`（レンジ照合 + equity/ポットオッズ）は**現状のまま凍結**し、
  GTO が原理的に扱えないスポット（マルチウェイ等）の「参考表示」としてのみ流用する。
  新規の開発投資はしない。
- GTOでも難しいが**必要**なもの（サブゲーム入力レンジのモデリング、マルチウェイの扱い、
  可変スタックへの対応）は、作成予定として残し §5.5 / §6 で扱う。

---

## 1. GTO実現可能性の境界 — 何を「作れる」のか

### 1.1 「GTO」の正確な定義と原理的限界

GTO = ナッシュ均衡戦略。NLHE のゲーム全体（6人・プリフロップ〜リバー）の均衡は状態数が
天文学的で未解決。**商用ソルバー（PioSOLVER / GTO Wizard / MonkerSolver）が「GTO」として
提供しているものの実体**は:

1. プリフロップ: サーバークラスタで抽象化付き均衡計算した**チャート**（事前計算データ）
2. ポストフロップ: 「両者レンジを固定し、ベットサイズを数種類に離散化した **HU サブゲーム**」の CFR 均衡

つまり業界標準の「GTO」自体が3つの妥協の上に成立している:

| 妥協 | 内容 | 本アプリへの含意 |
|---|---|---|
| レンジ仮定 | サブゲーム解は到達時点の両者レンジを入力として初めて定義される。入力がずれれば解もずれる（GIGO） | レンジ入力モデル（§5.5）を仮定として明示すれば、商用ソルバーと**同種の解**になる |
| サイズ離散化 | 連続サイズは解けない。2〜4種に離散化 | 業界標準の妥協。木構築時に離散化（§5.2） |
| HU 限定 | 3人以上では CFR のナッシュ均衡収束保証が消え、均衡選択問題も生じる。商用ソルバーもポストフロップは実質 HU 専用 | **マルチウェイは誰にも解けない**。GTO非対応と明示（§6） |

この3つを受け入れれば、**本物のサブゲーム厳密解はブラウザで計算可能**。実例として Rust 製 OSS
ソルバーを WASM 化しブラウザ内で HU flop〜river を解くプロジェクトが実用レベルで存在する。

### 1.2 実現可能性マトリクス（= 本設計で作るもの）

| スポット | 真のGTO | 手段 | 計算コスト | 解の品質保証 |
|---|---|---|---|---|
| HU river | ◎ | **自前 CFR+（純粋TS・Worker）** §5.2 | 1判断 <1秒 | exploitability を計測・表示 |
| HU turn（turn+river 木） | ○ | 自前 CFR+ 拡張 §5.3 | 数秒〜数十秒（進捗表示） | 同上 |
| HU flop（3ストリート木） | △ | (a) オフライン事前計算DB（主） (b) OSS WASM 統合（オプション） §5.4 | (a) lookup のみ (b) 数十秒〜分 + GB級メモリ | 同上 |
| プリフロップ（2〜6人） | ○（データとして） | 自前計算は不可（クラスタ級）。**ソルバー出力由来チャート**を取り込む §5.6 | lookup のみ | 出典に依存 |
| マルチウェイ（3人以上）ポストフロップ | ×（原理的限界） | GTO非対応と表示。既存レビューを参考表示として流用（新規開発なし） | — | なし（参考明示） |
| リンプポット等のレアライン | △ | 入力レンジ推定が粗く GIGO | — | confidence='low' |

### 1.3 到達レベルのラダー

| レベル | 内容 | 対応フェーズ | UI 表記 |
|---|---|---|---|
| **L1** | **HU river の厳密サブゲーム解**（自前 CFR+） | Phase 3〜4 | 「GTO解（HU・レンジ仮定付き）」 |
| **L2** | HU turn の厳密解 | Phase 5 | 同上 |
| **L2.5** | プリフロップのソルバー由来チャート（RFI/vsOpen/vs3bet/squeeze/4bet） | Phase 6 | 「GTOレンジ」 |
| **L3** | HU flop（プリソルブDB主体、WASM 深掘りオプション） | Phase 7 | 「GTOプリソルブ」 |
| 上限 | マルチウェイ・全ゲーム均衡 | 恒久的に対象外 | 「GTO非対応（参考表示）」 |

実戦でレビュー価値が高い「大きなポットの turn/river の call/fold/raise」は HU に集中するため、
**L1〜L2 の時点で『ソルバーでレビューできるアプリ』になる**。L1 を最初に作る理由:

1. 木が最小で、解析解が既知のトイゲームと突き合わせて自前実装を検証できる。
2. river は将来ストリートが無く、サブゲーム解の理論的な曖昧さが最も小さい。
3. turn（L2）は river ソルバーを部品として再利用でき、投資が無駄にならない。
4. flop を事前計算DBに逃がすことで「アプリ内で解くのは小さい木だけ」という性能特性を守れる。

---

## 2. 推奨アーキテクチャ

```
[復元層]  src/core/review/snapshot.ts
             SavedHand → DecisionSnapshot[]（各ヒーロー判断時点の盤面復元）
                │
[解析層]  src/core/solver/…（純粋TS・React/Supabase非依存・文言を持たない）
             DecisionSnapshot → StrategyAdvice
             ├ cfr/        : CFR+ サブゲームソルバー（L1/L2 の本体）
             ├ ranges.ts   : サブゲーム入力レンジの構築（レンジ仮定）
             ├ preflop.ts  : チャート lookup（頻度そのまま出力）
             └ presolve.ts : (L3) プリソルブDB lookup
                │
[表示層]  src/core/review/reviewHand.ts ほか
             StrategyAdvice → DecisionReview（verdict・日本語文言）
             GTO非対応スポットのみ既存ロジック（凍結）で参考表示
```

- **復元**はエンジン仕様（total-commit 会計）に結合した独立問題で、エンジンをオラクルにテストできる。
- **解析**は source（cfr-exact / presolve / range-table）ごとに実装が差し替わる。文言・verdict 閾値を持たせない。
- **表示**は言葉選びと verdict 変換のみ。解析の精度向上で壊れない。

### ファイル構成（最終形）

```
src/core/review/
  snapshot.ts        # SavedHand → DecisionSnapshot[]（リプレイ復元）
  reviewHand.ts      # 既存API維持。GTO対応スポットは solver 経由、非対応は既存ロジック（凍結）
  explain.ts         # explanationKey → 日本語文言
src/core/solver/
  types.ts           # SpotQuery / ActionCandidate / StrategyAdvice / Analyzer
  index.ts           # analyzeHand オーケストレーション（スポット → source 振り分け）
  ranges.ts          # サブゲーム入力レンジ構築（プリフロップチャート + ライン絞り込み）
  preflop.ts         # チャート lookup
  cfr/
    tree.ts          # ゲーム木構築（サイズ離散化・raise cap）
    cfr.ts           # vector CFR+ 本体
    terminal.ts      # ソート + prefix sum の終端評価
    exploit.ts       # best response / exploitability 計測
    river.ts         # L1: snapshot → river サブゲーム解
    turn.ts          # L2: turn+river 木
  presolve.ts        # L3: プリソルブDB lookup
src/workers/
  solver.worker.ts   # analyzeHand を Worker で実行（equity.worker.ts と同型）
src/hooks/
  useHandAnalysis.ts # Worker クライアント。loading/cached/failed 状態
src/store/
  analysis.ts        # handId + analyzerVersion キーの解析結果キャッシュ
data/
  presolve/          # (L3) canonical flop × 構成別のルート戦略 JSON
```

作らないもの（旧計画から削除）: `solver/ev.ts`（簡易EV）、`solver/texture.ts`（テクスチャ頻度近似）、
`solver/postflop.ts`（heuristic ポストフロップ解析）、`estimateEquity` の rng 注入改修。

---

## 3. データモデル案

### 3.1 判断: スナップショット保存ではなく「最小入力の追加保存 + リプレイ復元」

**`DecisionSnapshot` は保存しない。** ログ + 開始条件から決定的に復元できるため。
保存すると復元バグがデータに焼き付き、localStorage（`MAX_HANDS=100`）の quota リスクも上げる。
復元不能な情報**だけ**を保存する。

### 3.2 `SavedHand` v3 拡張

```ts
// src/store/history.ts
export type SavedHand = {
  // ---- 既存（変更なし）----
  id: string; ts: number; mode: GameMode;
  difficulty: GameConfig['difficulty'];
  heroPos: Position; heroHole: [Card, Card];
  board: Card[]; log: HandLogEntry[];
  result: HandResult; heroNet: number;
  // ---- v3 追加（すべて optional: 旧データ互換）----
  version?: number;                              // v3以降は 3
  stacks?: number[];                             // ハンド開始時の各席スタック(bb)。index = player.id
  blinds?: { sb: number; bb: number; ante: number };
  buttonSeat?: number;                           // BTN の player.id
  playerCount?: number;
};
```

- 書き込みは `useVersusGame.ts` / `useVersusSession.ts` の保存箇所のみ（ハンド開始時の `GameState` から写す）。
- zustand persist の version 2→3。migrate は no-op（新フィールドは optional）。
- Supabase `versus_hands.payload`（jsonb）は追加フィールド互換。

### 3.3 旧データ（v2 以前）のフォールバック

| 情報 | v3 | v2 以前のフォールバック |
|---|---|---|
| 人数・ポジション・BTN | 保存値 | ログの `playerId × pos` から復元（プリフロップは全員必ず1回アクションする） |
| 開始スタック | 保存値 | 全席 100bb と仮定し `reliability='approx'` に降格 |
| sb/bb/ante | 保存値 | 0.5 / 1 / (mode==='tournament' ? 1 : 0) と仮定 |

`reliability='approx'` のハンドは confidence を1段階下げ、UI に「概算（旧データのためスタック復元は仮定値）」と表示。

### 3.4 `DecisionSnapshot`（復元結果。保存しない・都度計算）

```ts
// src/core/review/snapshot.ts
export type DecisionSnapshot = {
  logIndex: number;
  street: Street;
  actor: { playerId: number; pos: Position; isHero: boolean };
  board: Card[];                 // 判断時点で見えているボード
  potBefore: number;             // アクター視点のポット（自分の今回分を含まない）
  toCall: number;                // コールに必要な追加支払い額(bb)。0 = check可
  legal: LegalActions;           // short all-in 非再オープンも反映
  players: {
    playerId: number; pos: Position; stack: number;
    committedStreet: number; committedTotal: number;
    status: 'active' | 'folded' | 'allin';
  }[];
  effectiveStack: number;        // hero stack と生存相手の最大スタックの小さい方
  spr: number | null;
  actionHistory: HandLogEntry[]; // log.slice(0, logIndex)
  context: {
    openerPos?: Position;
    lastAggressorId?: number;
    heroHasInitiative: boolean;
    villainIds: number[];
    isMultiway: boolean;         // villainIds.length >= 2 → GTO非対応の振り分けに使う
    facingBet?: { amount: number; potRatio: number; from: Position };
  };
  taken: {
    action: PlayerActionType;
    amountTo?: number;           // total-commit（log の amount）
    additional?: number;
    potRatio?: number;
  };
  reliability: 'exact' | 'approx';
};
```

復元の実装方針:

- **エンジンを呼ばずに**、log の total-commit 会計を積算する軽量リプレイヤーを書く
  （`applyAction` は deck/hole/乱数と結合しており写す方が単純・安全）。
- 各ログ適用後に `computedPot === entry.potAfter` を**アサート**。不一致は例外にせず
  `reliability='approx'` へ降格（データ破損・エンジン仕様変更の検出網）。
- ante は pot 初期値、SB/BB は preflop の committedStreet 初期値として先に積む（engine と同じ扱い）。
- 正しさは「実エンジンで seed 固定ハンドを走らせ、各判断直前の `GameState` と突合」する
  オラクルテストで担保（§8）。

### 3.5 解析出力型

```ts
// src/core/solver/types.ts
export type Confidence = 'high' | 'medium' | 'low';

export type ActionCandidate = {
  action: PlayerActionType;
  sizeTo?: number;             // bet/raise の total-commit
  sizePotRatio?: number;
  frequency: number;           // 均衡頻度 0..1（候補合計 ~1）
  evBB?: number;               // 均衡EV(bb)。CFR/presolve では厳密値
  explanationKeys: string[];
};

export type StrategyAdvice = {
  spot: SpotQuery;                    // §3.6
  candidates: ActionCandidate[];      // frequency 降順
  takenCandidate: ActionCandidate | null; // 実アクションの最近傍マッチ（サイズは pot比）
  evLossBB?: number;                  // best.evBB - taken.evBB
  confidence: Confidence;
  source: 'cfr-exact' | 'presolve' | 'range-table' | 'legacy';
  /** cfr-exact のみ: 解の誤差（% of pot）と仮定レンジ（UI開示用） */
  solution?: {
    exploitabilityPctPot: number;
    heroRange: RangeAssumption;
    villainRange: RangeAssumption;
    iterations: number;
  };
};
```

verdict（good/ok/mistake/info）は表示層が決める:

| 条件 | verdict |
|---|---|
| taken の均衡頻度 >= 0.6、または evLossBB <= 0.15 | good |
| 均衡頻度 0.2〜0.6（混合スポット）、または evLossBB <= 0.75 | ok |
| 均衡頻度 < 0.2 かつ evLossBB > 0.75 | mistake |
| source='legacy'（GTO非対応スポット） | info（参考表示） |

閾値は表示層の定数として一元管理。

### 3.6 SpotQuery 署名（プリソルブDBのキー。Phase 3 で凍結）

```ts
export type SpotQuery = {
  street: Street;
  players: number;              // 生存者数
  potType: 'srp' | '3bp' | '4bp' | 'limped';
  heroPos: Position; villainPos?: Position;   // HU のみ
  ip: boolean;
  line: string;                 // 現ストリートの正規化アクション列 例 'x-b66'
  sprBucket: 'le1' | '1to3' | '3to6' | 'gt6';
  flopIso?: string;             // canonical flop キー（同型除去後）例 'AhKs7d' 正規形
  handClass: HandClass;
};
```

flop の同型除去（スート同型で 1,755 枚に正規化する canonical 化関数）を `types.ts` に実装し
テストで凍結する。**後から署名を変えるとプリソルブDBが無効になる**ため、L3 より前（Phase 3）に確定する。

### 3.7 オンライン対戦の秘匿

- 保存してよいのは: 自分の hole、公開ボード、公開アクションログ、`result.shown`（公開済み hole のみ）。
  **deck・非公開 hole は絶対に保存・送信しない**（現状の型にも無い。今後も追加しない）。
- 解析は保存済みデータ + レンジ**仮定**のみで動くため、追加の秘匿情報は不要。
  解析キャッシュ（`store/analysis.ts`）にも実カード以外の推定値しか入らない。

---

## 4. UI案（`Versus.tsx` / `HandReviewPanel` の拡張）

### 4.1 構成

```
[サマリーカード]  ← 新規
   総合: good 4 / ok 2 / mistake 1     EVロス合計: -2.3bb（GTO解対象の判断のみ）
   重要ミス: 「ターン: フォールド推奨のコール (-1.8bb)」 ← タップでその判断へ
[ヒーローハンド + ボード + 収支]（既存）
[ストリートごとのアクション一覧]（既存の枠を維持）
   各ヒーロー行に verdict バッジ + source チップ（GTO解 / GTOレンジ / 参考）
   ヒーロー行タップで展開 → [判断詳細]:
      ┌ 均衡頻度バー: ████████░░ Bet 75% 65% | Check 25% | (実アクションに ▼)
      ├ あなた: Call 6.5bb → GTO: Raise 18bb (62%) / Call (31%) / Fold (7%)
      ├ EV差: -0.4bb（均衡EV比）
      ├ 解の誤差: 0.3% pot   仮定レンジ: [表示]  ← cfr-exact のみ
      └ なぜ: explanationKeys からの短文
[GTO非対応の判断]（マルチウェイ等）
   「この判断はマルチウェイのためGTO解析非対応です」+ 既存レビューを参考として表示
```

### 4.2 非同期状態（`useHandAnalysis`）

| 状態 | 表示 |
|---|---|
| `loading` | バッジ位置にスケルトン + 「解析中…」。プリフロップのチャート lookup は軽いため即時表示（二段階） |
| `done` / `cached` | 全表示（キャッシュヒット時は即時） |
| `failed` | 「解析に失敗しました」+ 再試行。チャート由来の結果は残す |
| turn 解析（L2） | 進捗バー（CFR 反復の進捗を Worker から postMessage） |

### 4.3 「GTO」表記ルール

判断ごとに `source` で出し分ける。**「GTO」を名乗る条件 = 厳密解またはソルバー出力由来、
かつレンジ仮定を開示していること**（商用ソルバーと同じ誠実さの水準）:

| source | バッジ | 補足 |
|---|---|---|
| `cfr-exact` | **GTO解**（HU・レンジ仮定付き） | 解の誤差 + 仮定レンジの閲覧 |
| `presolve` | GTOプリソルブ | オフライン計算の構成を明記 |
| `range-table` | GTOレンジ / レンジ表 | ソルバー由来チャートか手動チャート（yokosawa等）かで出し分け |
| `legacy` | 参考（GTO非対応） | 既存の近似である旨を明示 |

既存の近似バナーは「どの判断が近似か」を per-decision チップに委譲する形で文言を更新して維持。

---

## 5. ソルバー設計

### 5.1 スポット振り分け（`solver/index.ts`）

```
DecisionSnapshot
  ├ street=preflop                     → preflop.ts（チャート lookup）
  ├ postflop & HU & river              → cfr/river.ts   (L1)
  ├ postflop & HU & turn               → cfr/turn.ts    (L2。未実装時は presolve → legacy)
  ├ postflop & HU & flop               → presolve.ts    (L3。ヒットしなければ legacy)
  └ postflop & multiway                → legacy（既存 reviewHand ロジック。参考表示）
```

### 5.2 L1: river CFR+ ソルバー（`cfr/`）— 本設計の中核

- **ゲーム木**: ヒーローの判断時点を root に、check / bet {33%, 75%, all-in} /
  raise（1回 cap、all-in 含む）で構築。ノード数 20〜40。snapshot の `legal` / `potBefore` /
  `effectiveStack` から生成。サイズセットは定数化し将来調整可能に。
- **入力レンジ**: §5.5 のレンジ入力モデルでコンボ展開（`expand.ts`）+ ボードとの
  カードリムーバル後、重み付き combos（各 100〜500）にする。
- **vector CFR+**: 全コンボ一括の regret matching+。反復ごとに木を1回走査。
- **終端評価の高速化（必須）**: showdown 終端の素朴な O(H×V) を避け、両者コンボを
  ハンド強度でソートし **prefix sum で O(H+V)** にする。強度は river ボード固定なので
  `evaluator.ts` で事前計算してソートキャッシュ。カードリムーバル重複（同一カード共有ペア）は
  ランク別補正項で処理する定石を使う。
- **収束**: CFR+ は river 級の木なら 200〜1000 反復で exploitability < 0.5% pot。
  Worker 上で 1判断 <1秒。
- **exploitability（`exploit.ts`）**: 両側 best response を計算し解の誤差を毎回計測。
  閾値超過（収束失敗）時は結果を出さず legacy にフォールバック（誤った「GTO解」を出さない）。
- **出力**: ヒーロー実ハンドの均衡頻度・各アクション均衡EV(bb)・exploitability。
  `source='cfr-exact'`、confidence='high'（reliability='approx' なら 'medium'）。

### 5.3 L2: turn 拡張（`cfr/turn.ts`）

river 木の葉に chance node（river カード 44〜46 枚）をぶら下げた2ストリート木。
計算量は river の約46倍 + 深さ増で、TS のまま数秒〜数十秒。戦略配列は combos × nodes × river枚数で
数十MB に収まる。Worker + 進捗表示で成立。**必要なら CFR 本体のみ Rust/WASM 化して数倍高速化**
（アーキテクチャ・型は不変。最適化はプロファイリング後に判断）。

### 5.4 L3: flop 対応

自前 TS は chance node 47×46 で非現実的。2経路:

- **(a) オフライン事前計算DB（主経路・採用）**: 使用ツールは **TexasSolver console 版
  （`bupticybee/TexasSolver`, AGPL-3.0）をローカルビルド**して用いる（2026-07-10 確定・§10 未決3 解消）。
  canonical flop（1,755 枚）× 主要 SRP/3bp 構成の **flop ストリート全意思決定ノード戦略**を
  flop 単位でシャーディングした JSON として同梱。169 ハンドクラス × 数アクション ×
  1,755 flop × 数構成 ≈ 圧縮後数MB。flop の cbet / vs cbet 判断をカバー。
  **同梱するのは生成した出力データのみ**であり、AGPL はアプリ本体に伝播しない
  （生成物はツールのライセンス対象外）。パイプライン仕様は §12.2、lookup 仕様は §12.3。
- **(b) WASM ソルバー統合（オプション経路）**: 「このスポットを深く解析」ボタンでユーザーが
  明示起動する重い解析。マルチスレッド WASM は SharedArrayBuffer が必要 → Vercel で
  COOP/COEP ヘッダ設定。GB 級メモリのためモバイル無効。OSS のライセンス（AGPL ならソース公開義務）
  を統合前に確認。

### 5.5 サブゲーム入力レンジのモデリング（`solver/ranges.ts`）— 難しいが必要な機能

サブゲーム解の質は入力レンジで決まる（GIGO）。商用ソルバーはこれをユーザー入力に委ねるが、
本アプリは自動レビューのため自前で構築する。**これは「解」ではなく「仮定」であり、UI で開示する**:

- **プリフロップ起点**: 両者のプリフロップレンジはチャート（custom 反映）から。
  既存 `estimatePlayerRange` を流用・拡張。
- **ライン絞り込み（MVP）**: flop/turn のアクションで単純な規則により絞る
  （例: bet/raise した側はレンジ上位パーセンタイル + ドロー系を残す等の明示的な規則。
  規則は `RangeAssumption` として解に添付し UI から閲覧可能にする）。
- **将来（整合的絞り込み）**: L3 のプリソルブDBが入ると「flop 均衡戦略でレンジを更新 →
  turn を解く」という**ソルバー整合的なレンジ連鎖**に置き換え可能。ranges.ts の interface は
  この差し替えを見込んで「(snapshot, street) → 両者レンジ + 根拠」に固定する。
- リンプポット等チャート外のラインは confidence='low' を伝播。

### 5.6 プリフロップ（`solver/preflop.ts`）

- チャート lookup のみ。既存 `HandAction`（raise/call/fold 頻度）をそのまま
  `ActionCandidate.frequency` に写す。ヒューリスティックは実装しない。
- **ソルバー由来チャートの新設（Phase 6）**: RFI / vsOpen に加え、現状データが無い
  **vs3bet / squeeze / vs4bet** をソルバー出力由来のデータ系列として追加する。
  2026-07-10 調査（§10 未決2 解消）の結論として、**「ソルバー出力由来」と証明でき、かつ
  再配布可能な公開プリフロップチャートは現存しない**。したがって Phase 6 は
  **データ系列インフラ + 検証付き取り込みパイプラインを実装し、初期同梱データは空**とする。
  vs3bet / vs4bet はデータ確保まで `legacy` 継続（squeeze のみ vsOpen 近似で暫定表示。§12.1）。
- `yokosawa.ts` は ground truth として**変更せず**別系列のまま共存（mode で切り替え）。
  ソルバー由来チャート（`rangeOrigin='solver'`）のみ「GTOレンジ」を名乗り、手動チャートは
  「レンジ表」表記に留める（§4.3 の規定に表示層実装を合わせる。詳細 §12.1）。
- チャートは 100bb 前提。セッション対戦の可変スタック（40bb 未満等）では confidence を下げ、
  スタック帯別チャートは将来のデータ拡張とする。

---

## 6. GTO非対応スポットの扱い（フォールバック仕様）

| スポット | 扱い |
|---|---|
| マルチウェイポストフロップ | `source='legacy'`。既存 `reviewHand` のロジック（凍結）で参考表示。「マルチウェイはGTO解析非対応（理論的限界）」と明示。verdict は info 固定（good/mistake を断定しない） |
| HU flop（L3 導入前 / DB ミス） | 同上 |
| vs3bet 以降（チャート導入前） | 同上 |
| リンプポット等レアライン | CFR は回すが confidence='low' + レンジ仮定の注記 |

既存ロジックへの機能追加・精度改善は行わない。削除もしない（フォールバックとして必要なため）。

---

## 7. 実装フェーズ

各フェーズは独立してマージ可能・既存機能無影響。

### Phase 1 — 復元基盤（破壊的変更ゼロ）
- `SavedHand` v3（optional フィールド）+ persist version 3（migrate no-op）
- `useVersusGame.ts` / `useVersusSession.ts` の保存箇所で v3 フィールドを書く
- `src/core/review/snapshot.ts`: `buildSnapshots(hand): DecisionSnapshot[]`
- エンジンオラクルテスト + potAfter チェックサム + 旧データフォールバック（§8.1）
- `reviewHand.ts` は一切触らない

### Phase 2 — analyzer 骨格（出力互換維持）
- `solver/types.ts`（StrategyAdvice / SpotQuery / canonical flop 正規化 + 署名凍結テスト）
- `solver/index.ts`（スポット振り分け）+ `preflop.ts`（既存チャート lookup 化）
- 既存 reviewHand のポストフロップ判定を `source='legacy'` として振り分け配下に移す
- `reviewHand.ts` をアダプタ化。**既存 `reviewHand.test.ts` を無変更でグリーン**に保つ

### Phase 3 — river CFR+ コア（L1・純粋関数）
- `solver/ranges.ts`（入力レンジ構築 MVP: プリフロップ起点 + 規則ベース絞り込み + RangeAssumption）
- `cfr/tree.ts` / `cfr.ts` / `terminal.ts` / `exploit.ts` / `river.ts`
- トイゲーム解析解テスト（AKQ / clairvoyance）+ exploitability 収束テスト（§8.2）
- この時点では同期関数として完成させる（UI 接続は Phase 4）

### Phase 4 — Worker・キャッシュ・UI（L1 を出荷）
- `solver.worker.ts` + `useHandAnalysis.ts` + `store/analysis.ts`
- `HandReviewPanel` 拡張: サマリー・均衡頻度バー・EV差・source チップ・レンジ仮定閲覧・非同期状態
- レビューUIを `components/versus/review/` に切り出し（`Versus.tsx` 肥大対策）

### Phase 5 — turn 拡張（L2）
- `cfr/turn.ts`（chance node 展開）+ 進捗表示 + 端末性能による opt-in
- プロファイリングの上、必要なら CFR 本体の WASM 化を判断

### Phase 6 — プリフロップのソルバー由来チャート（L2.5）

**確定方針（2026-07-10）: 初期同梱データは空。インフラ + 検証付き取り込みパイプラインを実装する。**
実装仕様の全文は **§12.1**。着手前に §5.6 / §12.1 / §4.3 を参照。要点:

- `src/core/ranges/solverSeries.ts` 新設: `SolverRangeKey`（テンプレートリテラル型）/
  `SolverChartData` / `getSolverRange` / `validateSolverChartData`。初期 `charts.json` は空 tables。
- 取り込み CLI `scripts/solver-ranges/import.mjs`: 入力を validate し出典 meta 必須で書き込む。
- `solver/types.ts` の `StrategyAdvice` に `rangeOrigin?: 'solver' | 'manual'` を追加（range-table 時のみ）。
- `solver/preflop.ts` スポット分類拡張: vs3bet / squeeze / vs4bet。lookup 優先順は
  ソルバー系列 → 既存 mode チャート → legacy。系列が無ければ従来挙動を厳密に維持。
- `solver/ranges.ts` の基底レンジは役割判定できればソルバー系列を優先（`ai/villainRange.ts` は不変更）。
- 表示層 `components/versus/review/logic.ts` の sourceChipLabel を `rangeOrigin` で出し分け。
- `yokosawa.ts` は不変更。mode/系列切り替えで共存。
- **変更しないファイル**: `yokosawa.ts` / `reviewHand.ts` / `solver/index.ts` / `ai/villainRange.ts`。

### Phase 7 — flop プリソルブDB / 深掘りオプション（L3）

**確定方針（2026-07-10）: オフライン計算ツールは TexasSolver console 版（AGPL-3.0）をローカルビルド。**
実装仕様の全文は **§12.2（パイプライン）/ §12.3（lookup）/ §12.4（データ形式）**。要点:

- オフライン一括計算パイプライン `scripts/presolve/`（`npx tsx` 実行、tsx を devDependency 追加、
  `src/core` の canonicalFlop / チャートを直接 import）。スターター構成は SRP BTN(IP) vs BB(OOP)。
- データは **flop 単位シャーディング** `public/presolve/<config>/<flopIso>.json` + `meta.json`。
- `solver/presolve.ts`: fetcher 注入式。`preloadPresolve`（async ロード）→ `lookupPresolve`（同期）。
  構成マッチ + line トークン単位マッチ（サイズ近傍許容）。ミスは null → legacy。
- `solver/index.ts` の HU flop 分岐で presolve lookup（ロード済みキャッシュのみ参照）。
  `solver.worker.ts` は analyzeHand 前に `preloadPresolve` を await。
- スターターDB: 代表テクスチャ約12枚を同梱。フル 1,755 枚は resume 可能バッチで夜間実行（README）。
- **スコープ外（明記）**: WASM 深掘りオプション、Edge Function 版 Analyzer
  （ゲスト動作は Worker 版で成立するため MVP では不要）。

### 分担（CLAUDE.md ポリシー）
- Phase 1 の snapshot.ts、Phase 3 の CFR 本体（`cfr.ts` / `terminal.ts`）: 会計・アルゴリズムの中核で
  バグが全解析に波及するため **Fable5 直接実装**を推奨
- Phase 2 / 4 / 5 の周辺実装・UI: 本ドキュメント添付で **Sonnet 委譲**（`delegate` SKILL）
- `src/core/` 変更後は各フェーズ完了時に `sync-core` SKILL を実行

---

## 8. テスト戦略（Vitest）

### 8.1 復元層: エンジンをオラクルにしたリプレイ検証（Phase 1）

```
1. seed 固定 rng で startHand + スクリプト化した applyAction 列を実行
2. 各ヒーロー判断の直前に GameState から期待値を記録
   （pot合計, toCall=legalActions().callAmount, 各席 stack/status, board, legal）
3. SavedHand を組み立て buildSnapshots() に通し、全フィールド突合
```

シナリオ（it.each）: 6-max 標準 / limped / 3bet・4bet・squeeze / short all-in（canRaise=false 再現）/
複数 all-in + side pot / multiway river 到達 / HU（n=2 のポジション・先手順）/ ante あり /
旧 v2 データ（100bb 仮定 + 'approx'）/ potAfter 不一致の破損データ（例外にせず降格）。

### 8.2 CFR 層（Phase 3・全て純粋関数テスト）

- **解析解との一致**: AKQ ゲーム・clairvoyance game 等、均衡が手計算できるトイゲームで
  頻度・EV の一致を assert（自前 CFR 実装の正しさの根拠）。
- **exploitability 収束**: 実スポット数種で規定反復後に閾値未満へ収束すること。
- **支配戦略の検算**: ナッツで fold 頻度 0、必要勝率を大きく下回る call がベスト候補にならない等、
  自明な性質のみ assert。**均衡頻度の数値スナップショットは書かない**（サイズセット変更で壊れるため）。
- **終端評価**: ソート + prefix sum の結果が素朴 O(H×V) 実装と一致するプロパティテスト
  （素朴実装はテスト内にのみ置く）。
- **カードリムーバル**: ブロッカーを含む小さなレンジ対で手計算と一致。

### 8.3 署名・互換・分離

- **SpotQuery 署名の凍結テスト**（Phase 2）: canonical flop 正規化の安定性。DB 世代を守る。
- **Phase 2 のゲート**: 既存 `reviewHand.test.ts`（396行）を無変更でグリーン。
- **Worker**: プロトコル薄皮はテスト不要（equity.worker.ts と同基準）。`useHandAnalysis` は
  Analyzer モック注入で loading/done/failed/cached 遷移をテスト。
- **UI**: サマリー集計（EVロス合計・重要ミス抽出）は純粋関数化してテスト（`Review.logic.test.ts` パターン）。

---

## 9. ファイル別変更表

| ファイル | 変更内容 | 理由 | リスク |
|---|---|---|---|
| `src/store/history.ts` | `SavedHand` v3 optional フィールド + persist version 3 | effective stack 復元に必須 | 低。optional のみ・jsonb 互換 |
| `src/hooks/useVersusGame.ts` | 保存時に stacks/blinds/buttonSeat/playerCount 付与 | v3 書き込み | 低 |
| `src/hooks/useVersusSession.ts` | 同上（可変スタックのため特に必須） | 同上 | 低 |
| `src/core/review/snapshot.ts` | **新規**: total-commit 会計リプレイヤー | 全解析の土台 | 中 → オラクルテストで担保 |
| `src/core/solver/types.ts` | **新規**: StrategyAdvice / SpotQuery / canonical flop 正規化 | 差し替え可能な解析 interface + DB キー凍結 | 低 |
| `src/core/solver/index.ts` | **新規**: スポット振り分け | HU/multiway・street 別の source 決定 | 低 |
| `src/core/solver/preflop.ts` | **新規**: チャート lookup | プリフロップ頻度出力 | 低 |
| `src/core/solver/ranges.ts` | **新規**: サブゲーム入力レンジ + RangeAssumption | CFR の入力（レンジ仮定の一元管理） | 中。仮定を UI 開示で緩和 |
| `src/core/solver/cfr/*` | **新規**: vector CFR+ / 終端評価 / exploitability / river / turn | **本設計の中核**（真のGTO） | 中〜高 → トイゲーム解析解 + exploitability 常時計測で担保 |
| `src/core/solver/presolve.ts` | **新規**(Phase 7): プリソルブDB lookup | flop の GTO 化 | 低 |
| `src/core/review/reviewHand.ts` | アダプタ化（公開シグネチャ不変）。既存ロジックは legacy として凍結 | 表示層への縮退 + フォールバック | 中 → 既存テスト無変更グリーンで担保 |
| `src/core/review/explain.ts` | **新規**: explanationKey → 日本語文言 | 文言とロジックの分離 | 低 |
| `src/workers/solver.worker.ts` | **新規**: analyzeHand の Worker 化 | メインスレッド解放 | 低。equity.worker.ts と同型 |
| `src/hooks/useHandAnalysis.ts` | **新規**: Worker クライアント + 状態管理 | UI の非同期状態 | 低 |
| `src/store/analysis.ts` | **新規**: handId+analyzerVersion キャッシュ | 再表示の即時化・再計算防止 | 低 |
| `src/pages/Versus.tsx` + `components/versus/review/*` | レビューUI切り出し + サマリー/頻度バー/source チップ | UI 要件 + 1009行の肥大対策 | 中 |
| `data/presolve/*` | **新規**(Phase 7): canonical flop 戦略 JSON | flop GTO データ | 低 |
| `supabase/functions/_shared/core/*` | `sync:functions` で追随（自動生成） | core 同期規約 | 低。`sync-core` SKILL で漏れ検知 |
| `docs/DESIGN.md` | 本機能への参照追記 | ドキュメント整合 | 低 |

変更しないもの: `engine.ts`（オラクル利用のみ）、`yokosawa.ts`（ground truth・変更禁止）、
`estimateEquity.ts` / `villainRange.ts`（legacy 用に現状凍結。ranges.ts は別実装）、
オンライン対戦のサーバーロジック。

---

## 10. リスクと未決事項

### リスク

| リスク | 影響 | 緩和策 |
|---|---|---|
| snapshot 会計のバグ | 全解析が誤る | エンジンオラクルテスト + potAfter チェックサム + 不一致時の降格 |
| CFR 実装バグ（収束するが誤答） | 「GTO解」表示で誤推奨 | トイゲーム解析解テスト + exploitability 常時計測（閾値超過は legacy へフォールバック） |
| 入力レンジ仮定の粗さ（GIGO） | 厳密解でも前提が崩れる | RangeAssumption の UI 開示 + custom ranges 反映 + レアライン confidence 降格 + 将来のソルバー整合的絞り込み（§5.5） |
| SpotQuery 署名の後方非互換変更 | プリソルブDB 無効化 | Phase 2 で凍結テスト。変更時は analyzerVersion で世代管理 |
| turn 解析の重さ（低スペック端末） | 数十秒待ち・メモリ圧 | 端末性能検出で opt-in + 進捗表示 + キャッシュ + 必要時のみ WASM 化 |
| OSS ソルバーのライセンス（AGPL 等） | ソース公開義務 | **主経路はオフライン生成データ**（出力データはライセンス対象外）。WASM 統合時のみ要精査 |
| マルチスレッド WASM の配信要件 | COOP/COEP の副作用 | オプション経路に限定。導入時に Vercel ヘッダ検証 |
| ソルバー由来プリフロップチャートの出典 | 「GTOレンジ」を名乗る根拠 | 出典確保まで該当スポットは legacy 扱い。yokosawa.ts と系列分離 |
| localStorage quota | 履歴消失 | v3 増分は数十バイト/ハンド。解析キャッシュはメモリ主体 |

### 未決事項（実装を止めないもの）

1. **river の raise cap・サイズセット**（{33%, 75%, all-in} + raise 1回で開始し、実測で調整）。
2. ~~プリフロップのソルバー由来チャートの出典~~ **【解消 2026-07-10】**:
   調査の結果、「ソルバー出力由来」と証明でき、かつ再配布可能な公開プリフロップチャートは
   **現存しない**。GitHub 上の MIT チャート集（例: `tyloo/poker-range-analyzer`=RFI のみ・出典不明、
   `davidt35/preflop_charts`=全スポットあるが出典不明）は §4.3 の「GTOレンジ」基準を満たさず、
   名乗れるのは「レンジ表」まで。OSS の 6-max プリフロップソルバー `exinori/DCFR-SOLVER`
   （MIT, Rust, MCCFR）は存在するが 1 コミット・ポストフロップモデル未文書化で品質根拠にできない
   （将来の自前生成候補として §12.1 に記録のみ）。→ Phase 6 は空データ + 取り込みパイプラインで確定。
3. ~~Phase 7 のオフライン計算環境~~ **【解消 2026-07-10】**:
   **TexasSolver console 版（`bupticybee/TexasSolver`, AGPL-3.0）をローカルビルドして使用**。
   同梱は生成出力データのみで AGPL はアプリ本体に非伝播。ビルド手順・構成・精度目標は §12.2。
4. **解析キャッシュの永続化**: メモリで足りるか。永続化するなら analyzerVersion で無効化。
5. **オンライン対戦ハンドの保存経路の確認**: v3 フィールド付与は公開情報のみで構成できるため設計上の障害はない。
6. **可変スタック（セッション）でのチャート精度**: 100bb 前提チャートの適用範囲と confidence 規則。

---

## 11. 最初に着手すべき最小PR（Phase 1 の中身）

**PR タイトル案: 「GTOレビュー基盤: SavedHand v3 と DecisionSnapshot 復元」**

含めるもの（UI 変更ゼロ・既存挙動不変）:

1. `src/store/history.ts` — `SavedHand` v3 optional フィールド + persist version 3（migrate 素通し）
2. `useVersusGame.ts` / `useVersusSession.ts` — 開始スタック等を控えて保存時に `version: 3` とともに付与
3. `src/core/review/snapshot.ts` — `buildSnapshots()`、potAfter チェックサム、v2 フォールバック
4. `src/core/review/snapshot.test.ts` — §8.1 のオラクルテスト一式
5. `npm run sync:functions` 実行と `precommit` SKILL 通過

除外: solver ディレクトリ、reviewHand 変更、UI 変更、Worker。

このPRのあと、Phase 2（振り分け骨格）→ Phase 3（river CFR+）と進み、
**Phase 4 完了時点で「HU river の判断に本物のGTO解が付くレビュー」が出荷される。**

---

## 12. 実装仕様付録（Phase 6 / 7 — Sonnet 実装着手粒度）

本節は Phase 6 / 7 を単独で実装着手できる粒度に落とした確定仕様。2026-07-10 の調査
（§10 未決2・3 解消）に基づく。**§3.5 / §3.6 の型・署名は不変**（`SpotQuery` の直列化形式・
`spotQueryKey` は変更しない。presolve の lookup は raw キー完全一致ではなく §12.3 の構造化マッチ）。

### 12.1 Phase 6: ソルバー由来チャート系列

**前提（調査結論・変更禁止）**: 再配布可能かつ「ソルバー出力由来」と証明できる公開プリフロップ
チャートは現存しない（§10 未決2）。よって **初期同梱データは空**とし、インフラと検証付き取り込み
パイプラインのみを実装する。将来の自前生成候補として `exinori/DCFR-SOLVER`（MIT, Rust, MCCFR。
1 コミット・ポストフロップモデル未文書化のため現時点では品質根拠にできない）を記録する。

#### 12.1.1 新モジュール `src/core/ranges/solverSeries.ts`

```ts
// pos は既存 Position 型（'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB' 等）を使う
export type SolverRangeKey =
  | `RFI_${Position}`
  | `VSOPEN_${Position}_${Position}`     // <opener>_<hero>
  | `VS3BET_${Position}_${Position}`     // <hero>_<threebettor>
  | `SQUEEZE_${Position}_${Position}`    // <opener>_<hero>
  | `VS4BET_${Position}_${Position}`;    // <hero>_<fourbettor>

export type SolverChartMeta = {
  source: string;        // 出典（必須。'none' は空データを表す）
  method: string;        // 例 'MCCFR' / 'imported'
  generatedAt: string;   // ISO8601
  stackBB: number;       // 通常 100
  license?: string;
  note?: string;
};

export type SolverChartData = {
  meta: SolverChartMeta;
  tables: Partial<Record<SolverRangeKey, Range>>;  // Range は既存レンジ型
};

// src/data/solverRanges/charts.json を静的 import。
// 初期値: { meta: { source: 'none', method: 'none', generatedAt: <build>, stackBB: 100 }, tables: {} }
export function getSolverRange(
  key: SolverRangeKey,
): { range: Range; meta: SolverChartMeta } | undefined;

// エラー一覧を返す（空配列 = 妥当）。検出項目:
//  - meta.source 欠落 / meta 必須フィールド欠落
//  - 未知の SolverRangeKey 形式
//  - table 内の未知 handClass（169 の canonical 表記外）
//  - 各 handClass の頻度合計 > 1 + ε（ε=1e-6）や負値
export function validateSolverChartData(data: SolverChartData): string[];
```

- `Range` / `Position` / `HandClass` / 頻度表現は既存 `src/core/` の型を再利用（新規型を増やさない）。
- `charts.json` は `src/data/solverRanges/charts.json`。ビルド時に静的 import できる純 JSON。

#### 12.1.2 取り込み CLI `scripts/solver-ranges/import.mjs`

- 入力 JSON（`SolverChartData` 形状）を受け取り `validateSolverChartData` で検証。
- **`meta.source` 未指定・`'none'` は拒否**（出典 meta 必須）。エラーがあれば非ゼロ終了し書き込まない。
- 妥当なら `src/data/solverRanges/charts.json` を上書き。既存 tables とのマージ方針は「入力を正」とし、
  同一 `SolverRangeKey` は上書き（部分投入を許可）。
- 実行例と入力フォーマットを `scripts/solver-ranges/README.md`（任意）または CLI の usage に記載。

#### 12.1.3 `StrategyAdvice` への `rangeOrigin` 追加（§3.5 の拡張）

`src/core/solver/types.ts` の `StrategyAdvice` に **optional フィールドを1つ追加**する（既存署名互換）:

```ts
  /** source==='range-table' のときのみ設定。チャート由来の区別 */
  rangeOrigin?: 'solver' | 'manual';
```

`source` の enum は不変（`'range-table'` のまま）。`rangeOrigin` は表記出し分け（§4.3）専用。

#### 12.1.4 `solver/preflop.ts` スポット分類拡張

既存の rfi / vsOpen 判定ロジックは**不変**（回帰させない）。以下を追加する。判定は
`DecisionSnapshot.actionHistory` から抽出した preflop の raise 列（`priorRaises`）で行う:

| スポット | 検出条件 | 系列キー | 系列に無い場合 |
|---|---|---|---|
| vs3bet | `priorRaises.length===2` かつ 1本目=ヒーロー、2本目=他者かつ非 all-in | `VS3BET_<heroPos>_<3bettorPos>` | **legacy**（現状維持・info 表示） |
| squeeze | vsOpen 条件 + オープンとヒーロー判断の間に**非オープナーのコールが1つ以上** | `SQUEEZE_<openerPos>_<heroPos>` | **従来通り vsOpen チャートで近似**（現行挙動維持）。confidence を `'medium'` に降格し `explanationKey` `'preflop-squeeze-approx'` を付す |
| vs4bet | `priorRaises.length===3` かつ 2本目=ヒーロー（=ヒーローが 3bettor）、3本目=他者かつ非 all-in | `VS4BET_<heroPos>_<4bettorPos>` | **legacy**（現状維持） |

**lookup 優先順（統一規則）**:

1. ソルバー系列（`getSolverRange`）にヒット → 使用。`source='range-table'`, `rangeOrigin='solver'`。
2. 既存 mode チャート（RFI / vsOpen / squeeze 近似のみ。custom ranges を反映）→ 使用。
   `source='range-table'`, `rangeOrigin='manual'`。
3. いずれも無し → `source='legacy'`（info 表示）。

- vs3bet / vs4bet は初期データが空のため実質 2→（該当チャート無し）→ 3 の legacy に落ちる。
- squeeze は系列が無ければ 2 の近似（vsOpen チャート + confidence 降格）に落ちる。

#### 12.1.5 `solver/ranges.ts`（サブゲーム入力レンジ）

- `buildFor`（サブゲーム入力レンジ構築）の**基底レンジ**について、オープナー / vsOpen 応答者の役割が
  判定できる場合は **ソルバー系列の該当テーブルを優先**する:
  - オープナー役 → 該当 `RFI_<pos>` の raise 部分。
  - vsOpen 応答者役 → 該当 `VSOPEN_<opener>_<hero>` の call / raise 部分。
- 系列に無ければ従来の `estimatePlayerRange` にフォールバック（挙動不変）。
- `RangeAssumption`（§5.5）の `label` / `note` に「系列由来（solver）である旨」を記載し UI 開示。
- **`ai/villainRange.ts` は変更しない**（legacy 用に凍結）。

#### 12.1.6 表示層（§4.3 への実装追随）

- `src/components/versus/review/logic.ts` の `sourceChipLabel` を `rangeOrigin` で出し分ける:
  - `rangeOrigin==='solver'` → 「GTOレンジ」
  - `rangeOrigin==='manual'`（および未定義）→ 「レンジ表」
- `HandReviewPanel` の凡例文言もこの区別に追随させる。
- `src/core/review/explain.ts` に新キー `'preflop-squeeze-approx'`（近似の旨の短文）を追加。
  必要に応じ vs3bet/vs4bet legacy 時の参考表示キーも既存 legacy 文言を流用（新規開発しない）。

#### 12.1.7 テスト（Phase 6）

- `solverSeries.test.ts`: `validateSolverChartData` の各エラー検出（頻度合計 >1+ε、未知 handClass、
  `meta.source` 欠落、未知キー形式）。空データ `charts.json` の `getSolverRange` が undefined。
- `preflop` 分類テスト（合成ログ）: vs3bet / squeeze / vs4bet の検出条件が正しく発火すること。
- 系列有無での lookup フォールバック: 系列注入時 `rangeOrigin='solver'`、非注入時に vs3bet/vs4bet が
  legacy、squeeze が vsOpen 近似 + confidence 降格になること。
- `rangeOrigin` チップ: `sourceChipLabel` の出し分け（純粋関数テスト）。
- **既存 `reviewHand.test.ts` は無変更でグリーン維持**（ゲート）。

#### 12.1.8 変更しないファイル（Phase 6）

`yokosawa.ts` / `reviewHand.ts` / `solver/index.ts` / `ai/villainRange.ts`。

### 12.2 Phase 7: flop プリソルブ生成パイプライン `scripts/presolve/`

- 実行は `npx tsx`。**tsx を devDependency に追加**。`src/core` の canonicalFlop / チャートを
  直接 import し、正規化・レンジ生成を重複実装しない。
- TexasSolver console 版（`bupticybee/TexasSolver`, AGPL-3.0）をローカルビルドして呼び出す。
  ビルド手順（clone + cmake で `console_solver`）は `scripts/presolve/README.md` に記載。
  **ビルド成果物・クローンはリポジトリ外**（例 `~/tools`）に置く。

#### 12.2.1 スターター構成 `configs/srp-btn-bb.ts`

| 項目 | 値 |
|---|---|
| ポットタイプ | SRP（single raised pot） |
| プレイヤー | BTN オープナー = IP / BB コーラー = OOP（2人） |
| ゲーム | cash-noante 100bb |
| pot | 5.5bb |
| eff スタック | 97.5bb |
| sprBucket | `'gt6'` |
| 入力レンジ | 既存チャートから生成: BTN の `RFI` raise 部分 / BB の vsOpen **call** 部分。`meta` に記録 |
| ベットツリー | bet `{33%, 75%}`、raise は 1 回 + all-in、**donk 無効** |
| 精度目標 | exploitability 0.5% pot |

#### 12.2.2 バッチ実行 `run-batch.ts`

- **resume 可能**: 既に出力済みの flop はスキップし未処理 flop のみ処理。
- 各 flop について: TexasSolver 入力 txt 生成 → console 実行 → output JSON をパース →
  コンボ戦略を **169 handClass に重み集計** → `public/presolve/srp-btn-bb/<flopIso>.json` へ書き出し。
- `public/presolve/srp-btn-bb/meta.json` を生成: 構成 / 入力レンジ / ツリー / ツール名・コミット /
  精度 / 処理済み flop 一覧。
- スターターDB として代表テクスチャの canonical flop **約12枚**を実ソルブして同梱。
  フル 1,755 枚は resume 可能バッチとしてユーザーが夜間実行する運用を README に記載。

### 12.3 Phase 7: `src/core/solver/presolve.ts`（lookup）

- **fetcher 注入式**（Worker では `fetch('/presolve/…')`、テストでは fs 読み）。
- `preloadPresolve(snapshots, ctx): Promise<void>`: 対象ハンドで必要な flop ファイルをメモリ
  キャッシュへロード（該当 flop 分のみ。1ハンドの解析で必要なのは1 flop 分）。
- `lookupPresolve(snapshot, spotQuery): StrategyAdvice | null`: **同期**（`analyzeSnapshot` の同期性維持）。
  ロード済みキャッシュのみ参照。

**構成マッチ（§3.6 との関係: raw キー完全一致ではなく構造化マッチ）**:

- `potType` / `players===2` / 両者ポジション / `sprBucket` / `flopIso` が一致すること。
- `line` 解決は **トークン単位**で行い、bet / raise の pct は**最近傍サイズへ許容誤差内
  （相対 40% 以内）**でマッチさせる。
- **完全一致** → `confidence='high'`。**近似一致（サイズ丸め）** → `confidence='medium'` +
  `explanationKey='presolve-size-approx'`。`reliability==='approx'` のハンドはさらに一段階降格。
- マッチ無し → `null`（呼び出し側で legacy へフォールバック）。
- 出力: `source='presolve'`。`frequency` のみ設定（`evBB` は **MVP では未設定**）。

**組み込み**:

- `src/core/solver/index.ts`: HU flop 分岐で `lookupPresolve` を試行（ロード済みキャッシュのみ参照。
  ヒットしなければ従来通り legacy）。
- `src/workers/solver.worker.ts`: `analyzeHand` の前に `preloadPresolve` を await。

### 12.4 Phase 7: データ形式（flop 単位シャーディング）

```jsonc
// public/presolve/<config>/<flopIso>.json
{
  "v": 1,
  "flop": "Ah Ks 7d",              // canonical 表記
  "nodes": {
    // line は既存 currentStreetLine 形式（'' / 'x' / 'x-b33' / 'x-b33-r…' 等）
    "": {
      "actor": "oop",              // 'oop' | 'ip'
      "actions": ["x", "b33", "b75"],
      "strat": {                   // Record<HandClass, number[]>（actions と同順・同長）
        "AhAd": [0.10, 0.20, 0.70]
        // … 169 handClass
      }
    }
    // flop ストリートの全意思決定ノード（深さ 3 トークンまで）を格納
  }
}
```

- 頻度は**小数3桁丸め**。`meta.json` は §12.2.2 の内容。
- 1ハンドの解析で必要なのは1 flop 分のみ → flop 単位シャーディングでロードを最小化。

### 12.5 Phase 7 スコープ外（明記）

- WASM 深掘りオプション（§5.4(b)）。
- Supabase Edge Function 版 Analyzer（ゲスト動作は Worker 版で成立するため MVP 不要）。
