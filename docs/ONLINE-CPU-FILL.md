# ONLINE-CPU-FILL — オンライン対戦の CPU 席補完 & タイムアウト強制退出 設計ドキュメント

既存の「オンライン対戦（部屋制トーナメント）」に 2 つの機能を足す設計。

- **機能A: CPU 席補完** — 人数が揃わなくても、席を CPU で最大 6 人まで埋めて開始できる。CPU の強さ（やさしい / ふつう / つよい）はホストが選べる。
- **機能B: タイムアウト連続による強制退出** — 制限時間切れが連続したプレイヤーを自動でテーブルから退出させる。

本ドキュメントは **Sonnet が単独で実装着手できる粒度**（追加/変更する型・関数シグネチャ・変更対象ファイルと具体的な変更内容・行番号・テスト項目・フェーズ分割・運用手順）まで具体化したもの。実装コード本体は含まない（掲載するコード片は「仕様」であり、逐語のロジックはヘルパー名・入出力・呼び出し箇所で表現する）。

本機能の設計判断は Fable5（レビュー担当）が実コードを精査して**確定済み**であり、実装フェーズで再設計しないこと。設計変更が必要になった場合は本ドキュメントを先に更新してからコードに反映する。

---

## 前提（変更禁止 / 不変条件）

- 土台となる設計は `docs/ONLINE-VERSUS.md`。本機能はその上への**追加**であり、既存のサーバー権威型フロー・RLS 方針・楽観ロック（`room_engine.version`）・Realtime 購読を壊さない。
- `src/core/`（`src/core/online/*` を含む）は **React・Supabase・Node/Browser API に一切依存しない純 TS** を維持する。`sync:functions` で Deno Edge Function に共有されるため（機能A-9）。
- **最重要の回帰条件**: `supabase === null`（env 未設定）のとき、`/online` は案内表示のみ・**既存の全機能（学習ドリル・vs CPU 単発/セッション）がゲスト（localStorage）で完全動作**する。本機能の追加後もこれを維持する。
- **スキーマ変更なし**: 新テーブル・新カラム・新マイグレーションは**不要**。CPU は DB の `room_players`（`uid` 列が `auth.users` への FK）に一切入れず、`TournamentState`（`room_engine.state` / `room_states.tournament` の jsonb）内にのみ存在する。運用は「`sync:functions` → `online-room` の再デプロイ」だけで完結する（§運用手順）。
- UI 言語は日本語。ポーカー用語（open, raise, call, check, fold, bet, all-in, blind, ante 等）は英語のまま。
- `docs/ONLINE-VERSUS.md` / `docs/V3-PLATFORM.md` / `docs/VERSUS.md` は本作業では変更しない。

---

## 0. スコープ / ゴール / 非ゴール

### ゴール
- ホストが「CPU で 6 人まで埋める」を有効化して部屋を作ると、開始時に空席が CPU で埋まり、人間 1 人でもトーナメントを開始できる。
- CPU はサーバー権威で自動打ちし、他プレイヤーには 1 手ずつ Realtime で配信される（人間と見分けのつく表示名「CPU 1」等）。
- 人間が全員バスト/離席して生存者が CPU だけになったら、トーナメントを即終了して順位を確定する。
- 制限時間切れが 3 回連続した人間プレイヤーを自動でテーブルから退出させる（放置席がハンドを止め続けるのを防ぐ）。

### 非ゴール（§将来課題）
- CPU 席を後から人間が置き換える（席の引き継ぎ）。
- CPU の人数・強さを**開始後**に変更する。
- 強制退出の理由をクライアントに個別表示する UI（既存の `status='left'` 表示で足りる）。
- 観戦・チャット・複数卓など `docs/ONLINE-VERSUS.md §16` の将来課題。

---

## 1. 確定設計判断サマリ

| 論点 | 決定 | 根拠 |
|---|---|---|
| CPU の識別 | 合成 uid `cpu:1`〜`cpu:5`。実 uid(UUID) は `:` を含まないため衝突しない。判定は `isCpuUid(uid)` を `tournament.ts` に追加しクライアント/サーバー両方から import | uuid 型 DB カラムに混ざらない・純関数で判定を一元化 |
| CPU の格納場所 | `room_players` には**入れない**（`uid` が `auth.users` FK）。`TournamentState.players` にのみ存在。`displayName='CPU N'` | FK 制約・スキーマ変更回避 |
| CPU 強さ | 既存 `TournamentConfig.difficulty`（`'easy'|'normal'|'hard'`）を流用。`setupHand` が `GameConfig.difficulty` に流し、サーバー `decideCpu` が `state.config` から読む | 追加フィールド不要 |
| CPU 有効化 | `TournamentConfig` に `cpuFill?: boolean` を追加。`buildTournamentConfig`（rooms.ts:91）で正規化 | 最小の設定追加 |
| CPU 行動の駆動 | サーバーは自発的に動けないため、`next_hand`/`claim_timeout` と同じ「任意クライアントが先着 invoke・version で冪等」パターン。新アクション `cpu_action`。1 invoke = 1 CPU アクション | 無料枠方針（専用スケジューラ無し）・1 手ずつ Realtime 配信されて演出上も自然 |
| CPU の rng | `room_engine.state.hand` は jsonb 経由で `config.rng`（関数）が落ちる。`decideCpu` 前に `cryptoRng()` を再注入 | `decideCpu` は `state.config.rng ?? Math.random` を読む |
| 全員 CPU 化 | 生存者に人間が 0 なら `finishIfOnlyCpusLeft` で即終了・順位確定 | 人間不在のテーブルを回し続けない |
| 途中参加ガード | CPU 補完で tournament が満席(6)でも `room_players` に空席が残るバグを、`addLatePlayer` の no-op 検知で `room_full` を throw して塞ぐ | 既存 catch 節のクリーンアップに乗る |
| タイムアウト強制退出 | `OnlinePlayer.timeoutStreak` を加算、`FORCED_LEAVE_TIMEOUT_STREAK=3` で退出。自発アクションで 0 リセット。CPU は加算対象外 | 放置席の排除。人間のみ対象 |
| ai/ の同期 | `sync:functions` の `SOURCE_DIRS` に `'ai'`、`SOURCE_FILES` に `'potOdds.ts'` を追加 | `ai/postflop.ts` が `../potOdds` を import（下記検証） |
| DB スキーマ | 変更なし。マイグレーション不要 | CPU は jsonb 内のみ |

