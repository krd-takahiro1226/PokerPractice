# RANGES-V2 — レンジ3モード化（トーナメント / キャッシュ・アンティあり / キャッシュ・アンティなし）設計ドキュメント

「世界のヨコサワ」考案のトーナメント用ティア式ハンドレンジ表をベースに、レンジを **3モード化** し、レンジ訓練・プリフロップドリル・対戦（vs CPU）・GTOレビューを全てモード対応にする。

本ドキュメントは Sonnet が単独で実装着手できる粒度（ティアの ground-truth データ・型・関数シグネチャ・ファイル配置・モード導出ルール（ハンドリスト単位）・エンジンの ante 対応・UI 変更・移行/マイグレーション・テスト方針・フェーズ分割）まで具体化したもの。

前提:
- `docs/DESIGN.md`（全体方針・§8 デザインシステム・§8.7 共有コンポーネント）を変更しない。
- `docs/VERSUS.md` / `docs/DRILLS-V2.md` の確定事項と矛盾させない。
- `src/core/` は React 非依存の純粋TSを維持（テスト容易性・Worker利用のため）。
- UI言語は日本語。ポーカー用語（open, RFI, 3bet, call, ante, BB ante 等）は英語のまま。

---

## 0. スコープと重要な設計判断（サマリ）

| 論点 | 判断 |
|---|---|
| ティアデータの source of truth | `src/core/ranges/yokosawa.ts` に **tier1〜tier7 + bbCall** を `HandClass[]` で literal 定義（§1）。画像から読み取ったデータを唯一の真実源とし、勝手に変更しない。 |
| モード型 | `type GameMode = 'tournament' \| 'cash-ante' \| 'cash-noante'`（`src/core/ranges/mode.ts`）。 |
| ポジション→使用ティア | UTG/HJ=tier1〜5、CO=tier1〜6、BTN=tier1〜7、SB=tier1〜7（チャート未定義。BTN と同じ2人の列を適用）。BB は RFI なし＝「BB defense vs BTN open」を別データとして持つ（§3）。 |
| cash-ante 導出 | **トーナメントと同一**（ICM がない分わずかに広くてよいが、初心者向けの明快さを優先しチャートそのまま）。tier 構成は tournament と完全一致。 |
| cash-noante 導出 | **各ポジションが使う最も広いティアを1つ落とす**（＝限界ハンドを1ティア相当タイト化）。UTG/HJ→tier5除外、CO→tier6除外、BTN/SB→tier7除外（§2）。ハンドリストはティア定義そのものなので機械的・明示的。 |
| 既存 RFI starter ranges | **廃止して差し替え**。`rfi.ts` の `RFI_SCENARIOS` はヨコサワ由来データから生成する形に置換（§4）。`Scenario`/`Range` 型は維持。 |
| モード×ポジション → Range API | `getRfiRange(mode, pos): Range` / `getRfiScenarios(mode): Scenario[]`（§5）。既存 `getScenario(id)` は後方互換のため残す（既定モード= tournament）。 |
| エンジン ante 対応 | `GameConfig.ante` を追加し **BB ante 方式**（BB が全員分の 1bb を追加投下）を採用（§6）。チップ保存性テストに ante を反映。 |
| 対戦のモード選択 | Versus 画面に難易度と並ぶモードセレクタを追加。CPU プリフロップAI と GTOレビューが選択モードのレンジを参照（§7）。 |
| 履歴 SavedHand | `mode: GameMode` を追加。`persist` version を 2 に上げ migration で欠損を `'tournament'` 補完（§8）。 |
| progress ストア | **変更不要**（モード別統計は持たない。既存集計のまま）。明記のみ（§9）。 |
| vsOpen.ts（既存） | BB vs BTN をヨコサワ bbCall データ由来に差し替え。他ケース（BB vs CO 等）は既存維持しつつ矛盾しない範囲で調整（§3.3）。 |

---

## 1. ティアデータ（ground truth）— `src/core/ranges/yokosawa.ts`

画像から読み取った **正確なティアデータ**。これが基礎データの source of truth であり、勝手に変更してはならない。
各ティアは「後ろの人数が少ないほど累積で広くオープンできる」累積式の1層を表す。`HandClass`（`'AA' | 'AKs' | 'AKo'` 形式、`handNotation.ts` 準拠）の配列としてリテラルで持つ。**トークン展開（`expand.ts`）は使わず、明示列挙する**（誤展開を防ぎ ground truth を逐語的に保持するため）。

