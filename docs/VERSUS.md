# VERSUS — 対戦機能（vs CPU）設計ドキュメント（機能D）

NLH 6-max 100bb キャッシュゲームを、ヒーロー1人 + CPU 5人で対戦する最大の新機能。
本ドキュメントは Sonnet が単独で実装着手できる粒度（状態機械・型・関数シグネチャ・ファイル配置・UIワイヤー・フェーズ分割）まで具体化したもの。

前提:
- `docs/DESIGN.md`（全体方針、§8 デザインシステム、§8.7 共有コンポーネント）を変更しない。
- `src/core/` は React 非依存の純粋TSを維持（テスト容易性・Worker利用のため）。
- 既存 `evaluator.ts`（`evaluate7`）/ `equity.ts`（`computeEquity`）/ `cards.ts` / `handNotation.ts` / `ranges/` / `potOdds.ts` を再利用。
- UI言語は日本語。ポーカー用語（open, 3bet, raise, call, check, fold, bet, all-in, board, pot, range, MDF, equity 等）は英語のまま。

---

## 0. スコープと重要な設計判断（サマリ）

| 論点 | 判断 |
|---|---|
| キャッシュ簡略化 | 各ハンド開始時に全員 100bb にリセット（リング進行はしない）。ポジションはハンドごとにローテーション。 |
| サイドポット | MVPは **単純化**: メインポット + サイドポットを「実効スタック上限」方式で計算するヘルパは持つが、UIでの厳密な複数サイドポット視覚化はしない。最大1段のサイドポットまで正しく分配し、それ以上の多段は「各プレイヤーの拠出額キャップで按分」する汎用アルゴリズムで対応（§D1.6）。 |
| CPUエクイティ計算 | 同期・低反復モンテカルロ（既定 1000〜2000 iterations）を**メインスレッドで**実行（CPU 5人 × 数ストリート程度なら十分軽量）。重い局面（プリフロップのマルチウェイ等）はレンジ近似/ルックアップで回避。Workerは使わない（同期APIが必要なため）。レビュー時のエクイティ（履歴詳細）のみ高反復 + 任意でWorker化可。 |
| GTOレビュー評価 | プリフロップ: 既存RFIレンジと照合（RFI状況のみ厳密判定、それ以外は簡易vs-openレンジで参考判定）。ポストフロップ: ヒーロー vs 相手推定レンジのエクイティ ⇔ ポットオッズ/MDF 比較で「コール/フォールド/ベット」目安。すべて近似であることをUIに明示。 |
| vs-openレンジ追加 | **追加する**（軽量に）。`src/core/ranges/vsOpen.ts` に簡易 call/3bet/fold レンジを5ポジション分。CPUの「つよい」AIとプリフロップレビューの両方で使う。 |

---

## D1. ゲームエンジン（`src/core/game/`）

純粋TSの状態機械。React非依存・全関数テスタブル。

### D1.1 ファイル構成

```
src/core/game/
  types.ts        # ゲーム状態・アクションの型
  deck.ts         # シャッフル/配牌（cards.ts を利用）
  engine.ts       # 状態機械: applyAction / advanceStreet / legalActions など
  pots.ts         # ポット/サイドポット計算・分配
  showdown.ts     # ショーダウン勝者判定（evaluate7 利用）
  engine.test.ts
  pots.test.ts
  showdown.test.ts
```

### D1.2 型定義（`types.ts`）

