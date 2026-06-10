# DRILLS-V2 — 設計ドキュメント（機能A・B・C）

NLH 6-max 100bb 練習アプリの追加ドリル3種の実装設計。
本ドキュメントは Sonnet が単独で実装着手できる粒度（型・関数シグネチャ・ファイル配置・UIワイヤー・フェーズ分割）まで具体化したもの。
`docs/DESIGN.md`（全体方針・デザインシステム §8・既存コンポーネント §8.7）を前提とし、それを変更しない。

- 機能A: ポットオッズ「必要勝率」計算ドリル（既存 `/pot-odds` にタブ追加）
- 機能B: MDF計算ドリル（同 `/pot-odds` にタブ追加）
- 機能C: フロップCBクイズ（新ページ `/cbet`）

UI言語は日本語。ポーカー用語（pot odds, MDF, CB, range, open 等）は英語のまま。
既存のデザインシステムと共有コンポーネント（`PageHeader` / `Panel` / `Button` / `FeedbackBanner` / `StatBadge` / `PlayingCard` / `PositionTable`）を最大限再利用する。

---

## 0. 共通事項

### 0.1 既存コンポーネントの再利用（変更しないこと）

| コンポーネント | シグネチャ要点 | 用途 |
|---|---|---|
| `PageHeader` | `{ title, description?, actions? }` | ページ見出し |
| `Panel` | `{ title?, subtitle?, className?, children }` | ガラスカード |
| `Button` | `ButtonHTMLAttributes & { variant?: 'primary'\|'ghost'\|...; size?: 'sm'\|'md'\|'lg' }` | 「次の問題」等 |
| `FeedbackBanner` | `{ correct: boolean; title: string; children? }` | 正誤+解説 |
| `StatBadge` | `{ label; value; hint?; accent?: 'accent'\|'gold'\|'muted'\|'call'\|...; className? }` | 正答率/連続正解/問題数 |
| `PlayingCard` | `{ card?: Card\|null; size?: 'sm'\|'md'\|'lg'; faceDown?; selected?; onClick?; className? }` | ボード表示 |
| `PositionTable` | `{ hero: Position; highlightVillain?: Position[]; className? }` | 6-maxの席図 |

4択UIは既存 `Quiz.tsx`（59–81行目）のボタンパターンをそのまま踏襲する。共通化したくなったら `src/components/ChoiceList.tsx` を新設してよいが、MVPでは各ページ内にローカル実装で十分（DESIGN「3行の重複より早期の抽象化を嫌う」）。

### 0.2 タブUI

`/pot-odds` は3タブになる。既存 `RangeTrainer.tsx`（40–53行目）のタブUIをそのままコピーして使う（pill型トグル、`bg-accent text-[#04221a]` がアクティブ）。本ドキュメント §A.4 にタブの抽出方針を記載。

### 0.3 進捗ストア（`src/store/progress.ts`）の拡張

既存 `DrillStats` / `bump()` / `accuracy()` を再利用する。新ドリルごとに `DrillStats` キーを追加する。

```ts
// ProgressState に追加するフィールド
reqEquity: DrillStats;   // 機能A: 必要勝率
mdf: DrillStats;         // 機能B: MDF
cbet: DrillStats;        // 機能C: フロップCB

// 追加する record アクション
recordReqEquity: (correct: boolean) => void;
recordMdf: (correct: boolean) => void;
recordCbet: (correct: boolean) => void;
```

実装は既存 `recordPotOdds` と同形（`set((s) => ({ reqEquity: bump(s.reqEquity, correct) }))`）。
`emptyStats()` で初期化し、`reset()` にも追加する。

**マイグレーション方針**: zustand `persist` の `name: 'poker-trainer-progress'` は据え置く。新キーは「保存済みJSONに存在しない」状態になるため、`persist` の `merge` がデフォルトで shallow merge する点に注意。安全のため以下のいずれかを行う:

- 推奨: `persist` に `version: 1` と `migrate(persisted, version)` を追加し、未定義キーを `emptyStats()` で埋める。
- もしくはストア初期値で全キーを定義し、`partialize` を使わず全体保存にしておけば、`merge` 時に「初期state ∪ 永続state」で欠損キーは初期値が残る（zustandの `persist` は `{ ...initialState, ...persistedState }` 相当の浅いマージを行うため、トップレベルキーは初期値で補完される）。MVPはこちらで可。

`AppShell.tsx` の `OverallStat`（36–51行目）は range/potOdds/quiz のみ集計している。総合正答率に新ドリルも含めるか判断: **含める**。`reqEquity`/`mdf`/`cbet` も加算するよう `OverallStat` を更新する（4行の加算追加のみ）。

### 0.4 出題生成ユーティリティ

既存 `src/lib/random.ts` の `pick` / `randInt` / `shuffle` を使う。新規の純粋計算は `src/core/` に置き、React非依存を維持する。

---

## 機能A: ポットオッズ「必要勝率」計算ドリル

### A.1 概要

既存 `/pot-odds` に「必要勝率」タブを追加。プレイヤーに「ポット◯◯、相手ベット◯◯。コールに必要な勝率は？」を4択で問う。正解後に式と計算過程を解説表示する。

### A.2 core ロジック（`src/core/potOdds.ts` に追記）

`potOdds(pot, toCall)` は既存（必要勝率 = toCall / (pot + toCall)）。ここに**ドリル生成と誤答生成**を追加する。

```ts
// src/core/potOdds.ts に追記

export type ReqEquityDrill = {
  pot: number;       // コール前のポット額（相手ベットは含まない）
  bet: number;       // 相手のベット額 = toCall
  answer: number;    // 正解の必要勝率 0..1
  choices: number[]; // 4択（answer を含む、shuffle 済み想定。値は 0..1）
};

/**
 * 必要勝率ドリルを1問生成する。
 * pot/bet は 10 刻みの「きれいな数字」。必要勝率が割り切れやすい/にくいを混ぜる。
 */
export function genReqEquityDrill(rng?: () => number): ReqEquityDrill;

/**
 * 典型的な計算ミス由来の誤答を生成し、正解と合わせて 4 つ（重複排除済み）返す。
 * - distractorBetOverPot:  bet / pot
 * - distractorBetOverPotPlus2Bet: pot / (pot + 2*bet)   ← potとbetの取り違え系
 * - distractorBetOverPot2: bet / (pot + bet*2)
 * いずれも answer と十分に異なる（差 >= 0.02）ものだけ採用し、足りなければ
 * answer ± {5,8,12}% のダミーで補完する。
 */
export function reqEquityChoices(pot: number, bet: number, rng?: () => number): number[];
```

実装ガイド:

- `genReqEquityDrill`:
  - `pot = randInt(...) * 10`、`bet` も10刻み。比率パターンを混ぜるため、約半分は「ベット = ポットの 1/2 or 1/3 or full or 2x」になるよう `bet` を `pot` から導出（割り切れる=やさしい）。残り半分は `bet` を独立に10刻みで引く（割り切れない=むずかしい）。
  - `answer = potOdds(pot, bet)`。
  - `choices = reqEquityChoices(pot, bet)` を `shuffle`。
- `reqEquityChoices`: 上記の典型ミス式を計算 → `answer` 含めて4つになるよう調整。すべて 0..1 にクランプ。
- 表示は `(x*100).toFixed(1)%`。選択肢の数値は重複しないこと（`Math.round(x*1000)` で同値判定）。

**テスト（`potOdds.test.ts` に追記）**:
- `potOdds(100,50) === 1/3`（既存範囲だが確認）。
- `genReqEquityDrill` を多数回呼び、`choices.length === 4` / `choices` に `answer` を含む / 全要素が `0..1` / 重複なし。
- `reqEquityChoices(80, 40)` が `0.333…`（=40/120）を含むこと。

### A.3 ページUI（`src/pages/PotOdds.tsx` を改修）

3タブ構成に変更。タブ: 「ドロー判断」(既存) / 「必要勝率」(新規) / 「MDF」(機能B)。

ワイヤー（必要勝率タブ）— 既存ドロー判断タブのレイアウトを踏襲:

```
PageHeader（§A.4 で全タブ共通文言に更新）
[ タブ: ドロー判断 | 必要勝率 | MDF ]
grid lg:[1fr_300px]
┌── Panel ────────────────────────┐  ┌── 右カラム ──────┐
│  シナリオカード:                 │  │ StatBadge×3       │
│   ポット 80    相手ベット 40     │  │ (正答率/連続/問数)│
│  「コールに必要な勝率は？」       │  │ Panel「考え方」   │
│  [ 33.3% ][ 50.0% ]              │  │  ・必要勝率の式   │
│  [ 25.0% ][ 40.0% ]   ← 4択      │  └──────────────────┘
│  （回答後）FeedbackBanner:        │
│    必要勝率 = 40 / (80+40)        │
│            = 40 / 120 = 33.3%     │
│  [ 次の問題 ]                     │
└──────────────────────────────────┘
```

- シナリオカードは既存ドロー判断タブの「ポット/相手ベット」表示（PotOdds.tsx 64–86行目）を流用。
- 4択は `Quiz.tsx` のボタンパターン（選択後に正解=accent、誤答=danger でハイライト）。
- 解説（FeedbackBanner children）に式と計算過程を明示:
  `必要勝率 = コール額 ÷ (ポット + コール額) = 40 ÷ (80 + 40) = 40 ÷ 120 = 33.3%`
- 回答時に `recordReqEquity(correct)` を呼ぶ。

### A.4 ページタイトル/タブの更新

`PageHeader` を3タブ包含の文言に更新:
- title: `ポットオッズ & MDF`
- description: `コール判断・必要勝率・MDF（最低守備頻度）をまとめて練習。`

ナビ（`AppShell.tsx` の `NAV`、`/versus.md` 側のナビ再編とも整合させる §共通参照）:
- ラベル `ポットオッズ` → `オッズ & MDF`（アイコンは `Coins` 据え置き）。

`PotOdds.tsx` は親コンポーネントでタブ state を持ち、3つの子ビュー（`DrawView`=既存ロジックを関数抽出, `ReqEquityView`, `MdfView`）を出し分ける構成にリファクタする。既存ドロー判断ロジック（30–139行目）はそのまま `DrawView` に移動するだけ。

---

## 機能B: MDF計算ドリル

### B.1 概要

同 `/pot-odds` の「MDF」タブ。「ポット 100、相手が 100 ベット。あなたのレンジの最低何%を守るべき？(MDF)」を4択で問う。

### B.2 core ロジック（`src/core/potOdds.ts` に追記）

```ts
/**
 * Minimum Defense Frequency. 相手のベットに対し、フォールドしてよい上限を
 * 超えないために守るべきレンジの最低割合。
 * MDF = pot / (pot + bet)。返り値 0..1。
 */
export function mdf(pot: number, bet: number): number;

export type MdfDrill = {
  pot: number;
  bet: number;
  answer: number;     // mdf(pot, bet)
  choices: number[];  // 4択 0..1, shuffle済み
};

export function genMdfDrill(rng?: () => number): MdfDrill;

/**
 * MDF用の誤答。典型ミス:
 * - bet / (pot + bet)   ← これは「相手にとっての必要勝率/降ろし率」= 1 - MDF（最頻ミス）
 * - bet / pot
 * - pot / (pot + 2*bet)
 * answer 含め4つ・重複排除・0..1クランプ。
 */
export function mdfChoices(pot: number, bet: number, rng?: () => number): number[];
```

実装ガイド:
- `mdf(pot, bet)` = `pot / (pot + bet)`（`bet <= 0` のときは `1` を返す＝守備不要のフォールド余地なし、ガード）。
- `genMdfDrill`: ベットサイズは代表値（pot比 1/3, 1/2, 2/3, full, 2x）を主に出題し、解説の代表値表と一致させると学習効果が高い。`pot` は10刻み、`bet = round(pot * ratio /10)*10` で導出。
- 代表値: 1/3pot→75%, 1/2pot→67%, 2/3pot→60%, pot→50%, 2x pot→33%。