```ts
// src/core/ranges/yokosawa.ts
import type { HandClass } from '../handNotation';

/** tier1 紺「8人(強)」 */
export const TIER1: HandClass[] = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo'];

/** tier2 赤「8人(中)」 */
export const TIER2: HandClass[] = ['TT', '99', 'AQs', 'AJs', 'ATs', 'KQs', 'AQo'];

/** tier3 黄「8人(弱)」 */
export const TIER3: HandClass[] = [
  '88', '77', 'KJs', 'KTs', 'QJs', 'JTs', 'AJo', 'KQo', 'KJo', 'QJo',
];

/** tier4 緑「6〜7人」 */
export const TIER4: HandClass[] = [
  '66', '55',
  'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'QTs', 'J9s', 'T9s', 'ATo',
];

/** tier5 青「4〜5人」 */
export const TIER5: HandClass[] = [
  '44', '33', '22',
  'K9s', 'Q9s', 'T8s', '98s', '87s',
  'A9o', 'JTo',
];

/** tier6 白「3人」 */
export const TIER6: HandClass[] = [
  'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
  'Q8s', 'Q7s', 'Q6s', 'J8s', 'J7s', '97s', '76s', '65s', '43s',
  'KTo', 'QTo', 'K9o', 'Q9o', 'J9o', 'T9o',
];

/** tier7 紫「2人」 */
export const TIER7: HandClass[] = [
  'Q5s', 'Q4s', 'Q3s', 'Q2s', 'J6s', 'T7s', '96s', '86s', '75s', '64s', '54s',
  'A6o', '98o',
];

/** bbCall ピンク「BBのみBTNのレイズにコール」。オープンには使わない。 */
export const BB_CALL: HandClass[] = [
  'J5s', 'J4s', 'J3s', 'J2s', 'T6s', 'T5s', 'T4s', 'T3s', '95s', '85s', '74s',
  'A8o', 'A7o', 'A5o', 'A4o', 'A3o', 'A2o',
  'K8o', 'K7o', 'K6o', 'K5o', 'Q8o', 'Q7o', 'J8o', 'T8o', '97o', '87o',
];

/** tier 配列（index 0 = tier1）。累積スライスで使う。 */
export const TIERS: HandClass[][] = [TIER1, TIER2, TIER3, TIER4, TIER5, TIER6, TIER7];
```

**データ検証（テストで担保）**: TIER1〜TIER7 + BB_CALL の全要素が `ALL_HAND_CLASSES` に含まれる有効な `HandClass` であり、**全ティア間・bbCall 間で重複が無い**こと（同一ハンドが2層に出てこない）。

---

## 2. モード型とポジション→ティア対応 — `src/core/ranges/mode.ts`

```ts
// src/core/ranges/mode.ts
import type { Position } from './types';

export type GameMode = 'tournament' | 'cash-ante' | 'cash-noante';

export const GAME_MODES: GameMode[] = ['tournament', 'cash-ante', 'cash-noante'];

export const GAME_MODE_LABEL: Record<GameMode, string> = {
  tournament: 'トーナメント',
  'cash-ante': 'キャッシュ（アンティあり）',
  'cash-noante': 'キャッシュ（アンティなし）',
};

export const GAME_MODE_SHORT: Record<GameMode, string> = {
  tournament: 'トーナメント',
  'cash-ante': 'アンティあり',
  'cash-noante': 'アンティなし',
};
```

### 2.1 ポジション → 使用する最大ティア（後ろの人数）

6-max の「後ろの人数（未アクションのプレイヤー数）」と、それが対応するティア番号（1始まり）:

| Position | 後ろの人数 | tournament/cash-ante が使う最大tier | cash-noante が使う最大tier |
|---|---|---|---|
| UTG | 5人 | tier5（4〜5人） | tier4 |
| HJ | 4人 | tier5（4〜5人） | tier4 |
| CO | 3人 | tier6（3人） | tier5 |
| BTN | 2人 | tier7（2人） | tier6 |
| SB | 1人（チャート未定義→2人の列を適用） | tier7 | tier6 |

`maxTier` は **1始まりのティア番号**（tier1=1 … tier7=7）。`TIERS` 配列は 0 始まりなので `TIERS.slice(0, maxTier)` で累積展開する。

```ts
// src/core/ranges/mode.ts （続き）

/** tournament / cash-ante 共通: ポジションが使う最大tier番号(1..7)。 */
const BASE_MAX_TIER: Record<Position, number> = {
  UTG: 5,
  HJ: 5,
  CO: 6,
  BTN: 7,
  SB: 7,  // チャート未定義のため2人の列(tier7)を適用（設計判断）
  BB: 0,  // BB は RFI なし（§3 で別扱い）
};

/**
 * モード×ポジション → 使用する最大tier番号(1..7)。0 は RFI なし。
 * cash-noante は base から 1 tier タイト化（最も広いtierを1つ落とす）。
 */
export function maxTierFor(mode: GameMode, pos: Position): number {
  const base = BASE_MAX_TIER[pos];
  if (base === 0) return 0;
  if (mode === 'cash-noante') return base - 1;
  return base; // tournament / cash-ante は同一
}
```

### 2.2 cash-noante 導出ルール（ハンドリスト単位で明示）