```ts
import type { Card } from '../cards';
import type { Position } from '../ranges/types';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type PlayerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export type PlayerAction = {
  type: PlayerActionType;
  /** bet/raise/call で「最終的に場に出ているこのプレイヤーの合計ベット額(bb)」ではなく、
   *  追加で支払う額でもなく、"このストリートでのプレイヤーの total commit 目標額"を指す。
   *  実装は engine 側で「目標額 - 既拠出 = 追加支払い」に変換する。call/check/fold は amount 不要。 */
  amount?: number;
};

export type PlayerState = {
  id: number;                 // 0..5。0 = ヒーロー
  isHero: boolean;
  pos: Position;              // このハンドでの席
  stack: number;              // 残りスタック(bb)
  hole: [Card, Card] | null;  // CPUのカードはショーダウンまでUI非公開だが状態には保持
  committedTotal: number;     // ハンド全体での累計拠出(bb)（ポット計算用）
  committedStreet: number;    // 現ストリートでの拠出(bb)
  status: 'active' | 'folded' | 'allin';
  hasActedThisStreet: boolean;
};

export type GameConfig = {
  difficulty: 'easy' | 'normal' | 'hard';
  startingStack: number;      // 既定 100
  sb: number;                 // 0.5
  bb: number;                 // 1
  /** 乱数注入（テスト用）。省略時 Math.random */
  rng?: () => number;
};

export type GameState = {
  config: GameConfig;
  handNumber: number;
  buttonSeat: number;         // BTNのplayer.id。ハンドごとに +1 ローテーション
  players: PlayerState[];     // 長さ6固定。座席順（インデックス=id）
  board: Card[];              // 0,3,4,5枚
  deck: Card[];               // 未配のデッキ（残り）
  street: Street;
  pot: number;                // 確定済みポット（前ストリートまでの拠出合計）
  currentBet: number;         // 現ストリートで「コールに必要な total commit 目標額」
  minRaise: number;           // 次のレイズの最小増分(bb)
  toAct: number | null;       // 次にアクションするplayer.id。null=ストリート終了/ハンド終了
  lastAggressor: number | null;
  log: HandLogEntry[];        // 全アクション記録（履歴/レビュー用）
  result: HandResult | null;  // ハンド終了時にセット
};

export type HandLogEntry = {
  street: Street;
  playerId: number;
  pos: Position;
  action: PlayerActionType;
  amount?: number;            // total commit 目標額（bet/raise/call時）
  potAfter: number;
};

export type HandResult = {
  winners: { playerId: number; amount: number }[];
  /** ショーダウンに到達した場合のみ、公開された各プレイヤーの手 */
  shown: { playerId: number; hole: [Card, Card]; handName: string }[];
  board: Card[];
  endedAtStreet: Street;      // フォールド勝ちなら早いストリート
};
```

### D1.3 アクション意味の確定（重要）

ノーリミットのベッティングを誤実装しないため、`amount` の意味を「**そのストリートでの total commit 目標額**」で統一する:

- `check`: `currentBet === player.committedStreet` のときのみ合法。支払い0。
- `call`: 目標額 = `currentBet`。追加支払い = `min(currentBet - committedStreet, stack)`。足りなければ all-in。
- `bet`: `currentBet === 0`（誰もベットしていない）状況。`amount` = 新しい total commit（= ベット額）。`amount >= bb` 必須、`amount` は `minRaise` 規則に従う。
- `raise`: `currentBet > 0` 状況。`amount` = 新しい total commit 目標額。`amount - currentBet >= minRaise` 必須。
- `allin`: 残りスタック全部を commit。額に応じて bet/raise/call 相当に正規化。

### D1.4 主要関数シグネチャ（`engine.ts`）

```ts
/** 新しいハンドを配る。全員 startingStack にリセットし、buttonSeat をローテーション。 */
export function startHand(prev: GameState | null, config: GameConfig): GameState;

/** 現在 toAct のプレイヤーが取れる合法アクションと、bet/raise の最小・最大額を返す。 */
export type LegalActions = {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;          // 追加支払い額(bb)
  canBet: boolean;
  canRaise: boolean;
  minBetTo: number;            // bet/raise の最小 total-commit 目標額
  maxBetTo: number;            // all-in 上限の total-commit 目標額
};
export function legalActions(state: GameState, playerId: number): LegalActions;

/** アクションを適用して新しい状態を返す（イミュータブル）。不正アクションは throw。 */
export function applyAction(state: GameState, playerId: number, action: PlayerAction): GameState;

/** 現ストリートの全員のアクションが揃ったか判定（内部用、テストでも使えるよう export）。 */
export function isBettingRoundComplete(state: GameState): boolean;

/** ストリートを進める（ボードを配る/ショーダウンへ）。betting round 完了時に呼ぶ。 */
export function advanceStreet(state: GameState): GameState;

/** ショーダウン判定 + ポット分配 + result セット（showdown.ts/pots.ts を呼ぶ）。 */
export function resolveShowdown(state: GameState): GameState;
```

ドライバ（UI or AI ループ）の流れ:
```
state = startHand(prev, config)
while (state.street !== 'showdown' && handNotOver(state)) {
  if (state.toAct === null) state = advanceStreet(state);  // ボード配布 or 終了
  else {
    const a = state.players[state.toAct].isHero ? heroInput : decideCpu(state, state.toAct);
    state = applyAction(state, state.toAct, a);
  }
}
state = resolveShowdown(state); // 必要時
```

