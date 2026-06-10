# Poker Practice — 設計ドキュメント

NLH 6-max キャッシュゲーム向けの、初心者〜中級者用ポーカー練習アプリ。
GTOアプリ風だが「本物のソルバー(重い計算)」は持たず、**事前計算データ + 軽量なブラウザ内計算 + 学習ドリル**で構成する。

- 対象: No-Limit Hold'em, 6-max, 100bb キャッシュ
- UI言語: 日本語（ポーカー専門用語は英語のまま使用 = open, 3bet, RFI 等）
- ホスティング: 静的SPA、サーバー/DBなし、Vercel無料枠
- 進捗保存: ブラウザの localStorage

---

## 1. 技術スタック

| 項目 | 選定 | 理由 |
|------|------|------|
| ビルド/フレームワーク | Vite + React + TypeScript | 静的ビルド、軽快、デプロイ容易 |
| スタイリング | Tailwind CSS | 13×13レンジ表など密なUIを高速に構築 |
| ルーティング | React Router | 4機能をページ分割 |
| 状態管理 | Zustand | 進捗統計など横断状態を軽量に管理 |
| 重い計算 | Web Worker | エクイティのモンテカルロをUIスレッドと分離 |
| テスト | Vitest | ハンド評価器・エクイティの正当性を担保 |
| 永続化 | localStorage | 進捗・設定。サーバー不要 |
| デプロイ | Vercel (無料) | GitHub push で自動デプロイ |

**重要な設計原則**: `src/core/` のポーカーロジックは React に一切依存しない純粋な TypeScript にする。
→ ユニットテストしやすく、Web Worker からも呼べる。UIと完全に分離する。

---

## 2. ドメインモデル (`src/core/`)

### 2.1 cards.ts
```ts
type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A'; // 13
type Suit = 's'|'h'|'d'|'c';                                      // spade/heart/diamond/club
type Card = `${Rank}${Suit}`;   // 例: 'As', 'Td', '7c'  （計52枚）
```
- `RANKS`, `SUITS` 定数配列（順序付き）
- `rankValue(rank): number`  2→0 ... A→12（評価器用の数値化）
- `parseCard(str): Card` / `cardToString`
- `makeDeck(): Card[]`  52枚生成
- `removeCards(deck, used): Card[]`  既知カードを除外（エクイティ計算で使用）

### 2.2 handNotation.ts — 169スターティングハンド
プリフロップの「種類」は169通り（13ペア + 78スーテッド + 78オフスート）。
```ts
type HandClass = string; // 'AA', 'AKs', 'AKo' のような表記
```
- `HAND_GRID: HandClass[][]`  13×13。慣例: 行=高い方のランク、列=低い方のランク、
  対角線=ペア、右上(行<列)=suited、左下=offsuit。レンジ表UIはこの配置に従う。
- `comboCount(handClass): number`  ペア=6, suited=4, offsuit=12（重み付けに使う）
- `cardsToHandClass(c1, c2): HandClass`  2枚 → 'AKs' 等へ正規化
- `handClassToCombos(handClass): [Card, Card][]`  該当する具体的コンボ列挙
- 総コンボ数: 1326 (= 169の重み合計)

### 2.3 evaluator.ts — 7枚ハンド評価器 ★最重要・要テスト
- 役割: 7枚（ホール2 + ボード5）から最強5枚の役を数値スコア化し、`a > b` で勝敗判定。
- 戻り値: 単一の比較可能な数値 `HandValue`（大きいほど強い）。
- 役のカテゴリ（強い順）: ストレートフラッシュ > フォーカード > フルハウス > フラッシュ >
  ストレート > スリーカード > ツーペア > ワンペア > ハイカード。
- 実装方針（MVP）: カテゴリ判定 + キッカー比較を素直に実装。
  - ランク出現数を数える（4/3/2/1）
  - フラッシュ判定（同スート5枚以上）
  - ストレート判定（A-5ホイール含む。A=高/低両用）
  - スコア合成: `category * 16^5 + kicker1 * 16^4 + ... ` のように桁で表現
- 正当性が最優先。既知ハンドの順位を網羅したテストを `evaluator.test.ts` に用意する
  （例: ロイヤル > 各役 > ハイカード、ホイールストレート、キッカー比較、同役引き分け）。
- 性能: モンテカルロで数万回呼ぶため、ホットパスでの割り当てを抑える。MVPでは素直な実装で可、
  遅ければ後でルックアップテーブル化（Cactus Kev / 2+2 評価器）を検討（Phase 2の最適化課題）。