cash-noante は「各ポジションが使う最も広いティアを1つ丸ごと落とす」だけ。落ちるハンドはティア定義の逐語コピーなので機械的に確定する。**Sonnet は新たにハンドを選ぶ判断をしてはならない**——下表の通り `maxTierFor` の結果で `TIERS.slice` するだけ。

| Position | tournament/cash-ante レンジ | cash-noante で **落とすハンド** |
|---|---|---|
| UTG / HJ | tier1〜5 | **tier5 全部**: 44, 33, 22, K9s, Q9s, T8s, 98s, 87s, A9o, JTo |
| CO | tier1〜6 | **tier6 全部**: K8s, K7s, K6s, K5s, K4s, K3s, K2s, Q8s, Q7s, Q6s, J8s, J7s, 97s, 76s, 65s, 43s, KTo, QTo, K9o, Q9o, J9o, T9o |
| BTN / SB | tier1〜7 | **tier7 全部**: Q5s, Q4s, Q3s, Q2s, J6s, T7s, 96s, 86s, 75s, 64s, 54s, A6o, 98o |

> 備考（設計意図、実装には不要）: アンティなしはポット内デッドマネーが少なくオープンの期待値が下がるため、各ポジションで最も限界的なティアを落とすのが妥当。1ティア=1ステップのタイト化で「限界ハンドを1ティア相当タイト化」の要件を満たす。

---

## 3. BB ディフェンス（vs BTN open）— ヨコサワ由来

ヨコサワチャートには RFI に加え「BB のみ BTN のレイズにコール」する **bbCall** 層がある。これを BB defense vs BTN として実装する。BB は RFI を持たない（既存 `rfi.ts` に BB が無かった問題を、この defense データで解消する）。

### 3.1 call / 3bet の分割（設計判断）

bbCall 層はすべて **call**。加えて、BB defense では以下を **3bet (raise)** に割り当てる簡易分割を採用する:

- **value 3bet**: tier1 相当の最上位 = `AA, KK, QQ, JJ, AKs, AKo`
- **bluff 3bet**: `A5s, A4s`（A ブロッカー持ちの定番ブラフ。tier4 由来）

残りの「BTN オープンに対して継続する手」はすべて **call**:
- tier2〜tier7 のうち bluff 3bet に回した `A5s, A4s` を除く全ハンド（＝ BB が BTN の広いオープンに対して幅広くコール）
- ＋ bbCall 層（ピンク）全部

実装方針（明示）:

```ts
// BB defense vs BTN（mode 非依存。BB は ICM/ante でレンジを動かさない簡易設計）
// raise = value(tier1) + bluff(A5s,A4s)
// call  = (tier2..tier7 全部) - {A5s, A4s} + BB_CALL 全部
const BB_DEF_RAISE: HandClass[] = ['AA','KK','QQ','JJ','AKs','AKo','A5s','A4s'];
const BB_DEF_CALL: HandClass[] =
  [...TIER2, ...TIER3, ...TIER4, ...TIER5, ...TIER6, ...TIER7, ...BB_CALL]
    .filter((h) => h !== 'A5s' && h !== 'A4s');
```

> `Range` への変換は `{ raise: 1 }` / `{ call: 1 }` の pure 戦略。raise と call が重複しないよう、raise を後勝ちで上書きする（`expand.ts` の `tokensToRangeWithActions` と同じ優先規則）。tier1 は丸ごと raise なので tier1 を call に入れない点に注意。

> **モード非依存の理由**: BB defense は「相手（BTN）のオープンサイズと自分のポットオッズ」で決まり、ante/トーナメント差の影響は RFI ほど大きくない。初心者向けの明快さを優先し、BB defense は3モード共通の単一データとする（UIにも「BB defense は全モード共通」と注記）。

### 3.2 データ構造（`vsOpen.ts` への組み込み）

既存 `src/core/ranges/vsOpen.ts` の `VsOpenScenario` 型・`getVsOpen` をそのまま使う。BB vs BTN のレンジ定義のみヨコサワ由来データに差し替える。

```ts
// src/core/ranges/vsOpen.ts （差し替え）
import { TIER2, TIER3, TIER4, TIER5, TIER6, TIER7, BB_CALL } from './yokosawa';
import type { Range } from './types';

function listsToRange(spec: { call: HandClass[]; raise: HandClass[] }): Range {
  const range: Range = {};
  for (const h of spec.call) range[h] = { call: 1 };
  for (const h of spec.raise) range[h] = { raise: 1 }; // raise 優先で上書き
  return range;
}

const BB_DEF_RAISE = ['AA','KK','QQ','JJ','AKs','AKo','A5s','A4s'];
const BB_DEF_CALL = [...TIER2, ...TIER3, ...TIER4, ...TIER5, ...TIER6, ...TIER7, ...BB_CALL]
  .filter((h) => h !== 'A5s' && h !== 'A4s');

const BB_vs_BTN: Range = listsToRange({ call: BB_DEF_CALL, raise: BB_DEF_RAISE });
```

### 3.3 他 vsOpen ケースの扱い