エンジンは「次に誰がアクションするか」を `toAct` で1人ずつ提示する純粋関数として実装する。`applyAction` 後に「ストリート完了なら `toAct=null`」をセットし、ドライバが `advanceStreet` を呼ぶ。全員フォールド/オールイン揃いで誰もアクション不要なら `advanceStreet` がランナウト or 即ショーダウンへ進める。

### D1.5 ベッティングラウンド進行ルール

- プリフロップ: SB/BB をブラインド投下（`committedStreet` に反映、`currentBet = bb`）。最初の `toAct` は BB の次（UTG）。
- ポストフロップ: 最初の `toAct` は BTN から見て最初の active プレイヤー（SBから時計回り）。
- ラウンド完了条件: 全 active プレイヤーが `hasActedThisStreet` かつ `committedStreet === currentBet`（または all-in）。レイズが入ったら、それ以降のプレイヤーの `hasActedThisStreet` をリセット（再アクション機会）。
- active が1人になったら即ハンド終了（フォールド勝ち）。
- 全員 all-in/1人を残してアクション不能になったら、残ストリートを一気に配ってショーダウン。

### D1.6 ポット/サイドポット（`pots.ts`）— 簡略化方針を明記

MVPでも**正しく按分**できる汎用アルゴリズムを採用する（実装は素直で軽い）。複雑なのは「視覚化」だけで、計算自体は一般式で対応する。

```ts
export type Pot = { amount: number; eligible: number[] }; // eligible = 取り分け資格のあるplayerId

/**
 * 各プレイヤーの committedTotal から、メイン+サイドポット群を構築する。
 * アルゴリズム（標準）:
 *  1. 拠出額>0 のプレイヤーを committedTotal 昇順に処理。
 *  2. 最小拠出額 t を全該当者から t ずつ取り、その層のポットを作る。eligible = まだ folded でない & 拠出>=t の者。
 *  3. t を引いて残拠出があるプレイヤーで繰り返す。
 * folded プレイヤーの拠出はポット額には入るが eligible には入らない。
 */
export function buildPots(players: PlayerState[]): Pot[];

/** 各ポットを eligible の中の最強手（同点は分割）に分配し、playerId→獲得額 を返す。 */
export function distributePots(pots: Pot[], rankByPlayer: Map<number, number>): Map<number, number>;
```

**簡略化の明示**: 端数（odd chip）はBTN左隣から順、という厳密ルールはMVPでは省略し、分割は均等割り（小数bb許容）でよい。多段サイドポットは上記アルゴリズムで正しく構築されるが、UIでは「メインポット＋（あれば）サイドポット合計」を1〜2行で表示するに留める。

### D1.7 テスト（`game/*.test.ts`）

エンジンの状態機械が最重要テスト対象（DESIGNのテスト方針に準拠）。

- `engine.test.ts`:
  - ブラインド投下後の `currentBet`/`toAct`/各 `committedStreet`。
  - UTGオープン → 全員フォールドでフォールド勝ち、ポットがオープナーへ。
  - check 一巡でストリートが進む。
  - レイズで `hasActedThisStreet` がリセットされ再アクションが回る。
  - all-in 未満スタックの call が正しく all-in 化。
  - `legalActions` の min/max（minRaise 規則、currentBet=0 の bet 下限）。
- `pots.test.ts`:
  - 単純ヘッズアップ分配、3者で1人 all-in のサイドポット、folded 拠出の扱い、引き分け分割。
- `showdown.test.ts`:
  - `evaluate7` 連携で勝者判定（既知ハンド）。

決定性のため全テストで `config.rng` を固定シードの擬似乱数で注入する（`deck.ts` のシャッフルが `rng` を受ける）。

---

## D2. CPU AI（`src/core/ai/`）

純粋TS。`decideCpu(state, playerId): PlayerAction` を返す。難易度3段階。

### D2.1 ファイル構成

```
src/core/ai/
  index.ts          # decideCpu ディスパッチ（difficulty で分岐）
  preflop.ts        # プリフロップ判断（レンジ参照）
  postflop.ts       # ポストフロップ判断（ハンド強度 + 簡易エクイティ）
  handStrength.ts   # ポストフロップのハンド強度分類（made hand / draw 判定）
  estimateEquity.ts # 同期・低反復モンテカルロ（equity.ts ラッパ）
  ai.test.ts
```