### 2.4 equity.ts — エクイティ計算
```ts
type EquityInput = {
  hands: HoleCards[];       // 各プレイヤーのホールカード（2〜9人）
  board?: Card[];           // 0,3,4,5枚
  iterations?: number;      // 既定 100_000
};
type EquityResult = { win: number; tie: number; total: number }[]; // hands と同順
```
- 方式: モンテカルロ。残りデッキからボードを埋め、各試行で勝者判定、勝ち/分けを集計。
- ボードが5枚埋まっている場合は厳密計算（1試行）。
- Phase 2: 「ハンド vs レンジ」（片方を169レンジで指定 → 全コンボを重み付きサンプリング）。
- **Web Worker から呼ぶ**こと（`src/workers/equity.worker.ts` がこの関数を実行）。

### 2.5 ranges/ — プリフロップレンジデータ
```ts
// ranges/types.ts
type Action = 'raise' | 'call' | 'fold';
// 混合戦略に拡張できるよう頻度も持てる形にする
type HandAction = { raise?: number; call?: number; fold?: number }; // 合計1.0
type Range = Record<HandClass, HandAction>;   // 169ハンド分（未指定はfold扱い）
type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
type Scenario = {
  id: string;             // 'RFI_UTG' 等
  label: string;          // 表示名（日本語）
  heroPos: Position;
  context: 'RFI';         // Phase2で 'vs_RFI' | 'vs_3bet' 等を追加
  range: Range;
};
```
- MVP は **RFI (Raise First In) を5ポジション分**（UTG/HJ/CO/BTN/SB）。BBはRFIなし。
- §6 の starter ranges を初期データとして投入（pure戦略: raise=1.0 のハンドのみ列挙、他はfold）。
- データ構造は混合頻度に対応済みなので、Phase 2 でソルバー由来の頻度データへ差し替え可能。

### 2.6 potOdds.ts
- `potOdds(potSize, toCall): number`  = toCall / (potSize + toCall)（必要勝率）
- `equityFromOuts(outs, street): number`  rule of 2/4（flop→×4, turn→×2 の近似 + 厳密版）
- `outsToEquityExact(outs, cardsToCome): number`  残りカードからの厳密計算
- ドリル出題用に「draw種別 → outs」の参照テーブル（フラッシュドロー=9, OESD=8 等）

---

## 3. 機能仕様 (`src/features/`)

### F1. プリフロップ・レンジ訓練 (rangeTrainer) ★中核
2モード:
- **チャート閲覧**: シナリオ選択 → 13×13グリッドを色分け表示（raise=緑/call=青/fold=灰、頻度は濃淡）。
- **ドリル**: ランダムなシナリオ+ハンドを出題 → ユーザーがアクション選択 → 正誤+正解レンジ上の位置をハイライト。
  連続正解(streak)・正答率を記録。

### F2. エクイティ計算機 (equityCalc)
- カード選択UI（52枚ピッカー）でホールカード2人分 + 任意のボードを入力。
- 計算ボタン → Web Worker でモンテカルロ → 各ハンドの勝率/分け率/総合エクイティを表示。
- 進捗バーで計算中を表示。iterations は設定で変更可（既定100k）。
- Phase 2: ハンド vs レンジ、複数プレイヤー、レンジ vs レンジ。

### F3. ポットオッズ/アウツ訓練 (potOdds)
- 出題: ポット額・コール額・自分のドロー(outs)をランダム生成。
- ユーザーが「コール/フォールド」を選択（または必要勝率を数値入力）。
- 判定: outsからの実エクイティ vs 必要勝率を比較し正誤+解説（pot odds, rule of 2&4 の式を表示）。

### F4. ハンドクイズ (quiz)
- データ駆動のクイズエンジン。問題はJSON/TSデータ:
```ts
type QuizQuestion = {
  id: string;
  prompt: string;            // 状況説明（日本語）
  context: { heroPos: Position; hand: HandClass; stack?: number; action?: string };
  choices: { label: string; value: string }[];
  answer: string;            // 正解 value
  explanation: string;       // 解説（なぜそのアクションか）
};
```
- MVP: プリフロップ系の問題をレンジデータから自動生成 + 厳選した手書き問題を数問同梱。
- Phase 2: ポストフロップのコンセプト問題を静的データで追加。

### 進捗トラッキング (store/progress)
- localStorage に保存: 各ドリル/クイズの試行数・正答数・streak・シナリオ別正答率。
- ホーム画面に「今日の練習」「弱点シナリオ（正答率が低い）」を表示。

---