- **BB vs BTN**: 上記でヨコサワ由来に差し替え（required）。
- **BB vs CO / SB vs BTN / BTN vs CO / BB vs UTG**: 既存データ（`vsOpen.ts` の現行定義）を **維持**。これらはヨコサワチャートに直接の定義が無い（チャートは BTN open に対する BB call のみ）ため、既存の簡易レンジを残す。
  - 矛盾しない範囲の調整方針（任意・軽微）: BB vs CO は BB vs BTN よりタイトであるべき（CO のオープンは BTN より強い）。既存 `BB_vs_CO` は既に `BB_vs_BTN` よりタイトなので、差し替え後も「BB_vs_CO ⊆ BB_vs_BTN（call+raise 集合）」がおおむね保たれることをレビュー時に確認する（厳密なテストは課さない。`info` 扱いの参考データのため）。
- `getVsOpen` のシグネチャ・`VSOPEN_SCENARIOS` の構造は不変。`vsOpen.ts` は**モード非依存**（§3.1 の理由）。

---

## 4. 既存 RFI starter ranges の廃止・差し替え — `src/core/ranges/rfi.ts`

DESIGN §6 の手書き starter ranges（UTG/HJ/CO/BTN/SB のトークン列）は **廃止**し、ヨコサワティアから生成する形に置換する。`Scenario` / `Range` 型・`RFI_SCENARIOS` の export 名は維持（後方互換）。

### 4.1 生成ロジック

```ts
// src/core/ranges/rfi.ts （全面差し替え）
import { TIERS } from './yokosawa';
import { maxTierFor, type GameMode } from './mode';
import type { HandClass } from '../handNotation';
import type { Position, Range, Scenario } from './types';

const RFI_POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];

/** モード×ポジション → 累積ティアを展開した HandClass 配列。 */
export function rfiHandClasses(mode: GameMode, pos: Position): HandClass[] {
  const maxTier = maxTierFor(mode, pos);
  if (maxTier === 0) return [];
  return TIERS.slice(0, maxTier).flat();
}

/** モード×ポジション → pure-raise Range。 */
export function getRfiRange(mode: GameMode, pos: Position): Range {
  const range: Range = {};
  for (const h of rfiHandClasses(mode, pos)) range[h] = { raise: 1 };
  return range;
}

const OPEN_SIZE: Record<Position, number> = {
  UTG: 2.5, HJ: 2.5, CO: 2.5, BTN: 2.5, SB: 3.0, BB: 0,
};

const POS_LABEL_JA: Record<Position, string> = {
  UTG: 'UTG', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB',
};

/**
 * scenario id は **モードに依存しない**（'RFI_UTG' 等）。
 * Home.tsx の弱点ラベル参照（byScenario のキー）が壊れないようにするため。
 * モードは Range の中身だけに反映する。
 */
export function getRfiScenarios(mode: GameMode): Scenario[] {
  return RFI_POSITIONS.map((pos) => ({
    id: `RFI_${pos}`,
    label: `${POS_LABEL_JA[pos]} オープン`,
    heroPos: pos,
    context: 'RFI' as const,
    sizeBB: OPEN_SIZE[pos],
    range: getRfiRange(mode, pos),
  }));
}

/** 後方互換: 既定モード = tournament の RFI_SCENARIOS。 */
export const RFI_SCENARIOS: Scenario[] = getRfiScenarios('tournament');
```

### 4.2 `index.ts` の API 追加

```ts
// src/core/ranges/index.ts
import { RFI_SCENARIOS, getRfiScenarios, getRfiRange } from './rfi';
import type { GameMode } from './mode';
import type { Scenario } from './types';

export * from './types';
export * from './expand';
export * from './mode';
export * from './yokosawa';
export { RFI_SCENARIOS, getRfiScenarios, getRfiRange };

export const ALL_SCENARIOS: Scenario[] = [...RFI_SCENARIOS]; // tournament 既定（後方互換）

/** id で scenario を取得（既定モード tournament）。後方互換のため残す。 */
export function getScenario(id: string): Scenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}

/** モード指定で scenario を取得。 */
export function getScenarioForMode(id: string, mode: GameMode): Scenario | undefined {
  return getRfiScenarios(mode).find((s) => s.id === id);
}
```

### 4.3 RFI 参照箇所の一覧と改修方針

| 参照ファイル | 現状 | 改修 |
|---|---|---|
| `src/core/ranges/rfi.ts` | starter ranges 手書き | §4.1 で全面差し替え |
| `src/core/ranges/index.ts` | `RFI_SCENARIOS` re-export | §4.2 で API 追加（`getScenarioForMode`, `getRfiRange`, mode/yokosawa re-export） |
| `src/pages/RangeTrainer.tsx` | `RFI_SCENARIOS` を直接使用（チャート/ドリル） | §7.1: モードセレクタ追加、`getRfiScenarios(mode)` に切替。`dealDrill(mode)` 化 |
| `src/pages/Home.tsx` | `getScenario(w.id)` で弱点ラベル取得 | **変更不要**（scenario id はモード非依存。tournament の label を表示すれば十分） |
| `src/core/ai/preflop.ts` | `RFI_SCENARIOS.find(...)` | §7.2: `getRfiScenarios(state.config.mode)` を参照。`state.config.mode` 経由 |
| `src/core/review/reviewHand.ts` | `getScenario('RFI_'+pos)` | §7.3: `getScenarioForMode('RFI_'+pos, hand.mode)` に切替 |