### D2.2 ディスパッチ

```ts
export function decideCpu(state: GameState, playerId: number): PlayerAction;
```
- `state.config.difficulty` と `state.street` で分岐。
- 必ず `legalActions(state, playerId)` の範囲内のアクションを返す（不正なら最寄りの合法へクランプ）。
- ベットサイズは preflop/postflop それぞれのサイズ表（下記）から選び、`amount`（total-commit目標額）に変換。

### D2.3 難易度別ポリシー

**やさしい（ルース・パッシブ）**
- プリフロップ: 広いハンド（上位 ~55% 相当、ペア全部 + 任意のAx/Kx/スーテッド/コネクタ）でリンプ/コール。レイズはプレミアム（QQ+, AK）のみ低頻度。フォールドは明確に弱い手のみ。
- ポストフロップ: メイドハンド（ペア以上）なら時々小ベット/コール、ドローはコール寄り、何もなければチェック→ベットされたら大半フォールドだが時々ライトコール。アグレッション低、ブラフほぼなし。
- 実装: ハンド強度のしきい値を緩め、`bet` 確率を低く、`call` を厚く。

**ふつう（素直 / ABC）**
- プリフロップ: 既存 `RFI_SCENARIOS` のレンジに概ね従う。
  - RFIポジション（自分が最初の入場者）: レンジ内なら open（2.5bb / SBは3bb）、外ならfold。
  - 誰かが open 済みで自分がコーラー候補: `vsOpen.ts`（§D4.4）の call レンジ相当でcall、強い手のみ3bet、他fold。
  - BB で limp が回ってきたらチェック。
- ポストフロップ: 強い役（トップペア good kicker 以上）はバリューベット、強いドローは時々セミブラフ、弱ければチェック/フォールド。ポットオッズが合えばドローをコール。ブラフ頻度は低〜中。
- 実装: `handStrength.ts` のカテゴリ + `potOdds()` でコール判断。

**つよい（タイトアグレッシブ + バランス）**
- プリフロップ: レンジ準拠 + `vsOpen.ts` の 3bet/call/fold 簡易レンジを使用。ポジションを考慮（IPで広め）。
- ポストフロップ: `estimateEquity.ts` で「自分 vs 相手の推定レンジ（プリフロップアクションから推定）」のエクイティを低反復MCで概算し、ポットオッズ/MDFと比較。
  - エクイティ高 → バリューベット（サイズはボード/レンジで 1/2〜2/3）。
  - エクイティ中 + 良いドロー → セミブラフ混ぜ。
  - エクイティ低 → チェック/フォールドだが、ブロッカー・ポラライズでブラフを一定頻度（例 25〜35%）で混ぜてバランス。
- 実装: 相手レンジ推定は §D4.4 の推定器を共用。

### D2.4 ハンド強度（`handStrength.ts`）

```ts
export type MadeClass =
  | 'air' | 'weak-pair' | 'mid-pair' | 'top-pair' | 'overpair'
  | 'two-pair' | 'set' | 'straight' | 'flush' | 'full-plus';

export type DrawClass = 'none' | 'gutshot' | 'oesd' | 'flush-draw' | 'combo-draw';

export type HandStrength = {
  made: MadeClass;
  draw: DrawClass;
  /** 0..1 のざっくり強度スコア（しきい値判断用） */
  score: number;
};

/** ホール2枚 + board から強度を分類。evaluate7 とボード解析を併用。 */
export function classifyStrength(hole: [Card, Card], board: Card[]): HandStrength;
```
- made hand は `evaluate7` のカテゴリ + 「ボードと比較したペアの位置（top/mid/weak/overpair）」で判定。
- draw は board と hole の組み合わせからフラッシュドロー/ストレートドローを検出（`potOdds.ts` のアウツ概念を流用してよいが、ここは独自の軽い検出ロジックでOK）。

### D2.5 同期エクイティ（`estimateEquity.ts`）