## 4. ディレクトリ構成
```
src/
  core/                    # 純粋ロジック（React非依存・テスト対象）
    cards.ts
    handNotation.ts
    evaluator.ts
    equity.ts
    potOdds.ts
    ranges/
      types.ts
      rfi.ts               # RFI starter ranges（§6）
      index.ts
    *.test.ts              # Vitest（evaluator が最重要）
  workers/
    equity.worker.ts       # equity.ts を呼ぶ Worker ラッパ
  features/
    rangeTrainer/
    equityCalc/
    potOdds/
    quiz/
  components/              # 共有UI: Card, RangeGrid(13x13), CardPicker, ActionButtons 等
  store/
    progress.ts            # Zustand + localStorage 永続化
  pages/                   # Home, RangeTrainer, EquityCalc, PotOdds, Quiz
  App.tsx
  main.tsx
index.html
vite.config.ts
tailwind.config.js
```

---

## 5. 実装フェーズ（Sonnet向け作業計画）

各フェーズ末で `npm run build` が通り、ブラウザで動作確認できる状態にする。

- **Phase 0 — 基盤**: Vite+React+TS+Tailwind 雛形、ルーティング、ホーム画面の枠。
  `core/cards.ts`, `handNotation.ts` 実装 + テスト。
- **Phase 1 — 評価器とエクイティ**: `evaluator.ts`（+網羅テスト）, `equity.ts`,
  `equity.worker.ts`。F2エクイティ計算機を完成。
- **Phase 2 — レンジ訓練**: `ranges/`（§6投入）, `RangeGrid` コンポーネント,
  F1チャート閲覧 + ドリル, 進捗ストア。
- **Phase 3 — ポットオッズ & クイズ**: `potOdds.ts` + F3, クイズエンジン + F4。
- **Phase 4 — 仕上げ & デプロイ**: ホーム画面の統計/弱点表示、レスポンシブ調整、
  Vercelデプロイ設定、README。
- **Phase 5+（中級者向け・任意）**: vs-RFI / 3betレンジ、混合頻度表示、ハンドvsレンジ・エクイティ、
  ポストフロップ・コンセプト問題、（必要なら）Supabaseで進捗のクラウド同期。

---

## 6. Starter Ranges（RFI / 6-max 100bb）

> ⚠️ これらは**初心者向けの簡略・近似レンジ**。pure戦略(raise=1.0)で記述し、それ以外はfold。
> 出荷前に信頼できるチャート（例: GTO Wizardの無料プリフロップ等）と突き合わせて微調整する想定。
> データ構造(§2.5)は混合頻度対応済みなので差し替えは容易。

表記: `22+`=22以上のペア全部, `ATs+`=ATs,AJs,AKs, `A5s-A4s`=その2つ, `T9s`=単体。

### UTG（最もタイト, 約15%）
- ペア: `22+`
- スーテッド: `ATs+`, `A5s-A4s`, `KTs+`, `QTs+`, `JTs`, `T9s`, `98s`, `87s`, `76s`
- オフスート: `AJo+`, `KQo`

### HJ（約19%）
- ペア: `22+`
- スーテッド: `A9s+`, `A5s-A4s`, `K9s+`, `Q9s+`, `J9s+`, `T8s+`, `98s`, `87s`, `76s`, `65s`
- オフスート: `ATo+`, `KJo+`, `QJo`

### CO（約27%）
- ペア: `22+`
- スーテッド: `A2s+`, `K9s+`, `Q9s+`, `J9s+`, `T8s+`, `97s+`, `86s+`, `76s`, `65s`, `54s`
- オフスート: `A9o+`, `KTo+`, `QTo+`, `JTo`

### BTN（最もワイド, 約45%）
- ペア: `22+`
- スーテッド: `A2s+`, `K5s+`, `Q8s+`, `J8s+`, `T8s+`, `97s+`, `86s+`, `75s+`, `64s+`, `54s`, `43s`
- オフスート: `A2o+`, `K9o+`, `Q9o+`, `J9o+`, `T9o`, `98o`

### SB（raise-only戦略, 約42%）
- ペア: `22+`
- スーテッド: `A2s+`, `K7s+`, `Q8s+`, `J8s+`, `T8s+`, `97s+`, `86s+`, `75s+`, `65s`, `54s`
- オフスート: `A7o+`, `K9o+`, `QTo+`, `JTo`

---