---

## 2. 最重要不変条件（回帰テスト対象）

1. env 無し（`supabase === null`）で `npm run build` / 既存 Vitest がすべて緑、`/online` は案内表示のみ、学習ドリル・vs CPU がゲスト動作する。
2. CPU の合成 uid（`cpu:N`）が **uuid 型の DB カラムに一度も書かれない**。具体的には `room_players`（stack/status/finish_rank 同期・connected 更新）と `room_hole_cards`（hole insert）で CPU uid をスキップする。違反すると Postgres の型エラーで進行が壊れる。
3. 公開状態（`room_states.public`）に他人（人間・CPU 問わず）のホールカードがショーダウン公開分以外は載らない（既存 `toPublicState` の不変条件を維持。CPU 追加で崩さない）。
4. `cpuFill` が無効なら挙動は現状と完全一致（`cpuFill` 省略時 `false`。人間 2 人未満は開始不可のまま）。

---

## 3. 既存コード検証結果（実コードを読んで確認 — 変更の土台）

実装前に以下を確認済み。行番号は本ドキュメント作成時点。

### 3.1 `src/core/online/tournament.ts`（純 TS）
- `OnlinePlayer`（:13）: `uid/displayName/seat/stack/status/finishRank/bustedHand/stackCurve/stackCurveHands/pendingLeave?` を持つ。→ **機能B** で `timeoutStreak?: number` を追加。
- `TournamentConfig`（:4）: `startingStack/blindLevels/handsPerLevel/difficulty?`。→ **機能A** で `cpuFill?: boolean` を追加。
- `startTournament(seats, config)`（:52）: `seats` を seat 昇順で `OnlinePlayer` 化。**CPU エントリを seats に混ぜてもそのまま動く**（uid 文字列を特別扱いしていない）。
- `setupHand(t)`（:87）: `config.difficulty ?? 'normal'` を `GameConfig.difficulty` に流す（:98）。→ CPU 強さがここを通ってサーバー `decideCpu` に届く。
- `markLeft`（:228） / `markLeavingDuringHand`（:287） / `applyHandResult`（:117） / `addLatePlayer`（:296、満席は `t.players.length >= 6` で no-op → :302） / `canContinue`（:319） / `standings`（:323）。

### 3.2 `supabase/functions/_shared/rooms.ts`（Deno・service role）
- `buildTournamentConfig(input)`（:91）: 各フィールドを clamp して `TournamentConfig` を組む。→ `cpuFill` を追加。
- `startGame`（:428）: `room_players` を seat 昇順で取得 → `players.length < 2` で `illegal_action`（:443）→ `startTournament` → `setupHand` → `startHand` → `persistNewHand`。
- `playerAction`（:470）: version 検証 → `applyAction` → `progressToActionable` → `persistHandTransition`（:511）。tournament は無変更で渡している。→ **機能B** で streak リセットを挟む。
- `claimTimeout`（:553）: 締切超過時に対象 toAct を強制 check/fold → `persistHandTransition`（:597）。→ **機能B** で streak 加算・退出を挟む。
- `persistHandTransition`（:622）: `names` を `room_players` から構築（:691）、`room_players` の stack/status/finish_rank を全員分ループ更新（:721）。ショーダウン確定時 `applyHandResult`（:646）。
- `persistNewHand`（:742）: `names` を `room_players` から構築（:775）、`room_players` を全員分ループ更新（:795）、`room_hole_cards` を uids ループで insert（:804）。
- `leaveRoom`（:345）: プレイ中は `resolveLeaveDuringHand` → `markLeavingDuringHand`/`markLeft` → `persistHandTransition`。
- `joinPlayingRoom`（:213）: `addLatePlayer` の戻りが no-op（満席）でも検知していない。→ **機能A-8** で塞ぐ。
- 共有: `progressToActionable`（engine-driver.ts）、`cryptoRng`（crypto-rng.ts, :21 で import 済み）、`resolveLeaveDuringHand`（roomsLogic.ts）。
- `EngineState = { tournament: TournamentState; hand: GameState | null }`（:46）。