```ts
/** ヒーローの手 vs 相手レンジ（HandClassの重み付き集合）のエクイティを低反復で概算。
 *  内部で相手のホールを毎試行サンプリングし computeEquity を 2人分で回すのではなく、
 *  軽量版として「相手レンジから1コンボ抽選 → ボードを埋めて勝敗」を iterations 回。 */
export function estimateEquityVsRange(
  hole: [Card, Card],
  board: Card[],
  villainRange: Record<string, number>, // HandClass -> weight
  iterations?: number, // 既定 1000
  rng?: () => number,
): number; // 0..1
```
- `evaluate7` を直接使い、`computeEquity` のオーバーヘッドを避ける軽量ループ。
- マルチウェイ（相手2人以上）の場合は「最も継続レンジが強い1人 vs ヒーロー」近似でよい（MVP）。設計に明示: 多人数ポストフロップは1対1近似。
- 反復1000程度で ±3% 程度の誤差。AI判断には十分。重い局面が体感で重ければ 500 に下げる。

### D2.6 テスト（`ai.test.ts`）

- `decideCpu` が常に合法アクションを返す（ランダム局面を多数生成して `legalActions` 範囲内を確認）。
- 「ふつう」AIがRFIレンジ内のプレミアムで open、ゴミ手で fold すること。
- 例外を投げないこと（フェイルセーフ）。

---

## D3. 対戦UI（`/versus`）

### D3.1 ファイル構成

```
src/pages/Versus.tsx               # 対戦画面（テーブル + アクション）
src/components/versus/
  PokerTable.tsx                   # 6-max テーブル表示（PositionTable を発展）
  SeatView.tsx                     # 1席（名前/スタック/ベット額/カード/状態）
  BoardView.tsx                    # ボード5枚（PlayingCard）
  BetControls.tsx                  # fold/check/call/bet/raise + サイズプリセット
  PotDisplay.tsx                   # ポット表示
src/hooks/useVersusGame.ts         # ゲーム状態の駆動（engine + ai のループをReactに橋渡し）
```

### D3.2 ゲーム駆動フック（`useVersusGame.ts`）

エンジンは純粋関数。Reactとの橋渡しをフックで行う。

```ts
export type VersusController = {
  state: GameState;
  legal: LegalActions | null;          // ヒーローの番なら合法アクション、でなければ null
  isHeroTurn: boolean;
  heroAct: (action: PlayerAction) => void;
  newHand: () => void;
  difficulty: GameConfig['difficulty'];
  setDifficulty: (d: GameConfig['difficulty']) => void;
};
export function useVersusGame(): VersusController;
```

動作:
- 内部 state は `GameState`。`heroAct` で `applyAction` → 以降 `toAct` が CPU の間は `decideCpu`→`applyAction` を**少しずつ遅延実行**（`setTimeout` 300〜600ms）してアニメーションが見えるようにする。
- `toAct === null` になったら `advanceStreet`、`street === 'showdown'` or フォールド終了で `resolveShowdown` → 結果表示。
- ハンド終了時に履歴へ保存（§D4）。`newHand()` で `startHand(prev, config)`。
- CPU処理中はヒーロー入力を無効化（`isHeroTurn=false`）。

### D3.3 テーブルUI ワイヤー

`PositionTable`（既存）の座席配置ロジックを土台に、各席へ情報を載せた `PokerTable` を新設。

```
PageHeader title="対戦 (vs CPU)"
  description="6-max 100bb。CPU5人と対戦してハンドを体で覚える。"
  actions=[ 難易度セレクタ: やさしい/ふつう/つよい ]

┌──────────── PokerTable（楕円フェルト） ────────────┐
│   (HJ)      (CO)                                   │
│ CPU2 98bb  CPU3 100bb                              │
│ (UTG)              [ Board: K♠ 7♦ 2♣ _ _ ]   (BTN)│
│ CPU1 100bb         Pot: 6.5bb               CPU4   │
│                                                    │
│ (BB) CPU5 100bb         (SB=YOU) 99bb              │
│                         [A♠][K♦]  ← ヒーロー手札   │
└────────────────────────────────────────────────────┘
[ BetControls ]  ← ヒーローの番のみ表示
  [Fold] [Check/Call 2bb]  [Bet/Raise: ◯bb]
  サイズプリセット: [1/3][1/2][2/3][Pot][All-in]  + スライダー or 数値
```