**テスト（`potOdds.test.ts`）**:
- `mdf(100,100) === 0.5`、`mdf(100,50)` ≈ `0.6667`、`mdf(100,200)` ≈ `0.3333`、`mdf(100, 100/3*... )` 系で 1/3pot→0.75 を確認。
- `genMdfDrill` の choices が4・answer含む・0..1・重複なし。

### B.3 ページUI（MDFタブ）

ワイヤーは必要勝率タブと同型。シナリオカード文言:
- 「ポット 100 ・ 相手ベット 100」「あなたのレンジの最低何%を守るべき？(MDF)」

回答後 FeedbackBanner（children）:
- 式: `MDF = ポット ÷ (ポット + ベット額) = 100 ÷ (100 + 100) = 50%`
- 一言解説: `相手のブラフを自動的に不利益（EV0以下）にする最低防御頻度。これより多く降りると、相手はどんな2枚でもブラフして利益を得られる。`
- ベットサイズ別 代表値テーブル（常時表示でも可、Panel「考え方」内）:

```
ベットサイズ    MDF
1/3 pot         75%
1/2 pot         67%
2/3 pot         60%
pot             50%
2x pot          33%
```

- 表は既存 `Metric`（PotOdds.tsx 141–151行目）風の小カード or 単純な `<dl>`/グリッドで。等幅フォント（`font-mono tabular-nums`）で桁を揃える（DESIGN §8.2）。
- 回答時 `recordMdf(correct)`。

---

## 機能C: フロップCBクイズ（新ページ `/cbet`）

### C.1 概要

シングルレイズドポット（SRP）での「レンジ有利・CB（continuation bet）頻度」の感覚を養うクイズ。
出題: 「BTN open、BB call。フロップ K♠7♦2♣ (rainbow)。レンジ全体としてのCB戦略は？」→ 3択。

### C.2 データ（`src/data/cbetQuestions.ts` を新設）

40〜60問の厳選フロップを同梱。MVPシナリオは `BTN_vs_BB`（BTN open vs BB call）固定だが、他シナリオ（CO vs BB 等）へ拡張できる構造にする。

```ts
import type { Card } from '../core/cards';
import type { Position } from '../core/ranges/types';

/** CB戦略の3択。データ駆動の正解値。 */
export type CbetStrategy = 'high' | 'mixed' | 'check';
//  high  = 高頻度CB（レンジベット気味, 小サイズで広く）
//  mixed = ミックス（約半分のハンドでベット）
//  check = チェック多め（オープナー不利 or ボードがコーラー有利）

/** フロップのテクスチャ分類タグ（複数付与可）。解説と将来の集計に使う。 */
export type FlopTexture =
  | 'A-high-dry'      // Aハイ・バラバラ（例 A72r）
  | 'K-high-dry'      // Kハイ・バラバラ（例 K72r）
  | 'broadway-dry'    // ハイカード主体ドライ（例 QJ4r のうち連結弱）
  | 'middle-connected'// ミドル連結（例 987, T98）
  | 'low-connected'   // ロー連結（例 654, 765, BB有利）
  | 'low-board'       // ローカードのバラついた盤（例 832r）
  | 'paired'          // ペアボード（例 KK4, 772）
  | 'monotone'        // モノトーン（3枚同スート）
  | 'two-tone'        // ツートーン（2枚同スート＝FDあり）
  | 'rainbow'         // レインボー
  | 'wet'             // 全般にウェット（ストレート/フラッシュドロー豊富）
  | 'dry';            // 全般にドライ

export type CbetScenario = {
  id: string;          // 'BTN_vs_BB'
  label: string;       // 'BTN open vs BB call'
  openerPos: Position; // 'BTN'
  callerPos: Position; // 'BB'
};

export type CbetQuestion = {
  id: string;                 // 'cb-btnbb-K72r'
  scenarioId: string;         // 'BTN_vs_BB'
  board: [Card, Card, Card];  // フロップ3枚（既存 Card 型）
  textures: FlopTexture[];    // 分類タグ
  answer: CbetStrategy;       // 正解
  explanation: string;        // なぜそうか（日本語）。レンジ有利/不利・ナッツ級の偏りを必ず触れる
};

export const CBET_SCENARIOS: CbetScenario[] = [
  { id: 'BTN_vs_BB', label: 'BTN open vs BB call', openerPos: 'BTN', callerPos: 'BB' },
];

export const CBET_QUESTIONS: CbetQuestion[] = [ /* §C.4 の基準で40〜60問 */ ];
```