### 3.3 `supabase/functions/online-room/index.ts`（ルーター）
- `OnlineRequest`（:11）ユニオン + `Deno.serve` の `switch (body.action)`（:65）。→ `cpu_action` を両方へ追加。

### 3.4 `src/core/ai/`（CPU 決定ロジック）
- `decideCpu(state, playerId)`（ai/index.ts:10）: `const rng = state.config.rng ?? Math.random`（:13）。**rng は `state.config` から読む**（引数で渡さない）→ サーバーは `hand.config.rng` を再注入する必要がある。
- import グラフ（検証済み）: `ai/*` は `evaluator` / `cards` / `handNotation` / `ranges/*` / `game/*` に加え `ai/postflop.ts` が `../potOdds`（`src/core/potOdds.ts`）を import。`ai/estimateEquity.ts` は `Math.random` を既定引数に持つが、サーバー実行でもシードが観測不能なため予測可能性の懸念なし。→ `sync:functions` に `ai` と `potOdds.ts` を追加すれば依存は充足（機能A-9）。

### 3.5 クライアント
- `src/lib/onlineClient.ts`: `OnlineRequest`（:9）と action ごとの薄いラッパ関数（:74 以降）。→ `cpu_action`（`cpuAction`）を追加。
- `src/hooks/useOnlineRoom.ts`: `claim_timeout` を「(handNumber, actionDeadline) キーで一度だけ発火・エラー握りつぶし」で駆動する effect（:530）。`act`（:345）等の action ラッパ。→ 同型の CPU 駆動 effect を追加。**型以外の core 関数を呼ぶ場合はコメントで許可を明記**する慣習（:29-36）に倣い、`isCpuUid` の value import を許可対象に加える。
- `src/components/online/OnlineLobby.tsx`: 作成フォーム `PreRoomLobby`（:68、`handleCreate` は `{ startingStack: stack }` を渡す :113）、ロビー `InRoomLobby`（:220、開始ボタン disabled は `players.length < 2` :314）。
- `src/store/online.ts`: `roomConfig` は `TournamentConfig` 型（`cpuFill`/`difficulty` を自動的に運ぶ）。`RoomPlayerRow` は `uid/display_name/connected/...`。

---

## 4. 機能A: CPU 席補完

### 4.1 CPU uid 規約と判定ヘルパー（core）

`src/core/online/tournament.ts` に追加:

```ts
/** CPU の合成 uid か判定する。実 uid(UUID) は ':' を含まないため衝突しない。
 *  規約: 'cpu:1' 〜 'cpu:5'（席の埋め番号）。クライアント/サーバー両方から使う。 */
export function isCpuUid(uid: string): boolean; // 実装: uid.startsWith('cpu:')
```

- CPU の displayName は `'CPU 1'` 〜 `'CPU 5'`（uid の番号と一致）。
- CPU は `room_players` に**入れない**。`TournamentState.players` にのみ存在する。

### 4.2 設定フィールド（core / サーバー）

`TournamentConfig`（tournament.ts:4）に追加:
```ts
cpuFill?: boolean; // true で開始時に空席を CPU で 6 人まで埋める。省略時 false。
```
CPU 強さは既存 `difficulty?: GameConfig['difficulty']` を流用（追加フィールドなし）。

`buildTournamentConfig`（rooms.ts:91）に `cpuFill` の正規化を追加:
- `cpuFill: input.cpuFill === true`（真偽の明示化。未指定/非真は false）。
- `difficulty` は既に `input.difficulty ?? 'normal'` で clamp 済み（そのまま）。

### 4.3 start_game での CPU 席補完（サーバー）

`startGame`（rooms.ts:428）を変更:

1. `room.config as TournamentConfig` から `cpuFill` / `difficulty` を取得。
2. 人間の seats（`room_players` から取得済み・seat 昇順）を `humanSeats` とする。
3. `cpuFill` 有効時、`humanSeats` の**最大 seat の次の空き番号**から `cpu:N`（N は 1 始まりの連番）を、合計 6 人になるまで追加する。各 CPU エントリ:
   - `uid = 'cpu:' + N`、`displayName = 'CPU ' + N`、`seat = 次の空き seat 番号`。
   - seat 割当は「人間の最大 seat 以降の空き番号を昇順に埋める」（人間 seat と衝突しないこと）。
4. 人数チェックを緩和:
   - `cpuFill` 有効: **人間 >= 1 かつ 合計(人間+CPU) >= 2** を要求。満たさなければ `illegal_action('need at least 2 players')`。
   - `cpuFill` 無効: 現状どおり **人間 >= 2**（CPU 数 0 なので上記条件と一致する形で表現してよい）。
5. `startTournament(seats, config)` に **人間 + CPU の合成 seats** を渡す（`startTournament` は uid を特別扱いしないためそのまま動く）。
6. 以降（`setupHand` → `startHand` → `persistNewHand`）は現状のまま。CPU は tournament.players に載り、`persistNewHand` の各同期ループは §4.6 の修正で CPU をスキップする。