- 各 `SeatView`: ポジションラベル、スタック(bb)、現ストリートのベット額チップ、状態（folded=暗転 / allin=バッジ / toAct=パルス枠）、カード（ヒーローは表、CPUは `faceDown`、ショーダウンで公開）。
- ディーラーボタン(D)は `PositionTable` 同様 BTN 席に表示。
- `BoardView`: 5スロット。未配は placeholder。配られたら flip アニメ（DESIGN §8.4）。
- `PotDisplay`: メインポット中央表示（サイドポットがあれば「+side」を小さく付記）。
- 配色・角丸・アニメは DESIGN §8 準拠。`framer-motion` でチップ移動/カードflip。

### D3.4 アクションコントロール（`BetControls.tsx`）

```ts
type BetControlsProps = {
  legal: LegalActions;
  potForSizing: number;       // サイズ計算用の現ポット
  onAction: (action: PlayerAction) => void;
};
```
- ボタン: Fold / Check or Call（`legal.canCheck` ならCheck、`canCall`ならCall + 額表示）/ Bet or Raise。
- サイズプリセット: 1/3, 1/2, 2/3, pot, all-in。プリセット値 = `currentBet + ratio * potAfterCall`（標準のポット比ベット計算）。`minBetTo`/`maxBetTo` でクランプ。
- 数値の最終調整はスライダー or +/- ボタン（任意）。等幅フォントで bb 表示。
- 既存 `ActionButtons` は3アクション固定なのでそのままは使わず、`BetControls` を新設（ただしボタンの見た目クラスは `ActionButtons` の `styles` を踏襲して統一感を出す）。

### D3.5 ナビ + ルート

- `App.tsx`: `{ path: 'versus', element: <Versus /> }`。
- `AppShell.tsx` `NAV` に追加。アイコン `Swords`（lucide）。

---

## D4. ハンド履歴 + GTOレビュー

### D4.1 履歴ストア（`src/store/history.ts` 新設）

進捗ストア（progress.ts）とは別ストアにする（責務分離・サイズ大）。

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HandLogEntry, HandResult, GameConfig } from '../core/game/types';
import type { Card } from '../core/cards';
import type { Position } from '../core/ranges/types';

export type SavedHand = {
  id: string;                 // crypto.randomUUID() or `${ts}-${n}`
  ts: number;                 // 終了時刻
  difficulty: GameConfig['difficulty'];
  heroPos: Position;
  heroHole: [Card, Card];
  board: Card[];
  log: HandLogEntry[];        // 全アクション
  result: HandResult;
  heroNet: number;            // ヒーローの収支(bb)（+/-）
};

type HistoryState = {
  hands: SavedHand[];         // 新しいものが先頭、最大100
  add: (hand: SavedHand) => void;
  clear: () => void;
};

const MAX_HANDS = 100;
```
- `add`: 先頭に挿入し `slice(0, MAX_HANDS)` で古いものを切り捨て。
- `persist` の `name: 'poker-trainer-history'`（progressとは別キー）。
- **マイグレーション/サイズ**: 100ハンド × (log + cards) でも localStorage 数百KB程度。上限超過に備え `add` で try/catch し、`QuotaExceededError` 時は最古を多めに削除して再試行（システム境界のエラーハンドリングとして許容）。`version: 1` を付け将来のスキーマ変更に備える。

### D4.2 履歴ページ（`/versus/history`）

ルート構成（`/versus` 配下のサブルート）:
```
/versus            対戦テーブル
/versus/history    履歴一覧
/versus/history/:id 履歴詳細（レビュー）
```
`App.tsx` で `versus` の children として定義（または Versus 内タブ）。MVPは Versus ページ内に「履歴」タブを置く方式でも可。**推奨: タブ方式**（ナビ項目を増やさない）。

- 一覧（`HistoryList`）: 各 `SavedHand` を行表示。ヒーローpos / ハンド（PlayingCard sm 2枚）/ board要約 / heroNet(色: +emerald / -rose) / 難易度バッジ / 日時。クリックで詳細へ。
- 「履歴をクリア」ボタン（`history.clear`）。

### D4.3 履歴詳細・レビュー画面（`HandReview`）

```ts
// src/core/review/reviewHand.ts （純粋TS）
export type DecisionVerdict = 'good' | 'ok' | 'mistake' | 'info'; // info=判定不能/参考のみ