---

## 5. モード×ポジション → Range API（まとめ）

| API | 場所 | 用途 |
|---|---|---|
| `maxTierFor(mode, pos): number` | `mode.ts` | ポジションが使う最大tier(1..7、0=RFIなし) |
| `rfiHandClasses(mode, pos): HandClass[]` | `rfi.ts` | 累積ティア展開 |
| `getRfiRange(mode, pos): Range` | `rfi.ts` | pure-raise Range |
| `getRfiScenarios(mode): Scenario[]` | `rfi.ts` | 5ポジション分の Scenario |
| `getScenarioForMode(id, mode): Scenario \| undefined` | `index.ts` | id+mode で Scenario |
| `getScenario(id): Scenario \| undefined` | `index.ts` | 後方互換（tournament） |
| `getVsOpen(heroPos, villainPos): VsOpenScenario \| undefined` | `vsOpen.ts` | BB defense 等（mode 非依存） |

`Scenario` / `Range` / `HandAction` 型は既存（`types.ts`）をそのまま使う。**型の互換性は完全に維持**され、新規型は `GameMode` のみ。

---

## 6. エンジンの ante 対応（BB ante 方式）— `src/core/game/`

### 6.1 実装方式の確定

**BB ante** を採用する（現代トーナメント標準）。BB ante は「BB が自分のブラインドとは別に、テーブル全員分のアンティ（合計 1bb）をポットに投下する」方式。

- ante 合計 = `1bb`（モードがアンティありのとき）。BB の席が単独で 1bb を追加投下する。
- 各プレイヤーの個別アンティ徴収はしない（BB ante の利点＝計算が単純）。
- **アンティありモード**: `tournament` と `cash-ante`。**アンティなしモード**: `cash-noante`。
- ante は BB の `committedTotal` には加算するが、**BB の `committedStreet` には加算しない**（理由は §6.3）。

### 6.2 型変更（`types.ts`）

```ts
export type GameConfig = {
  difficulty: 'easy' | 'normal' | 'hard';
  mode: GameMode;             // ★追加。RFI/AI/レビューが参照
  startingStack: number;      // 既定 100
  sb: number;                 // 0.5
  bb: number;                 // 1
  /** BB ante 合計(bb)。0 = アンティなし。アンティありモードは bb と同額(=1)。 */
  ante: number;               // ★追加
  rng?: () => number;
};
```

`GameConfig` から `mode` を見て `ante` を決めるのは config 構築側（`useVersusGame` の `makeConfig`）の責務:

```ts
function anteForMode(mode: GameMode, bb: number): number {
  return mode === 'cash-noante' ? 0 : bb; // tournament / cash-ante は 1bb
}
```

### 6.3 `startHand` の変更点

現行 `startHand`（engine.ts 92–178行）のブラインド投下に ante を追加する。**BB ante はポット(dead money)であり、ストリートのベット額には影響しない**ため、`committedStreet` ではなく確定ポット `pot` に直接入れる。

変更点:

1. SB/BB のブラインド投下は現行どおり（`committedStreet` に sb/bb を反映、`currentBet = bbAmount`）。
2. **ante を BB 席から追加徴収**:
   - `anteAmount = Math.min(config.ante, bbPlayerStackAfterBlind)`（スタック不足ガード）。
   - BB の `stack -= anteAmount`、`committedTotal += anteAmount`。
   - `committedStreet` には加算しない（ante は「コールに必要な額」を増やさない＝プリフロップの `currentBet` は bb のまま）。
   - スタックが 0 になったら `status = 'allin'`。
3. 返り値の `pot` を **`anteAmount`** で初期化する（現行は `pot: 0`）。これにより ante は確定ポットに入り、`committedStreet`（ベッティングラウンド）と分離される。

```ts
// startHand 内、ブラインド投下後に追加するイメージ
const anteAmount = Math.min(config.ante ?? 0, /* BBのブラインド後スタック */);
// BB プレイヤーに反映: stack -= anteAmount, committedTotal += anteAmount, status調整
// return の pot を anteAmount で初期化
return {
  ...,
  pot: anteAmount,        // ★ ante を確定ポットへ
  currentBet: bbAmount,   // 変更なし
  ...
};
```