### 4.4 新アクション `cpu_action`（サーバー駆動）

`rooms.ts` に追加:
```ts
export async function cpuAction(
  db: SupabaseClient,
  uid: string,
  roomId: string,
  expectedVersion: number,
): Promise<{ version: number }>;
```

処理（`playerAction` / `claimTimeout` を参考にした順序）:
1. `assertRoomMember(db, roomId, uid)`（呼び出し元の認可。CPU 自身ではなく人間クライアントが代理 invoke する）。
2. `room_engine` を SELECT。無ければ `not_in_hand`。
3. `engineRow.version !== expectedVersion` → `stale`。
4. `{ tournament, hand } = engineRow.state`。`hand === null` → `not_in_hand`。
5. `seatUids = engineRow.seat_uids`。`seatIndex = seatUids[hand.toAct]` を見て、`hand.toAct` の席の uid が **CPU でない**（`!isCpuUid(seatUids[hand.toAct])`）なら **no-op success**（`{ version: engineRow.version }` を返す）。
   - 複数クライアントが同時に CPU を駆動しても、先着 1 回が version を進め、残りはこの no-op か `stale` に静かに吸収される。
6. **rng 再注入（必須）**: `room_engine.state.hand` は jsonb 経由で `config.rng` が落ちている。
   ```ts
   const handForAi = { ...hand, config: { ...hand.config, rng: cryptoRng() } };
   ```
7. `const move = decideCpu(handForAi, hand.toAct)` で **1 アクションだけ**決定。
8. `let newHand = applyAction(hand, hand.toAct, move); newHand = progressToActionable(newHand);`
   - `applyAction` には rng 再注入前の `hand` を渡してよい（`applyAction` はシャッフルを行わずボード配布も `progressToActionable` 内の `advanceStreet` が担う。ボード配布に rng が要る場合は §注記）。
   - **注記**: `progressToActionable`（advanceStreet）でボードを引く際に rng が必要なら、`newHand` 側にも rng を保持させる必要がある。`applyAction(handForAi, ...)` を使い rng 付き state を進めること（`decideCpu` と同じ `handForAi` を土台に applyAction する）。実装時に engine-driver のボード配布経路を確認し、rng 付き state で `progressToActionable` を通すこと。
9. `return persistHandTransition(db, roomId, tournament, newHand, seatUids, expectedVersion);`
   - 1 invoke で 1 CPU アクションのみ。次も CPU 手番ならクライアントが再度 `cpu_action` を駆動する。アクション毎に `room_states` が更新され、他プレイヤーに 1 手ずつ Realtime 配信される。

`index.ts` のルーターと `OnlineRequest` に追加:
```ts
// OnlineRequest ユニオンに:
| { action: 'cpu_action'; roomId: string; version: number }
// switch に:
case 'cpu_action':
  return json({ ok: true, data: await rooms.cpuAction(db, uid, body.roomId, body.version) });
```

### 4.5 クライアント側の CPU 駆動（useOnlineRoom）

`src/hooks/useOnlineRoom.ts` に、既存 `claim_timeout` effect（:530）と同型のガード付き effect を追加:
- 発火条件: `phase === 'in_hand'` かつ `publicState.toAct != null` かつ `isCpuUid(publicState.players[publicState.toAct].uid)`。
- 約 **1.2 秒**のディレイ後に `cpuAction(roomId, version)` を invoke（演出上の間）。
- **一度だけ発火のガード**: `(handNumber, version)` をキーにした ref（`cpuActionKeyRef` など、`timeoutClaimKeyRef` と同じ手法）で、同じ手番に対して二重 invoke しない。
- エラー（`stale` / `not_in_hand` 等）は握りつぶす（`claimTimeout` ラッパと同様、他クライアントが先着した可能性があるため）。
- クリーンアップ: ディレイ用 `setTimeout` を effect の return でクリアし、`disconnect()` でも ref をリセット。
- `onlineClient.ts` に `cpuAction(roomId, version)`（§4.7）を追加し、本フックへ `cpuAction as apiCpuAction` として import。
- `isCpuUid` は core の value import。ファイル冒頭の「呼び出しを許可された core 関数」コメント（:29-36）に `isCpuUid` を追記する（`canContinue`/`legalActions` に並ぶ 3 つ目）。

### 4.6 共通ヘルパーの CPU スキップ（サーバー・回帰上の必須）

**目的**: CPU の合成 uid を uuid 型の DB カラムに入れない（§2-2）。加えて CPU の表示名を公開状態に載せる。

`persistHandTransition`（rooms.ts:622）と `persistNewHand`（:742）の両方で:

1. **`names` マップの構築元を変更**（:691 と :775）: `room_players` からではなく `tournament.players`（`newTournament.players` / `tournament.players`）から `uid -> displayName` を作る。CPU の表示名を含めるため。
   ```ts
   const names: Record<string, string> =
     Object.fromEntries(t.players.map((p) => [p.uid, p.displayName]));
   ```
   （`toPublicState(publicHand, publicSeatUids, names)` に渡す names がこれになる。）