export type DecisionReview = {
  logIndex: number;           // log 中のヒーローアクションのindex
  street: Street;
  heroAction: PlayerActionType;
  verdict: DecisionVerdict;
  headline: string;           // 「コール妥当」「フォールド推奨」等（日本語）
  detail: string;             // 解説（式・エクイティ・ポットオッズ/MDF）
  metrics?: {                 // ポストフロップ時
    heroEquity?: number;      // 0..1
    potOdds?: number;         // 必要勝率 0..1
    mdf?: number;             // 0..1
  };
};

export function reviewHand(hand: SavedHand): DecisionReview[];
```

レビューロジック（**すべて近似である旨をUIに明示**）:

**プリフロップ**:
- ヒーローが RFI 状況（自分が最初の入場者）→ 既存 `getScenario('RFI_'+pos)` のレンジと照合。
  - レンジ内で raise した → `good`。レンジ外で raise → `mistake`。レンジ内なのにfold → `mistake`（タイトすぎ）。レンジ外でfold → `good`。
- ヒーローが open に直面（vs open）→ `vsOpen.ts`（§D4.4）の簡易レンジで `call`/`3bet`/`fold` の妥当性を `info`〜`good/mistake` で判定。レンジデータが状況に無ければ `verdict='info'` + 「参考情報のみ」。

**ポストフロップ**:
- ヒーローの各意思決定ポイントで、相手の推定レンジ（§D4.4 で プリフロップアクションから推定）に対し `estimateEquityVsRange`（レビューは高反復、例 5000、必要なら `equity.worker.ts` 経由で非同期計算）でヒーローエクイティを算出。
- 直面しているアクションに応じて:
  - ベットに直面（call/fold判断）: `heroEquity >= potOdds` → コール妥当（fold していたら `mistake`寄り、callなら`good`）。逆なら fold 推奨。
  - 自分がベット可能（check/bet判断）: `heroEquity` が高ければベット推奨（バリュー）、低くてもポラライズでブラフ余地は `info` で補足。
  - MDF はヒーローが「守る側」のときの参考値として併記。
- `metrics` に heroEquity / potOdds / mdf を入れUIで表示。

`reviewHand` は同期前提だが、ポストフロップの高反復MCが重い場合は **UI側で非同期**にする: 一覧表示は即時、各decisionのエクイティは `useEquity()`（既存Worker）で順次計算して埋める設計に切り替え可。MVPは反復2000の同期計算で開始し、体感が重ければWorker化（フェーズD4内の調整事項）。

レビューUIワイヤー:
```
PageHeader title="ハンドレビュー"
 [ 近似である旨の注意バナー: これはソルバーではなく一般傾向に基づく目安です ]
┌ リプレイ: ストリートごとにboard + 各アクションを時系列リスト ─┐
│ preflop: BTN open 2.5 / ... / YOU(SB) 3bet 9  ← [good]        │
│ flop K72r: YOU bet 1/2 pot  ← [ok]  equity 71% / MDF ...       │
│ ...                                                            │
└────────────────────────────────────────────────────────────────┘
各ヒーロー判断に DecisionReview を展開（verdict色: good=emerald/ok=cyan/mistake=rose/info=muted）
```

### D4.4 vs-open 簡易レンジ（`src/core/ranges/vsOpen.ts` 新設）

**追加する**（CPU「つよい」AIとプリフロップレビュー双方で必要）。既存 `ranges/types.ts` の `Range`/`HandAction`/`expand.ts` を再利用。

```ts
import type { Position } from './types';