> **設計判断（ante を pot に入れ committedStreet に入れない理由）**: NLH の `currentBet` はそのストリートでコールに必要な total-commit 目標額。BB ante はデッドマネーでありコール額を増やさない。`pot` に直接入れることで、`advanceStreet` / `resolveShowdown` の既存ポット集計（`pot + ΣcommittedStreet`）が**そのまま正しく** ante を含む。`committedTotal` には入れるので、ヒーロー収支 `heroNet = winnings - committedTotal`（`useVersusGame`）も BB のとき ante 込みで正しくなる。

### 6.4 チップ保存性への影響（テスト）

- 不変条件: **全プレイヤーの `committedTotal` 合計 = 全プレイヤーが獲得した額の合計**（ハンド終了後）。ante を `committedTotal` に含めたので、ante 込みでこの恒等式が成立する。
- ハンド終了後: `Σ(stack_after) === 6 * startingStack`（誰も増減の総和は 0、ante も含めゼロサム）。
- `engine.test.ts` の既存「ブラインド投下後の currentBet/toAct/committedStreet」テストは ante=0（デフォルト）でこれまで通り通す。ante>0 の新規テストを §10 に追加。

### 6.5 後方互換

- `GameConfig.ante` / `mode` は **必須フィールド追加**だが、`GameConfig` を生成するのは `useVersusGame.makeConfig` とテストのみ（§0 の grep 結果より）。両方を更新すれば破綻しない。
- 既存 `engine.test.ts` / `ai.test.ts` の config リテラルに `mode: 'tournament', ante: 0` を補う（または `ante` を optional `ante?: number` にして `?? 0` で受ける手もあるが、**明示必須**を推奨——テストが ante を意識するため）。Sonnet は両テストの config を更新する。

---

## 7. UI / AI / レビューのモード対応

### 7.1 RangeTrainer（チャート閲覧 + ドリル）— `src/pages/RangeTrainer.tsx`

**モードセレクタを追加**し、チャート・ドリル両方で `getRfiScenarios(mode)` を使う。

- ページ上部（タブの隣 or 下）に3択モードセレクタ（`GAME_MODES` を `GAME_MODE_SHORT` ラベルで pill 表示。RangeTrainer 既存タブUI／Versus 難易度セレクタと同じ見た目: `bg-accent text-[#04221a]` がアクティブ）。
- `mode` state を `RangeTrainer` 親に持ち、`ChartView` / `DrillView` に props で渡す。
- `ChartView`: `const scenarios = getRfiScenarios(mode)`。シナリオ選択ボタンは `scenarios` から生成。
- `DrillView`: `dealDrill(mode)` でモードのレンジから出題。`expected = primaryAction(drill.scenario.range[drill.hand])`。
- **ティア構造（後ろの人数）表示**（要望2）: チャート閲覧の右 Panel に「ティア早見」を追加。
  - 選択中ポジションの `maxTierFor(mode, pos)` を表示し、「後ろ N人 → tier1〜tierK」を明示。
  - 各 tier を色分けチップ（tier1=紺 … tier7=紫、bbCall=ピンク、`yokosawa.ts` の元色に寄せる）で示し、ホバー or 常時でそのティアのハンド一覧を出す簡易リスト。
  - cash-noante のときは落ちたティアをグレーアウト表示（「アンティなしでは除外」注記）。
  - 実装は軽量で可: `TIERS` を map し、`index < maxTier` を active 色、それ以外を muted。専用コンポーネント `src/components/ranges/TierLegend.tsx`（任意・MVPは RangeTrainer 内ローカルで可）。
- `dealDrill` 改修:
  ```ts
  function dealDrill(mode: GameMode): Drill {
    const scenarios = getRfiScenarios(mode);
    const scenario = pick(scenarios);
    const [c1, c2] = shuffle(makeDeck()).slice(0, 2) as HoleCards;
    return { scenario, cards: [c1, c2], hand: cardsToHandClass(c1, c2) };
  }
  ```
- progress 記録（`recordRange(scenario.id, correct)`）は scenario id がモード非依存なので**そのまま**。byScenario の集計はモード混在になるが、要望9（モード別統計不要）に合致。

### 7.2 CPU プリフロップ AI — `src/core/ai/preflop.ts`

- `decidePreflopRFI` 内の `RFI_SCENARIOS.find((s) => s.heroPos === pos)` を `getRfiScenarios(state.config.mode).find(...)` に変更。
- import を `import { getRfiScenarios } from '../ranges/rfi'`（または `'../ranges'`）へ。`RFI_SCENARIOS` の直接 import は削除。
- vsOpen 参照（`getVsOpen`）は mode 非依存なので変更不要。
- open サイズは現行ロジック（SB=3, 他 2.5）を維持。

### 7.3 GTOレビュー — `src/core/review/reviewHand.ts`