2. **`room_players` 同期ループで CPU をスキップ**（:721 と :795）: `for (const p of ...players)` の各反復先頭で `if (isCpuUid(p.uid)) continue;`。CPU の stack/status/finish_rank は `TournamentState`（jsonb）内にのみ保持し、`room_players` には書かない。
3. **`room_hole_cards` insert ループで CPU をスキップ**（persistNewHand :804）: `for (let i...)` 内で `if (isCpuUid(uids[i])) continue;`。CPU のホールは `room_engine.state.hand`（jsonb）内にのみ存在し、それで足りる（サーバー `decideCpu` はそこから読む）。

### 4.7 クライアント lib（onlineClient.ts）

`OnlineRequest`（:9）に `cpu_action` を追加し、ラッパ関数を追加:
```ts
| { action: 'cpu_action'; roomId: string; version: number }

export function cpuAction(roomId: string, version: number) {
  return invokeOnline<{ version: number }>({ action: 'cpu_action', roomId, version });
}
```
`OnlineErrorCode` への追加は**不要**（cpu_action は既存の `stale` / `not_in_hand` のみ返す）。

### 4.8 クライアント UI（OnlineLobby.tsx）

`PreRoomLobby`（部屋作成フォーム、:68）:
- state を追加: `cpuFill: boolean`（既定 false）、`difficulty: 'easy'|'normal'|'hard'`（既定 `'normal'`）。
- 「部屋を作る」Panel（:170）内に:
  - チェックボックス「CPU で 6 人まで埋める」（`cpuFill` をトグル）。
  - `cpuFill` が true のときのみ「CPU の強さ」`select`: **やさしい↔easy / ふつう↔normal / つよい↔hard**。
- `handleCreate`（:109）の `onCreateRoom` 呼び出しを `{ startingStack: stack, cpuFill, difficulty: cpuFill ? difficulty : undefined }` に拡張（`cpuFill` 無効時は difficulty を送らない、またはサーバー clamp に任せて 'normal' 既定でも可）。

`InRoomLobby`（ロビー、:220）:
- 参加者一覧の**下**に、`cpuFill` 有効時のみ「開始時に追加される CPU 数」を表示。
  - 例: `開始時に CPU × 4 が追加されます（ふつう）`。
  - CPU 数はロビーの人間数から動的に計算: `cpuCount = roomConfig?.cpuFill ? Math.max(0, 6 - players.length) : 0`。強さ表示は `roomConfig.difficulty` を日本語ラベルへ写像。
- 開始ボタン disabled 条件（:314）を緩和: `cpuFill` 有効なら人間 1 人でも開始可。
  - 変更後: `disabled = busy || players.length < 1 || (!roomConfig?.cpuFill && players.length < 2)`。

`OnlineTable` / `SeatView` 等の**席表示は変更不要**であることを明記する: CPU の uid は `myUid` と一致しない（`isHero` が付かない）ため、他プレイヤーと同じ face-down 表示で正しく描画される。displayName は公開状態（`toPublicState` の names 経由）に載るので既存表示のまま「CPU N」が出る。

### 4.9 全員 CPU で終了（core + サーバー）

`tournament.ts` に追加:
```ts
/** 生存者(status==='playing')に人間が 1 人も居ない場合、トーナメントを即終了して順位を確定する。
 *  - 残存 CPU をスタック降順(同額は seat 昇順)で並べ、finishRank を上位から連番付与
 *    (最大スタック=現時点で最上位の rank)。
 *  - status='finished'、winnerUid=最大スタック CPU。
 *  - 人間が 1 人でも生存していれば t をそのまま返す(no-op)。
 *  pendingLeave 中の人間は status==='playing' のままなので「人間が残っている」扱いになり誤終了しない。 */
export function finishIfOnlyCpusLeft(t: TournamentState): TournamentState;
```
順位規則: 生存者が全員 CPU のとき、それらは残っている最上位のランク（1..S）を占める（既にバスト済みのプレイヤーは applyHandResult 規則で下位ランクを保持済み）。生存 CPU を `(stack DESC, seat ASC)` で並べ、`finishRank = 1..S` を割り当て、`winnerUid` = 先頭（最大スタック）CPU、`status='finished'`。

呼び出し箇所（サーバー rooms.ts）:
- `leaveRoom`（:345）: ハンド外/ハンド中いずれの `markLeft` / `markLeavingDuringHand` 適用後、`persistHandTransition` に渡す `newTournament` に対して `finishIfOnlyCpusLeft` を適用する。
- `claimTimeout` の強制退出パス（機能B）: 人間を退出させた後の tournament に適用してから `persistHandTransition`。
- `persistHandTransition` の `applyHandResult` 後（:646 直後）: `newTournament = finishIfOnlyCpusLeft(applyHandResult(...))` とする。
  - `in_hand` 継続ブランチ（`applyHandResult` を呼ばない経路）では、退出処理側が既に適用済みなので二重適用は冪等（人間生存中は no-op）。

### 4.10 途中参加のガード（サーバー・機能A に伴うバグ修正）

`joinPlayingRoom`（rooms.ts:213）: `addLatePlayer` が満席（`t.players.length >= 6`）で no-op すると、tournament に入れないまま `room_players` には空 seat があるため入室成功してしまう（CPU が席を占有している場合に発生）。