export type VsOpenScenario = {
  id: string;          // 'vsBTN_fromBB'
  label: string;       // 'vs BTN open（あなたBB）'
  heroPos: Position;
  villainPos: Position;// opener
  /** call / raise(=3bet) / 残りfold の混合 or pure。Range は call/raise 頻度を持つ。 */
  range: Range;        // tokensToRange 系で簡易構築（call と raise を分けて指定）
};
export const VSOPEN_SCENARIOS: VsOpenScenario[];
export function getVsOpen(heroPos: Position, villainPos: Position): VsOpenScenario | undefined;
```

データ作成方針（簡易・初心者向け近似、Sonnetが作成）:
- MVPは代表ケースのみ: BB vs BTN open / BB vs CO open / SB vs BTN open / BTN vs CO open（IP 3bet/call）。最低この4つ。
- `tokensToRange` は raise-only しか作れないため、call/3bet を分けるヘルパを `expand.ts` に追加してよい:
  ```ts
  export function tokensToRangeWithActions(spec: { call?: string[]; raise?: string[] }): Range;
  ```
  （call トークンは `{call:1}`、raise トークンは `{raise:1}` を設定。重複時は raise 優先。）
- 3bet レンジ: プレミアム（QQ+, AK）+ 少数のブラフ（A5s-A4s, K9s 等）。call レンジ: ミドルペア・スーテッドブロードウェイ・スーテッドコネクタ等。
- データが無いポジション組合せは `getVsOpen` が `undefined` → レビューは `verdict='info'`「参考情報なし」、CPUは保守的フォールバック（強い手のみcall/3bet）。

`src/core/ranges/index.ts` の `ALL_SCENARIOS` には混ぜず、`VSOPEN_SCENARIOS` を別 export する（context が異なるため）。`RangeContext` 型に `'vsOpen'` を追加してよい（types.ts の1行追加、既存利用に影響なし）。

### D4.5 テスト
- `pots`/`engine`/`showdown` は §D1.7。
- `ai.test.ts` は §D2.6。
- `reviewHand` のテスト（`review/reviewHand.test.ts`）: 合成 `SavedHand` を入力し、明確なケース（レンジ内open→good、ゴミ手open→mistake、エクイティ高でのbet→good、potOdds割れでのcall→mistake）で期待 verdict が出ること。MCのゆらぎを避けるため、エクイティ依存テストは極端なケース（ナッツ vs 明確に負け）か `rng` 固定で行う。

---

## D5. フェーズ分割（Sonnet向け作業計画）

各フェーズ末で `npm run build` と `npm run test` が通り、独立にビルド/テスト可能。

- **D1 — ゲームエンジン + テスト**: `src/core/game/`（types/deck/engine/pots/showdown）+ 各テスト。UIなし。テキストドライバ（テスト内）で1ハンドを最後まで進められること。これが土台で最重要。
- **D2 — CPU AI + テスト**: `src/core/ai/` + `vsOpen.ts` + `expand.ts` の `tokensToRangeWithActions`。`decideCpu` が常に合法手を返す。エンジン上でCPU6人（ヒーロー席も自動）の自動対戦が完走することをテストで確認。
- **D3 — 対戦UI**: `useVersusGame` フック + `Versus.tsx` + `components/versus/*`。難易度選択。ヒーローが実際に1ハンドプレイできる。ナビ/ルート追加。
- **D4 — 履歴 + GTOレビュー**: `store/history.ts`、ハンド終了時保存、履歴タブ一覧、`review/reviewHand.ts` + レビュー詳細UI。近似明示バナー。
  - D4 内の調整: レビューエクイティの同期/Worker化、反復回数チューニング。

依存順: D1 → D2 → D3、D4 は D1（log/result）と既存 equity に依存（D3 と並行着手も可だが UI 完成後が自然）。

---

## D6. ナビゲーション再編（DRILLS-V2 と統合した最終案）

機能C（CB）と機能D（対戦）でナビが増える。フラット8項目は窮屈なので **グルーピング** を提案する。
`AppShell.tsx` の `NAV` をセクション付き構造に拡張（実装は軽微: セクション見出し行を挟む or 配列を2グループに分割してサイドバーで区切り線を入れる。モバイル下部タブは主要5つに絞り、残りは「その他」 or ホーム集約）。

```
学習（ドリル）
  ホーム / レンジ訓練 / エクイティ / オッズ & MDF / CB / クイズ
プレイ
  対戦 (vs CPU)        ← /versus（履歴は対戦ページ内タブ）
```

- デスクトップ サイドバー: 上記2セクションを小見出し（`text-[10px] uppercase tracking-widest text-muted`）で区切る。
- モバイル下部タブ: 5枠に収めるため `[ホーム, レンジ, オッズ&MDF, クイズ, 対戦]` を主要タブにし、エクイティ/CB はホームのクイックリンク or 「その他」シートに。最終UIはD3実装時に確定（本ドキュメントの推奨で着手）。
- アイコン: 対戦=`Swords`、CB=`Target`（DRILLS-V2 §C.6 と一致）。
- `NAV` 定義の重複を避けるため、`AppShell.tsx` 内の単一の `NAV`（必要ならセクション配列）を真実の源とする。DRILLS-V2 とこの章で同一の最終形にすること。