- `reviewRFI` 内 `getScenario('RFI_'+heroPos)` を `getScenarioForMode('RFI_'+heroPos, hand.mode)` に変更（`hand.mode` は §8 で SavedHand に追加）。
- `buildVillainRangeFromLog` 内の `getScenario('RFI_'+openerPos)` も `getScenarioForMode('RFI_'+openerPos, hand.mode)` に変更（相手の推定レンジも同じモードのレンジで構築）。
- import を `getScenarioForMode` に切替。`getVsOpen` は mode 非依存で変更不要。
- 後方互換: `hand.mode` が無い旧データは migration（§8）で `'tournament'` 補完されるため、レビューは常に有効なモードを得る。

### 7.4 Versus 画面 — `src/pages/Versus.tsx` / `src/hooks/useVersusGame.ts`

- **モードセレクタ追加**（難易度セレクタと並ぶ第2セレクタ）。`GameTab` のヘッダ行に「モード:」ラベル + `GAME_MODES` の pill（`GAME_MODE_SHORT` ラベル）。難易度と同様、**次のハンドから適用**（`pendingMode` ref）。
- `useVersusGame` の変更:
  ```ts
  function makeConfig(difficulty, mode: GameMode): GameConfig {
    return {
      ...DEFAULT_CONFIG,
      difficulty,
      mode,
      ante: anteForMode(mode, DEFAULT_CONFIG.bb),
    };
  }
  ```
  - `mode` / `setMode` を `VersusController` に追加（difficulty と同形の pending パターン）。
  - `newHand` で `pendingMode.current` を使って config を作る。
  - SavedHand 保存時に `mode: state.config.mode` を含める（§8）。
- `VersusController` 型に `mode: GameMode; setMode: (m: GameMode) => void;` を追加。
- 履歴行（`HistoryRow`）にモードバッジを表示（任意・難易度バッジの隣に `GAME_MODE_SHORT[hand.mode]`）。

---

## 8. 履歴 SavedHand のモード追加 + migration — `src/store/history.ts`

```ts
import type { GameMode } from '../core/ranges/mode';

export type SavedHand = {
  id: string;
  ts: number;
  mode: GameMode;             // ★追加
  difficulty: GameConfig['difficulty'];
  heroPos: Position;
  heroHole: [Card, Card];
  board: Card[];
  log: HandLogEntry[];
  result: HandResult;
  heroNet: number;
};
```

- persist の `version` を **1 → 2** に上げ、`migrate` を追加して旧ハンドに `mode: 'tournament'` を補完:
  ```ts
  {
    name: 'poker-trainer-history',
    version: 2,
    migrate: (persisted: unknown, version: number) => {
      const state = persisted as { hands?: SavedHand[] };
      if (version < 2 && state?.hands) {
        state.hands = state.hands.map((h) => ({ mode: 'tournament' as GameMode, ...h }));
      }
      return state as HistoryState;
    },
  }
  ```
- `useVersusGame` の SavedHand 構築に `mode: state.config.mode` を追加。
- `reviewHand(hand)` は `hand.mode` を参照（§7.3）。

---

## 9. progress ストアへの影響

**変更不要**。要望どおりモード別統計は持たない。

- `recordRange(scenarioId, correct)` の scenarioId はモード非依存（`RFI_UTG` 等）なので、モードをまたいで同一シナリオに集計される。これは仕様（モード別集計は不要）。
- `Home.tsx` の `OverallStat` / 弱点表示も変更不要。
- 本セクションは「変更しない」ことの明示。

---

## 10. テスト方針

新規/更新するテスト（Vitest、`src/core/**/*.test.ts`）。すべて `config.rng` を固定 or 純データ検証で決定的に。

### 10.1 ティアデータの正当性 — `src/core/ranges/yokosawa.test.ts`（新規）
- TIER1〜TIER7 + BB_CALL の全要素が `ALL_HAND_CLASSES` に含まれる（有効な HandClass）。
- 全ティア・bbCall を通じて **重複が無い**（同一ハンドが複数層に出現しない）。
- 各ティアの件数が ground truth と一致（tier1=6, tier2=7, tier3=10, tier4=14, tier5=10, tier6=22, tier7=13, bbCall=27）。

### 10.2 モード別レンジ取得 — `src/core/ranges/mode.test.ts` / `rfi.test.ts`（新規）
- `maxTierFor`: tournament/cash-ante は UTG=5/CO=6/BTN=7/SB=7、cash-noante は UTG=4/CO=5/BTN=6/SB=6。BB=0。
- `getRfiRange('cash-noante','UTG')` に tier5 のハンド（例 `'A9o'`, `'22'`）が**含まれない**こと、tier4 のハンド（例 `'A2s'`, `'ATo'`）が**含まれる**こと。
- `getRfiRange('cash-noante','BTN')` に tier7 のハンド（例 `'54s'`, `'A6o'`）が含まれず、tier6（例 `'K2s'`, `'KTo'`）が含まれること。
- `getRfiRange('tournament','BTN')` ⊇ `getRfiRange('cash-noante','BTN')`（包含関係）。
- `getRfiScenarios(mode)` が 5件、id が `RFI_<pos>`、`heroPos` 一致。