## 7. デプロイ（無料）
1. GitHub にリポジトリ作成。
2. Vercel に GitHub 連携 → Vite を自動検出（Build: `npm run build`, Output: `dist`）。
3. push する度に自動デプロイ。独自ドメインは任意（無料サブドメインで運用可）。
- 完全クライアントサイドなので無料枠を超える要素なし。
- 将来クラウド同期が欲しくなったら Supabase 無料枠でログイン+進捗同期を追加（その時点で再設計）。

---

## 8. デザインシステム（UI仕様）★

コンセプト: **モダンなダーク基調のプレミアムなトレーニングツール**（GTO Wizard系の硬派さ + 親しみやすさ）。
ポーカーの緑をアクセントに昇華し、ガラス質のカード・滑らかなアニメーション・数値の見やすさを重視。

### 8.1 カラートークン（Tailwind v4 `@theme` で定義）
ダークテーマ固定（初版）。CSS変数 + Tailwindユーティリティで参照。

| 用途 | トークン | 値(目安) |
|------|----------|----------|
| 背景(最奥) | `--color-bg` | `#0b0f14`（slate-950寄りの濃紺黒） |
| 背景(面/カード) | `--color-surface` | `#141b24`（半透明で重ねる: `/70` + backdrop-blur） |
| 枠線 | `--color-border` | `#22303c` |
| 本文 | `--color-text` | `#e6edf3` |
| 補助テキスト | `--color-muted` | `#8b9aa7` |
| アクセント主(緑) | `--color-accent` | `#10b981`（emerald-500）, hover `#34d399` |
| アクセント副(シアン) | `--color-accent-2` | `#22d3ee`（cyan-400） |
| 強調/ストリーク | `--color-gold` | `#f5b942` |
| 危険/不正解 | `--color-danger` | `#f43f5e`（rose-500） |

**アクション色（レンジ表/ボタン共通の意味づけ）**:
- raise = emerald (`--color-accent`)
- call = sky/cyan (`#38bdf8`)
- fold = slate（暗いグレー `#2b3640`）
- 混合頻度はセル内を比率で塗り分け（縦グラデ or 帯）。

### 8.2 タイポグラフィ
- UI本文: **Inter**（Google Fonts, `font-sans`）。
- 数値・確率・スタッツ: **JetBrains Mono** など等幅（`font-mono`）。%や bb、オッズは等幅で桁を揃える。
- 見出しは `tracking-tight`、太め(`font-semibold/bold`)。

### 8.3 ビジュアル言語
- **背景**: 全面に微かな放射状グラデ（中央上に emerald/cyan のごく薄いグロー）+ 細かいノイズ/グリッド感。`bg` の上に `radial-gradient`。
- **カード(パネル)**: `rounded-2xl`, `border border-border`, `bg-surface/70 backdrop-blur`, 柔らかい影 `shadow-lg shadow-black/30`。ホバーで border がアクセント色に薄く発光。
- **ボタン**: 主要CTAはアクセントのグラデ + ほのかなグロー、`rounded-xl`, `active:scale-95 transition`。副次はゴースト（border + hover時に面が出る）。
- **角丸**: パネル`2xl`、ボタン/チップ`xl`、小要素`lg`。
- **アニメーション**: `framer-motion`。ページ遷移フェード、出題カードのフリップ/スライドイン、正誤フィードバックのポップ、数値のカウントアップ。やり過ぎない（150–300ms, ease-out）。

### 8.4 トランプ表示（`<PlayingCard>`）
- CSSで描画（画像アセット不要）。白地 `rounded-lg`、左上にランク+スート、中央に大きめスート記号。
- スート色: ♠♣=`#1a1a1a`（濃いグレー）、♥♦=`#e5484d`（赤）。サイズは `sm/md/lg` を props で。
- 裏面: アクセントのパターン。未選択スロットは破線枠のプレースホルダ。
- カードを伏せ→公開する時は flip アニメーション。

### 8.5 レンジ表（`<RangeGrid>`）★中核UI
- 13×13グリッド。`HAND_GRID` の配置（対角=ペア、右上=suited、左下=offsuit）。
- 各セル: アクション色で塗り、ハンド表記を小さく表示。aspect-square、`gap-[2px]`。
- ホバーでセル拡大+ツールチップ（頻度内訳）。ドリルでは出題ハンドのセルをパルスでハイライト。
- 凡例（raise/call/fold の色チップ）と、開いている割合(%)を併記。
- レスポンシブ: モバイルでも 13×13 を維持（横スクロール許容 or 縮小）。