修正: `addLatePlayer` 適用後、**players 数が増えていない**（`newTournament.players.length === currentTournament.players.length`）場合は `throw new OnlineError('room_full')` する。既存の catch 節（:304-309）が insert 済み `room_players` 行を削除するので、そのクリーンアップに乗る。

> 将来課題: CPU 席を人間が置き換える仕組み（席の引き継ぎ）は本機能のスコープ外。§将来課題に記載。

### 4.11 sync スクリプト（機能A-9）

`scripts/sync-functions.mjs`:
- `SOURCE_DIRS`（:18）に `'ai'` を追加 → `['ranges', 'game', 'online', 'ai']`。
- `SOURCE_FILES`（:17）に `'potOdds.ts'` を追加 → `['cards.ts', 'evaluator.ts', 'handNotation.ts', 'potOdds.ts']`。
- 根拠: `ai/postflop.ts` が `../potOdds` を、`ai/*` が `evaluator/cards/handNotation/ranges/game` を import（すべて同期済み or 上記追加で充足、§3.4 で検証済み）。相対 import への `.ts` 付与は既存の `rewriteRelativeImports` が担うため追加処理不要。

---

## 5. 機能B: タイムアウト連続による強制退出

### 5.1 型追加（core）

`OnlinePlayer`（tournament.ts:13）に追加:
```ts
timeoutStreak?: number; // 連続タイムアウト回数。省略時 0 扱い(旧データ互換のため optional)。
```
`startTournament` / `addLatePlayer` の初期化では未設定でよい（`?? 0` で扱う）。

### 5.2 純関数（core・Vitest 対象）

`tournament.ts` に追加:
```ts
/** uid の timeoutStreak を +1 して返す。streak は更新後の値。対象が居なければ t 不変・streak 0。 */
export function bumpTimeoutStreak(
  t: TournamentState,
  uid: string,
): { tournament: TournamentState; streak: number };

/** uid の timeoutStreak を 0 にリセットして返す(自発アクション時)。対象が居なければ t 不変。 */
export function resetTimeoutStreak(t: TournamentState, uid: string): TournamentState;
```
- `bumpTimeoutStreak`: `(player.timeoutStreak ?? 0) + 1`（旧データ=フィールド無しからの加算に対応）。純関数で players を map 更新。
- `resetTimeoutStreak`: 対象の `timeoutStreak` を 0 に。

### 5.3 しきい値定数（サーバー）

`rooms.ts` にモジュール定数:
```ts
const FORCED_LEAVE_TIMEOUT_STREAK = 3;
```

### 5.4 claimTimeout の変更（サーバー）

`claimTimeout`（rooms.ts:553）で、強制 check/fold を `applyAction` + `progressToActionable` した後（:594-595 の後）:
1. 対象 `targetUid` が**人間**（`!isCpuUid(targetUid)`）なら `bumpTimeoutStreak(tournament, targetUid)` で streak を +1。CPU は加算しない（CPU 手番でも claim_timeout はフォールバックとして機能するが streak は無関係）。
2. `streak >= FORCED_LEAVE_TIMEOUT_STREAK`（=3）なら**強制退出**:
   - `leaveRoom` と同じ経路で退出処理する: `resolveLeaveDuringHand(newHand, seatUids, targetUid)`（roomsLogic.ts）→ `{ hand, pendingLeave }` を得て、`hand` があれば `progressToActionable` を通す。
   - tournament を `pendingLeave ? markLeavingDuringHand(bumped, targetUid) : markLeft(bumped, targetUid)` で更新。
   - `finishIfOnlyCpusLeft(...)` を適用（人間退出で残りが CPU のみになった場合の即終了）。
   - `persistHandTransition(db, roomId, leftTournament, leftHand, seatUids, engineRow.version)` を**1 回だけ**呼ぶ。
   - `room_players` の該当行は `connected=false` に更新（status/finish_rank/stack は `persistHandTransition` の同期ループが `TournamentState` から反映する。leaveRoom の pendingLeave 分岐と同じ考え方 :405-414）。
3. `streak < 3` なら従来どおり `persistHandTransition(db, roomId, bumpedTournament, newHand, seatUids, engineRow.version)`（streak を +1 した tournament を渡す）。

> 実装上の分岐整理: 強制退出時は「強制アクション → streak 加算 → 退出 → finishIfOnlyCpusLeft → persistHandTransition + connected=false」を 1 経路で完結させ、`persistHandTransition` の重複呼び出しをしない。

### 5.5 playerAction の変更（サーバー）

`playerAction`（rooms.ts:470）で、本人が自発的にアクションしたら streak を 0 にリセット:
- `newHand = progressToActionable(applyAction(...))` の後、`persistHandTransition` へ渡す tournament を `resetTimeoutStreak(tournament, uid)` にする（:511 の引数を差し替え）。

### 5.6 クライアント変更

不要。`status='left'` への遷移は既存 UI が表示済み。強制退出の理由表示は§将来課題。

---

## 6. core 追加関数シグネチャ一覧（`src/core/online/tournament.ts`）