### 10.3 BB defense — `vsOpen.test.ts`（更新）
- `getVsOpen('BB','BTN')`: `AA/KK/QQ/JJ/AKs/AKo` が `raise`、`A5s/A4s` が `raise`（bluff）、`A3s` や `T8s` 等は `call`、bbCall 層（例 `'A2o'`, `'87o'`）が `call`。
- raise と call が同一ハンドに同時に立たない（raise 優先）。

### 10.4 ante / チップ保存性 — `src/core/game/engine.test.ts`（更新・追加）
- ante=0（デフォルト）で既存テストが通る（回帰）。
- ante=1（BB ante）の `startHand`: 返り値 `pot === 1`、BB の `stack === startingStack - bb - 1`、BB の `committedTotal === bb + 1`、`committedStreet === bb`、`currentBet === bb`（ante はコール額に影響しない）。
- ante=1 のハンドを最後まで進めた後: `Σ stack_after === 6 * startingStack`（ゼロサム保存）。
- ante=1 で UTG オープン→全員フォールド: ポット（ante 込み）がオープナーへ、`heroNet`/`committedTotal` 恒等式が成立。

### 10.5 AI / レビューのモード参照 — `ai.test.ts` / `reviewHand.test.ts`（更新）
- `decideCpu` が `mode: 'cash-noante'` の config でも常に合法アクションを返す（既存ランダム局面テストに mode バリエーションを追加）。
- `reviewHand`: `mode: 'cash-noante'` の合成 SavedHand で、tier5 のハンド（UTG で `'22'`）を open → cash-noante では `mistake`、tournament では `good` になること（モードでレンジが切り替わる確証）。

---

## 11. フェーズ分割（Sonnet向け作業計画）

各フェーズ末で `npm run build` と `npm run test` が通る独立単位。依存順: R1 → R2 → R3。

### R1 — コア/データ（純TS、UIなし）
- `src/core/ranges/yokosawa.ts`（§1 ティアデータ literal）+ `yokosawa.test.ts`（§10.1）。
- `src/core/ranges/mode.ts`（§2 `GameMode` / `maxTierFor` / ラベル）+ `mode.test.ts`（§10.2）。
- `src/core/ranges/rfi.ts` 全面差し替え（§4.1）+ `rfi.test.ts`（§10.2）。
- `src/core/ranges/index.ts` API 追加（§4.2）。
- `src/core/ranges/vsOpen.ts` の BB vs BTN 差し替え（§3.2）+ `vsOpen.test.ts` 更新（§10.3）。
- この時点で AI/レビュー/UI は `RFI_SCENARIOS`（tournament 既定）参照のまま壊れない（後方互換 export）。

### R2 — エンジン ante + AI/レビューのモード参照
- `src/core/game/types.ts`: `GameConfig` に `mode` / `ante` 追加（§6.2）。
- `src/core/game/engine.ts`: `startHand` の ante 投下（§6.3）。
- `engine.test.ts` の config に `mode/ante` 補完 + ante テスト追加（§6.5, §10.4）。
- `src/core/ai/preflop.ts`: `getRfiScenarios(state.config.mode)` 参照（§7.2）。`ai.test.ts` の config 補完（§6.5, §10.5）。
- `src/core/review/reviewHand.ts`: `getScenarioForMode(..., hand.mode)` 参照（§7.3）。
- `src/store/history.ts`: `SavedHand.mode` 追加 + version 2 migration（§8）。`reviewHand.test.ts` 更新（§10.5）。
- `src/hooks/useVersusGame.ts`: `makeConfig` に mode/ante、`mode`/`setMode`、SavedHand に mode（§7.4, §8）。
- この時点でビルド可。Versus UI はまだ mode セレクタ無し（normal/tournament 固定）でも動作する。

### R3 — UI（モードセレクタ + ティア表示）
- `src/pages/RangeTrainer.tsx`: モードセレクタ + `getRfiScenarios(mode)` + ティア早見表示（§7.1）。任意で `src/components/ranges/TierLegend.tsx`。
- `src/pages/Versus.tsx`: モードセレクタ（難易度と並ぶ）+ 履歴モードバッジ（§7.4）。
- `Home.tsx`: 変更不要（確認のみ）。

各フェーズ独立にビルド/テスト可能。R1 は純データで完結。R2 はエンジン+ロジック。R3 は UI のみ。

---

## 12. 既存ドキュメントとの整合

- DESIGN §6 starter ranges は本ドキュメントで **置換**される旨を DESIGN 側に追記する必要はない（DESIGN は変更しない方針）。本 RANGES-V2.md が RFI レンジの新しい source of truth。`docs/DESIGN.md` §2.5 の `Scenario`/`Range` 型はそのまま有効。
- VERSUS.md §D4.4 vsOpen の方針と整合（BB vs BTN のみ差し替え、他維持）。
- DRILLS-V2.md の progress 拡張・ナビは無関係（本変更は progress を触らない）。
</content>
</invoke>