### 8.6 レイアウト / ナビゲーション
- デスクトップ: 左に固定サイドバー（ロゴ + 5項目 + 下部に今日の正答率ミニ表示）。右が主コンテンツ。
- モバイル: 上部ヘッダー + 下部タブバー（5アイコン）。
- ページ共通: 上部にページタイトル+短い説明、下にコンテンツカード群。最大幅でセンタリング。
- ナビ項目: ホーム / レンジ訓練 / エクイティ / ポットオッズ / クイズ。

### 8.7 共有コンポーネント一覧（`src/components/`）
`AppShell`(サイドバー+ヘッダー+Outlet) / `PlayingCard` / `CardPicker`(52枚選択モーダル) /
`RangeGrid` / `ActionButtons`(fold/call/raise) / `Panel`(ガラスカード) / `Button` /
`StatBadge`(数値+ラベル, 等幅) / `ProgressRing`(正答率の円グラフ) / `Toast`(正誤フィードバック) /
`PositionTable`(6-maxのミニテーブル図でheroの席を示す)。

---

## 9. ルーティング
React Router。すべて静的（コード分割は任意）。
```
/                ホーム（ダッシュボード）
/range           レンジ訓練（タブ: チャート閲覧 / ドリル）
/equity          エクイティ計算機
/pot-odds        ポットオッズ訓練
/quiz            ハンドクイズ
```
- 404 はホームへリダイレクト。`AppShell` を親ルートにして `<Outlet>` で各ページ。

## 10. レンジ表記の展開アルゴリズム（`ranges/expand.ts`）
starter ranges(§6) は人間可読の表記なので、169の `HandClass` 集合へ展開する関数を用意する。
```ts
expandTokens(tokens: string[]): HandClass[]
```
解釈ルール:
- `22+` → ペア22以上すべて（22,33,...,AA）。
- `ATs+` → 同じ高位札(A)でkickerをT以上のsuited（ATs,AJs,AKs）。`KTo+` も同様にoffsuit。
- `A5s-A4s` → 範囲指定（連続するkicker）。
- `T9s` / `98o` / `JJ` → 単体。
- ペアの `+` は上方向（55+ = 55〜AA）。
- 展開結果を `{ [hand]: { raise: 1 } }` の `Range` に変換するヘルパも用意（`tokensToRange`）。
- 単体テスト必須（境界: `22+`, `A2s+`, `A5s-A4s`, ペア範囲）。

## 11. Equity Worker 通信プロトコル
`equity.worker.ts` は `equity.ts` の純関数をラップするだけ。型付きメッセージ:
```ts
// メインスレッド → Worker
type EquityRequest = { id: string; hands: string[]; board: string[]; iterations: number };
// Worker → メインスレッド（途中経過 + 完了）
type EquityProgress = { id: string; type: 'progress'; done: number; total: number };
type EquityDone = { id: string; type: 'done'; result: EquityResult };
type EquityError = { id: string; type: 'error'; message: string };
```
- Vite の `new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' })` で読み込む。
- モンテカルロのループ内で一定間隔（例: 5%毎）に `progress` を postMessage。
- フックでラップ: `useEquity()` が Worker生成・リクエスト送信・進捗/結果のstate管理・cleanupを担当。

## 12. 具体データ例

### レンジシナリオ（展開後の利用イメージ）
```ts
const RFI_BTN: Scenario = {
  id: 'RFI_BTN', label: 'BTN オープン (RFI)', heroPos: 'BTN', context: 'RFI',
  range: tokensToRange(['22+','A2s+','K5s+','Q8s+', /* …§6 BTN… */ 'A2o+','K9o+']),
};
```

### クイズ問題（手書き例）
```ts
const q: QuizQuestion = {
  id: 'pf-001',
  prompt: 'COからオープン(2.5bb)、あなたはBTN。アクションは？',
  context: { heroPos: 'BTN', hand: 'A5s' },
  choices: [
    { label: 'フォールド', value: 'fold' },
    { label: 'コール', value: 'call' },
    { label: '3bet', value: 'raise' },
  ],
  answer: 'raise',
  explanation: 'A5sはブロッカーとプレイアビリティを持つ標準的な3betハンド。BTNからCOのオープンに対し、バリューとブラフのバランスでリレイズが推奨される。',
};
```

### ポットオッズ出題（自動生成）
```ts
type PotOddsDrill = {
  pot: number; toCall: number; outs: number; street: 'flop' | 'turn';
  // 正解 = (outsからの実エクイティ) >= (必要勝率) なら call
};
// 例: pot=100, toCall=50, outs=9(フラッシュドロー), street='flop'
//   必要勝率 = 50/150 = 33.3% / 実エクイティ(9 outs, 2枚) ≈ 35% → call
```