```ts
// 機能A
export function isCpuUid(uid: string): boolean;
export function finishIfOnlyCpusLeft(t: TournamentState): TournamentState;

// 機能B
export function bumpTimeoutStreak(
  t: TournamentState,
  uid: string,
): { tournament: TournamentState; streak: number };
export function resetTimeoutStreak(t: TournamentState, uid: string): TournamentState;

// 型変更
// TournamentConfig に:  cpuFill?: boolean;
// OnlinePlayer   に:  timeoutStreak?: number;
```
いずれも React/Supabase 非依存の純関数（`sync:functions` で Deno に共有される）。

---

## 7. 変更対象ファイル一覧と変更内容

| ファイル | 種別 | 変更内容 |
|---|---|---|
| `src/core/online/tournament.ts` | core | `TournamentConfig.cpuFill?`・`OnlinePlayer.timeoutStreak?` 追加。`isCpuUid` / `finishIfOnlyCpusLeft` / `bumpTimeoutStreak` / `resetTimeoutStreak` 追加（§6） |
| `src/core/online/tournament.test.ts` | test | §8 のケース追加 |
| `scripts/sync-functions.mjs` | script | `SOURCE_DIRS` に `'ai'`、`SOURCE_FILES` に `'potOdds.ts'` 追加（§4.11） |
| `supabase/functions/_shared/rooms.ts` | サーバー | `buildTournamentConfig` に `cpuFill`（§4.2）。`startGame` の CPU 補完 + 人数チェック緩和（§4.3）。`cpuAction` 新設（§4.4）。`persistHandTransition`/`persistNewHand` の names 構築元変更 + CPU スキップ（§4.6）。`joinPlayingRoom` の room_full ガード（§4.10）。`claimTimeout` の streak 加算 + 強制退出（§5.4）。`playerAction` の streak リセット（§5.5）。`FORCED_LEAVE_TIMEOUT_STREAK` 定数。`leaveRoom`/`persistHandTransition`/`claimTimeout` に `finishIfOnlyCpusLeft`（§4.9）。`isCpuUid` を tournament.ts から import |
| `supabase/functions/online-room/index.ts` | サーバー | `OnlineRequest` に `cpu_action`、ルーター switch に `case 'cpu_action'`（§4.4） |
| `supabase/functions/_shared/core/**` | 生成物 | `npm run sync:functions` で再生成（ai/ + potOdds.ts が新たにコピーされる）。手編集しない |
| `src/lib/onlineClient.ts` | lib | `OnlineRequest` に `cpu_action`、`cpuAction(roomId, version)` 追加（§4.7） |
| `src/hooks/useOnlineRoom.ts` | hook | CPU 駆動 effect 追加（§4.5）。`apiCpuAction` import。`isCpuUid` value import（許可コメント追記） |
| `src/components/online/OnlineLobby.tsx` | component | 作成フォームに cpuFill チェック + 強さ select（§4.8）。ロビーに CPU 数表示 + 開始ボタン disabled 緩和 |

**変更不要（明記）**: `src/store/online.ts`（`roomConfig` が `TournamentConfig` を運ぶため cpuFill/difficulty は自動反映）、`OnlineTable.tsx` / `SeatView.tsx` 等の席表示（CPU uid は myUid と不一致で既存表示のまま動く）、DB マイグレーション（スキーマ変更なし）。

---

## 8. テスト項目（Vitest, `src/core/online/tournament.test.ts` に追加）

既存テストは緑のまま。以下を追加:

1. **`isCpuUid`**: `'cpu:1'`→true、`'cpu:5'`→true、UUID 形式（`:` 無し）→false、`''`→false。
2. **CPU 混在の startTournament**: `seats` に `cpu:N` を混ぜても既存の流儀どおり全 stack=startingStack・status='playing'・seat 昇順・button=先頭で構築されること（uid を特別扱いしない確認）。
3. **`finishIfOnlyCpusLeft`**:
   - 人間が 1 人でも生存 → t 不変（no-op）。
   - 生存者が CPU のみ → `(stack DESC, seat ASC)` で finishRank 1..S、winnerUid=最大スタック CPU、status='finished'。既にバスト済みプレイヤーの finishRank は保持。
   - **pendingLeave 中の人間**（status==='playing' のまま）が居る場合 → 人間が残っている扱いで no-op。
4. **`bumpTimeoutStreak` / `resetTimeoutStreak`**:
   - 旧データ（`timeoutStreak` フィールド無し）からの +1 で streak=1。
   - 連続加算で 1→2→3。
   - `resetTimeoutStreak` 後 0。対象不在時は t 不変（bump は streak 0 を返す）。
5. **`addLatePlayer` の満席 no-op**: 6 人（CPU 込み）の tournament に `addLatePlayer` すると players 数が変わらない（§4.10 のガードが検知できる前提）。既存テストがあれば流用。

> サーバー（rooms.ts）の統合検証は Vitest 対象外（Deno/DB 依存）。§9 の完了条件で `supabase functions serve` を用いた手動確認とする。

---

## 9. フェーズ分割と完了条件

各フェーズ末で `npm run build` / `npm run test` が緑、かつ **env 無しで既存機能がゲスト動作**（回帰）を満たす（`docs/ONLINE-VERSUS.md §14` と同水準）。