UI側の3択ラベル（`src/pages/Cbet.tsx` 内に定数で持つ。データには持たせない）:

```ts
const STRATEGY_LABEL: Record<CbetStrategy, string> = {
  high:  '高頻度CB（レンジベット気味）',
  mixed: 'ミックス（約半分）',
  check: 'チェック多め',
};
```

### C.3 ページUI（`src/pages/Cbet.tsx` を新設）

```
PageHeader title="フロップCBクイズ"
  description="シングルレイズドポットでのレンジ有利とCB頻度の感覚を鍛える。"
grid lg:[1fr_280px]
┌── Panel ──────────────────────────┐  ┌── 右カラム ─────┐
│  シナリオ chip: BTN open vs BB call │  │ StatBadge×3      │
│  ボード:  [K♠][7♦][2♣]  ← PlayingCard│  │ Panel「考え方」  │
│  テクスチャ chips: K-high-dry / rainbow│  │  CB理論メモ      │
│  「レンジ全体としてのCB戦略は？」    │  └──────────────────┘
│  [ 高頻度CB（レンジベット気味） ]    │
│  [ ミックス（約半分） ]              │
│  [ チェック多め ]                    │
│  （回答後）FeedbackBanner: explanation│
│  [ 次の問題 ]                        │
└──────────────────────────────────────┘
```

- ボードは `PlayingCard size="lg"` を3枚横並び。
- テクスチャタグは `accent/15` の小チップで列挙（RangeTrainer のシナリオchip風）。
- 3択は `Quiz.tsx` のボタンパターン（3択なので `ActionButtons` ではなく Quiz型の縦積みボタンを使う）。
- 出題選択は `Quiz.tsx` の `nextQuestion`（直前と同じ問題を避ける `pick`）と同じロジックを流用。
- 回答時 `recordCbet(correct)`。
- シナリオ選択UIはMVPでは不要（1シナリオ固定）。データ構造は複数対応なので、将来 `CBET_SCENARIOS.length > 1` になったらタブ/セレクタを足す。

### C.4 正解の根拠付け方針（データ作成ガイド・Sonnetが問題を書く指針）

一般的なソルバー傾向の**近似**でよい（本物のソルバーではない）。BTN open vs BB call（IPのオープナーがレンジ有利な代表ケース）を前提に、以下のヒューリスティクスで `answer` とタグを決める:

- **A-high / K-high のドライ（rainbow, 連結弱）** → `high`。
  根拠: オープナー(BTN)はAx/Kxを多く持ち、トップペア以上のナッツ級が大幅にレンジ有利。BBはこのボードに刺さりにくい。小サイズのレンジベットが有効。
  例: A72r, AK4r, K72r, KQ5r, A83r。
- **ブロードウェイ系ドライ（QJ4r, KJ3r 等）** → `high` 寄りだが一段弱いものは `mixed`。BBもQJ/KJ/JTを持つためややエクイティが寄る盤は `mixed`。
- **ミドル連結（987, T98, J T9, two-tone）** → `mixed` 〜 `check`。
  根拠: 両者がストレート/2ペア系を持ちうる。BTNのオーバーペア・トップペア優位は残るが、BBのコールレンジ(suited connector, ミドルペア)が刺さる。
- **ロー連結（654, 765, 543, 876）** → `check`。
  根拠: 6-5-4 等の低位連結はBBのコールレンジ（54s,65s,76s,小ペア等）に刺さりやすく、ナッツ級分布が拮抗〜BB寄り。BTNのレンジ有利が縮むためCB頻度を落としチェックを増やす。