### Phase 1 — core + sync
- `tournament.ts`: `isCpuUid` / `finishIfOnlyCpusLeft` / `bumpTimeoutStreak` / `resetTimeoutStreak` 追加、`cpuFill?` / `timeoutStreak?` 型追加。
- `tournament.test.ts`: §8 の全ケース。
- `scripts/sync-functions.mjs`: `ai` / `potOdds.ts` 追加。
- **完了条件**: 既存 Vitest + 新規ケースが緑。`npm run sync:functions` を実行して `supabase/functions/_shared/core/ai/**` と `.../potOdds.ts` が生成され、相対 import に `.ts` が付与されていること（生成後に差分なしで再実行しても安定）。env 無しビルド緑。

### Phase 2 — サーバー
- `rooms.ts`: `buildTournamentConfig`（cpuFill）、`startGame`（CPU 補完 + 人数緩和）、`cpuAction`、`persistHandTransition`/`persistNewHand`（names 変更 + CPU スキップ）、`joinPlayingRoom`（room_full ガード）、`claimTimeout`（streak + 強制退出）、`playerAction`（streak リセット）、`finishIfOnlyCpusLeft` 呼び出し、`FORCED_LEAVE_TIMEOUT_STREAK`。
- `index.ts`: `cpu_action` ルート。
- **完了条件**: `npm run sync:functions` → `supabase functions serve online-room` + `supabase start` のローカルで、(a) cpuFill 有効・人間 1 人で `start_game` が成功し 6 席（人間1+CPU5）になる、(b) `cpu_action` を invoke すると CPU 手番が 1 手進み version が上がる、(c) `room_players` / `room_hole_cards` に `cpu:N` が**一切書かれない**（uuid 型エラーが出ない）、(d) 人間を全員 leave させると `finishIfOnlyCpusLeft` で tournament が finished になる、(e) claim_timeout を同一人間に 3 回連続させると status='left' になる。roomsLogic の純部分は既存 Vitest が緑。

### Phase 3 — クライアント
- `onlineClient.ts`（`cpuAction`）、`useOnlineRoom.ts`（CPU 駆動 effect）、`OnlineLobby.tsx`（cpuFill UI + CPU 数表示 + 開始ボタン緩和）。
- **完了条件**: 2 端末（またはシークレット窓）不要で、人間 1 人 + CPU 5 で部屋作成 → 開始 → 自席の手番で操作し、CPU 手番はクライアントが自動で `cpu_action` を駆動してハンドが最後まで進む。バスト/勝ち抜けで順位が確定し、結果画面が出る。`isBackendEnabled=false` で `/online` が案内表示のみ・他機能無影響。cpuFill 無効時は現状挙動（人間 2 人未満は開始不可）と一致。

---

## 10. 運用手順

**スキーマ変更なし = マイグレーション不要**（新テーブル・新カラムは無い。CPU は `room_engine.state` / `room_states.tournament` の jsonb 内のみ）。

再デプロイのみ必須:
```bash
npm run sync:functions                    # src/core -> _shared/core（ai/ と potOdds.ts が新たにコピーされる）
supabase functions deploy online-room     # Edge Function 再デプロイ（cpu_action ルート・CPU ロジックを反映）
```
- `sync:functions` を先に実行しないと、再デプロイした Function が新しい core（`isCpuUid` 等）や `ai/` を参照できずビルド/実行に失敗する。**core / online / ai を変更したら常に `sync:functions` → deploy の順**。
- ローカル確認は `supabase start` + `supabase functions serve online-room --env-file supabase/.env.local`（`docs/ONLINE-VERSUS.md §15.4` と同じ）。

---

## 11. 将来課題（節のみ）

- **CPU 席を人間が置き換える**（席の引き継ぎ）: 途中参加者が空いている CPU 席を引き継ぐ。現状は満席時 `room_full`（§4.10）で拒否する。
- **CPU 人数/強さの開始後変更**、CPU ごとに強さを変える。
- **強制退出の理由表示**: `status='left'` の内訳（自発退出 / タイムアウト強制）をクライアントに区別表示する。
- CPU の思考時間・アクションログ演出（現状は一律 ~1.2 秒ディレイ）。

---

## 12. 既存規約との整合

- `src/core/online/*` は React/Supabase 非依存の純 TS を厳守（`isCpuUid`/`finishIfOnlyCpusLeft`/streak 関数はすべて純関数）。Supabase 呼び出しは `src/lib`/`src/hooks`/`src/components` に閉じる。
- コメントは「なぜ」が非自明なときのみ（CPU uid をスキップする理由＝uuid 型エラー防止、rng 再注入の理由＝jsonb で関数が落ちる、等）。UI 文言は日本語、ポーカー用語は英語。
- 早すぎる抽象化を避ける: `difficulty` を CPU 強さに流用し新フィールドを作らない、`cpu_action` は既存の「任意クライアント駆動 + version 冪等」パターンを踏襲して新機構を作らない。
- モデル分担（`CLAUDE.md`）: 本ドキュメントは Fable5 が確定した設計。実装は Phase 単位で Sonnet サブエージェントへ委譲する。