- **ローカードのバラつき盤（832r, 742r）** → `high`。
  根拠: 連結が弱くナッツが少ない。オーバーカードとレンジ有利でオープナーが小サイズで突きやすい。
- **ペアボード（KK4, 772, QQ8）** → `high`。
  根拠: トリップス到達確率は両者低く、レンジ有利なオープナーがレンジベットしやすい。ただしローのペアボード(33x等)は `mixed`。
- **モノトーン（同スート3枚）** → `check` 〜 `mixed`。
  根拠: フラッシュ完成・ドローが交錯し、オープナーの有利が縮む。小頻度・小サイズか、チェック多めが無難。MVPでは多くを `check`/`mixed`。
- **ツートーン（FDあり）の中位盤** → 同テクスチャのrainbowより一段CB頻度を下げる方向（rainbowで`high`なら two-tone は `high`〜`mixed`）。

**問題の配分目安（40〜60問）**: high 40〜50% / mixed 30〜40% / check 15〜25%。
各テクスチャ分類が最低3問以上含まれるようにし、似た盤に偏らせない。
`explanation` には必ず「どちらのレンジにナッツ級が多いか」「だからCB頻度が高い/低い」を1〜2文で書く。冒頭に「これはソルバーの一般傾向の近似です」と毎回書く必要はない（§C.5でページ上に明示する）。

### C.5 近似であることの明示

ページ右カラムの「考え方」Panel に固定文を置く:
`これは本物のソルバー出力ではなく、一般的なGTO傾向の近似です。実戦では相手の傾向に応じて調整しましょう。`

### C.6 ナビ追加

`AppShell.tsx` の `NAV` に項目追加。アイコンは `lucide-react` の `Target`（CBの「狙い撃ち」イメージ）。
`/cbet` を `App.tsx` のルートに追加（`{ path: 'cbet', element: <Cbet /> }`）。

### C.7 テスト（`src/data/cbetQuestions.test.ts`）

- 全 `CBET_QUESTIONS` で `board` が3枚かつ全て有効な `Card`・重複なし（`isCard` 利用）。
- `id` がユニーク。`answer` が `'high'|'mixed'|'check'` のいずれか。`textures` が空でない。
- `scenarioId` が `CBET_SCENARIOS` に存在する。
- 問題数が40以上。

---

## フェーズ分割（Sonnet向け作業計画）

各フェーズ末で `npm run build` と `npm run test` が通ること。

- **V2-1 — core計算 + テスト**: `potOdds.ts` に `mdf` / `genReqEquityDrill` / `reqEquityChoices` / `genMdfDrill` / `mdfChoices` を追加し、`potOdds.test.ts` を拡充。UIなし。
- **V2-2 — progressストア拡張**: `reqEquity` / `mdf` / `cbet` の `DrillStats` と record アクション追加、`reset`・`OverallStat` 更新、persist マイグレーション（§0.3）。
- **V2-3 — 機能A+B（PotOddsページのタブ化）**: `PotOdds.tsx` を3タブにリファクタ。`DrawView`（既存抽出）/`ReqEquityView`/`MdfView`。PageHeader文言・ナビラベル更新。
- **V2-4 — 機能C（CBクイズ）**: `src/data/cbetQuestions.ts`（40〜60問 + テスト）→ `src/pages/Cbet.tsx` → `App.tsx` ルート + `AppShell` ナビ追加。

各フェーズは独立にビルド/テスト可能。V2-1/V2-2 は純ロジックで先行できる。

---

## ナビゲーション構成（DRILLS-V2 反映後の暫定。VERSUS.md で最終調整）

項目が増えるため、現状の単純な6項目フラット並びを維持しつつ並び順を意味で整える。
（vs CPU 追加後のグルーピング案は `docs/VERSUS.md` §ナビ参照。両ドキュメントで `NAV` 定義を一元化すること。）

```
ホーム / レンジ訓練 / エクイティ / オッズ & MDF / CB / クイズ
```
- `/cbet` = ラベル「CB」、アイコン `Target`。
- `/pot-odds` = ラベル「オッズ & MDF」、アイコン `Coins`（据え置き）。
