# ONLINE-VERSUS — オンライン対戦（部屋を立てて知り合いと遊ぶ）設計ドキュメント

知り合いと 6 文字の部屋コードで集まり、同じテーブルでトーナメントを遊ぶ機能の設計。
本ドキュメントは **Sonnet が単独で実装着手できる粒度**（完全な SQL・RLS 全文・Edge Function の req/res 型・公開 GameState の jsonb 形状・新規 core モジュールのシグネチャ・クライアント新規ファイル一覧と責務・Realtime 購読フロー・フェーズ分割・運用手順）まで具体化したもの。実装コード本体は含まない（コード片は「仕様」である）。

## 前提（変更禁止 / 不変条件）

- `src/core/` は React・Supabase・Node/Browser API に一切依存しない純 TS を維持する（Deno Edge Function から共有するため §8）。
- **最重要の回帰条件**: `supabase === null`（env 未設定）のとき、`/online` ページは「オンライン対戦には Supabase の設定が必要です」という案内表示のみを出し、**既存の全機能（学習ドリル・vs CPU 単発/セッション）は従来どおりゲスト（localStorage）で完全動作する**。`isBackendEnabled` 相当のガードを `/online` の入口とナビ表示に必ず入れる。
- UI 言語は日本語。ポーカー用語（open, raise, call, check, fold, bet, all-in, blind, ante, BTN/SB/BB 等）は英語のまま。
- 既存 `docs/V3-PLATFORM.md`（Supabase 基盤・RLS 方針・`src/lib/supabase.ts`・`src/store/remote/`）と `docs/VERSUS.md`（engine/ai/UI）を土台にする。両ドキュメントは変更しない。
- 静的 SPA + Vercel 無料枠は維持。サーバーロジックは **Supabase Edge Function（Deno）** に閉じ込め、Vercel 側にサーバーコードは置かない。Supabase 無料枠内で成立させる。

---

## 0. スコープ / ゴール / 非ゴール

### ゴール（MVP）
- 部屋を作成 → 6 文字コードを共有 → 知り合いが参加（2〜6 人）。
- **サーバー権威型**トーナメント形式で 1 卓を同期プレイ。ホールカードは本人以外に絶対送らない。
- バスト順で順位確定、独り勝ちで終了。結果画面に順位表 + 各プレイヤーのチップ推移 LineChart。
- 盛り上げ: クイック絵文字リアクション / ショーダウン勝敗演出 / アクション制限時間バー。
- 切断・離席への基本対応（ハートビート + タイムアウト自動フォールド + 離席バスト扱い）。

### 非ゴール（将来課題 §16）
- キャッシュ形式（リバイ/トップアップ、途中参加）。
- 観戦モード、チャット（テキスト）、複数卓トーナメント。
- レーティング/戦績集計（既存の個人統計とは別領域）。
- モバイル下部タブ（`MOBILE_NAV`、5 枠固定）への追加は**行わない**。オンラインはデスクトップサイドバー「プレイ」セクション + Home カードから導線。

---

## 1. アーキテクチャ決定サマリ

| 論点 | 決定 | 理由 |
|---|---|---|
| バックエンド | Supabase（Postgres + Auth + RLS + Realtime + Edge Functions）を流用 | 既存の任意接続基盤・無料枠 |
| 権威 | **サーバー権威型**。ゲームエンジンは Edge Function（Deno）内で実行 | チート防止・ホールカード秘匿を RLS/service role で担保 |
| クライアント書込 | クライアントは `room_states` 等を**直接 UPDATE しない**。全変更は Edge Function 経由（service role が書込） | 権威の一元化。RLS は SELECT のみ許可 |
| 同期 | 権威状態 = **postgres_changes**（`room_states` / `room_players` を参加者に RLS 許可）。一過性イベント = **Realtime Broadcast**（絵文字・カウントダウン ping） | §5.3 に理由。永続・順序保証が要る状態は DB 行、保存不要な演出は broadcast |
| ホールカード | 公開状態には含めず、`room_hole_cards`（`uid = auth.uid()` の RLS）で本人のみ SELECT。ショーダウン公開分のみ公開状態へコピー | 「本人以外に送らない」を app ロジックではなく **RLS 層**で保証 |
| 並行制御 | `room_engine.version` による楽観ロック。Function が read→compute→conditional update、競合は再試行 | ダブルアクション/リプレイ防止 |
| 認証 | 既存 Google OAuth を基本。Supabase Anonymous sign-in を有効化し、表示名だけで参加する導線も用意 | 知り合いを気軽に招くため |
| エンジン共有 | `npm run sync:functions` で `src/core/` を `supabase/functions/_shared/core/` へコピー + Deno 用に相対 import へ `.ts` 拡張子付与（§8） | 単一ソース。二重メンテを避ける |
| マルチプレイ core | 新規 `src/core/online/tournament.ts`（純 TS + Vitest）。スタック持ち越し・エリミネーション・順位管理を担当。`session.ts` は seat0=hero 前提で**流用不可** | §3・§9 |
| 形式 | まずトーナメントのみ（2〜6 人、`DEFAULT_TOURNAMENT_LEVELS` 流用） | スコープ最小化 |
| シャッフル | サーバー側で `crypto.getRandomValues` ベースの rng を `shuffleDeck(rng)` に注入 | 予測不能な配牌 |

---

## 2. 最重要不変条件（回帰テスト対象）

1. env 無し（`supabase === null`）で `npm run build` / 既存 Vitest が緑、かつ手動確認で**全既存機能がゲスト動作**する。`/online` は案内表示のみ。
2. 公開状態（`room_states.public`）・Realtime ペイロードに**他人のホールカードが一度も現れない**（ショーダウンで公開された分を除く）。テストで `toPublicState` が他 seat の `hole` を `null` にすることを保証（§7.3）。
3. Edge Function を経由しない `room_states` / `room_engine` への client からの書込が RLS で**拒否**される。

---

## 3. 既存エンジン検証結果（実コードを読んで確認 — 要修正点）

`src/core/game/engine.ts` / `session.ts` を精査した結果、オンライン（2〜6 人・複数人間・サーバー実行）にそのままは使えない。以下を Phase 1 の前提修正とする。**いずれも 6-max 単発/セッションの既存挙動を壊さない後方互換の範囲**に収める（既存 `engine.test.ts` / `session.test.ts` は緑のまま）。

### 3.1 engine は 6 人ハードコード（要一般化 2〜6）
- `assignPositions` の `posFromBtn`（6 要素固定）、`Array.from({ length: 6 })`（players 生成）、ホール配布ループ `i < 6`、`nextSeat` / `nextActiveFrom` / `nextToActInRound` の `% 6`、`totalPot` 等が **6 固定**。→ 2〜5 人では動かない。
- **修正方針**: 席数 `n = players.length` を単一の真実にし、全 `6` / `% 6` を `n` / `% n` に置換。`startHand` は `seatStacks?.length`（指定時）で `n` を決める。`posFromBtn` を `n` 依存の button 相対ラベル配列にする（下表）。
  - **button 相対ポジション（index0 = button から時計回り）**:
    | n | 配列 |
    |---|---|
    | 2 | `['SB','BB']`（HU: button=SB） |
    | 3 | `['BTN','SB','BB']` |
    | 4 | `['BTN','SB','BB','CO']` |
    | 5 | `['BTN','SB','BB','HJ','CO']` |
    | 6 | `['BTN','SB','BB','UTG','HJ','CO']`（現行と一致） |
  - `Position` 型（6-max ラベル）はそのまま使える（上記は全て既存ラベルの部分集合）。
- **回帰保証**: `n=6` で現行 `posFromBtn` と完全一致 → 既存テスト不変。追加で n=2..5 のポジション割当・アクション順テストを新設（§9.5）。

### 3.2 ポストフロップ先手が SB 起点で HU が誤る（要修正）
- `postflopFirstToAct` は「SB から時計回り最初の active」。6-max では SB=button+1 で正しいが、**HU（n=2）では SB=button なので誤り**（HU はポストフロップ BB が先手）。
- **修正方針**: `postflopFirstToAct = nextActiveFrom(players, (buttonSeat + 1) % n)`（button の次から）。6-max では button+1=SB で現行と同値、HU では button+1=BB で正しい。プリフロップ `preflopFirstToAct`（BB の次）は全 n で正しく一般化のみでよい。

### 3.3 `isHero: id === 0` の hero 前提リーク（要中立化）
- `startHand` が `isHero: id === 0` を固定（engine.ts:108）。エンジン内部ロジックは `isHero` を**読まない**（UI フラグのみ）ことを確認済み（showdown/pots も未使用）。
- **修正方針**: サーバーでは全席 `isHero=false` で構築（誰も特別扱いしない）。「自分」の識別はクライアント側で公開状態の `players[i].uid === myUid` により付与する（§7）。engine 変更は `isHero` 割当のみで軽微。

### 3.4 公開 GameState が全員のホールを保持（要射影）
- `GameState.players[].hole` に全員のカードが入る。`deck`（残りデッキ）も保持。→ そのまま送ると秘匿が破れる。
- **修正方針**: 公開用射影 `toPublicState`（§7.3、新規 `src/core/online/publicState.ts`）で他席 `hole=null`・`deck` 除去。ショーダウンで公開された `result.shown` の席のみ `hole` を残す。engine 本体は変更しない（射影は online 層）。

### 3.5 `session.ts` は seat0=hero 前提で流用不可（新規 tournament.ts）
- `commitHandResult` は `seatStacks[0]`(=hero) を `stackCurve` に積み、`seatStacks[0]<=0` で bust、他 5 席全滅で win と判定。**単一ヒーロー視点**で、複数人間・エリミネーション順位に使えない。
- **決定**: 新規 `src/core/online/tournament.ts`（§9）を作る。`session.ts` は単発/vs CPU セッション専用として温存（変更しない）。`DEFAULT_TOURNAMENT_LEVELS` / `BlindLevel` 型は import で流用。

### 3.6 bust 席の扱い（一般化で解消）
- 現行の「6 席固定・スタック 0 席は blind 0 で allin 扱い」は、`buildPots` が `committedTotal > 0` のみ eligible にするため 0 チップ勝ち抜けは起きない（確認済み）が、**カードを配られ続ける**のは不自然。
- **修正方針**: §3.1 の n 一般化により、tournament 層が**各ハンドで active（stack>0 かつ playing）な uid のみを席に着ける**。エリミネーション済みは次ハンドに座らせない → bust 席問題は構造的に消える。

### 3.7 Deno 互換（§8 で対応、要 sync スクリプト）
- `src/core/` は非相対 import なし・Node/Browser グローバル無し（`handStrength.ts` の `window` は**ローカル配列変数**でグローバル参照ではない＝ Deno でも無害）を確認済み。
- ただし相対 import が**拡張子なし**（`from './deck'`）で **Deno はそのままでは解決不可**。→ `sync:functions` が相対 import に `.ts` を付与する（§8.2）。これが唯一の移植ブロッカー。
- `deck.ts::shuffleDeck(rng)` は rng 注入可 → Function から `crypto` ベース rng を渡す。`equity.ts` 内の直 `Math.random`（rng 非注入）は **AI 用途のみ**で、オンライン MVP は全員人間のため AI を同期しない（`_shared/core` から `ai/` を除外可）。

---

## 4. データモデル — `supabase/migrations/0002_online.sql`（新規・逐語）

`0001_init.sql` はそのまま。以下を **新規ファイル**として追加する。全テーブル RLS 有効。**書込は service role（Edge Function）のみ**、クライアントは参加者 SELECT のみ。

```sql
-- supabase/migrations/0002_online.sql
-- Online versus (rooms). Server-authoritative: clients read via RLS, writes via Edge Function (service role).

-- ============================================================
-- rooms: 部屋（6文字コード・設定・状態）
-- ============================================================
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,                 -- 6文字（大文字英数、紛らわしい文字除外）
  host_uid    uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'lobby',        -- 'lobby' | 'playing' | 'finished'
  config      jsonb not null default '{}'::jsonb,   -- TournamentConfig（§9.1）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rooms_code_idx on public.rooms (code);

-- ============================================================
-- room_players: 参加者（席・表示名・ハートビート・順位）
-- ============================================================
create table if not exists public.room_players (
  room_id      uuid not null references public.rooms(id) on delete cascade,
  uid          uuid not null references auth.users(id) on delete cascade,
  seat         integer not null,                    -- 0..5（着席順・安定）
  display_name text not null,
  connected    boolean not null default true,       -- 離席/切断で false
  last_seen    timestamptz not null default now(),  -- ハートビート
  stack        integer not null default 0,          -- 現在の持ちチップ（tournament が権威、表示用ミラー）
  status       text not null default 'playing',     -- 'playing' | 'busted' | 'left'
  finish_rank  integer,                             -- 確定順位（1=優勝）。未確定 null
  joined_at    timestamptz not null default now(),
  primary key (room_id, uid),
  unique (room_id, seat)
);
create index if not exists room_players_room_idx on public.room_players (room_id);

-- ============================================================
-- room_states: 公開ゲーム状態（PublicGameState）+ 楽観ロック version
-- ============================================================
create table if not exists public.room_states (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  version     integer not null default 0,           -- room_engine.version と同期させる
  hand_number integer not null default 0,
  phase       text not null default 'idle',         -- 'idle' | 'in_hand' | 'hand_over' | 'finished'
  public      jsonb not null default '{}'::jsonb,   -- PublicGameState（§7.2）
  action_deadline timestamptz,                      -- 現 toAct の締切（タイムアウト用）
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- room_engine: 完全なエンジン状態（deck+全hole）。クライアント読取不可。
-- ============================================================
create table if not exists public.room_engine (
  room_id   uuid primary key references public.rooms(id) on delete cascade,
  version   integer not null default 0,             -- 楽観ロックの真実
  state     jsonb not null default '{}'::jsonb,     -- 完全な GameState（deck/全hole 含む）
  seat_uids jsonb not null default '[]'::jsonb,     -- このハンドの seatIndex -> uid（string[]）
  updated_at timestamptz not null default now()
);

-- ============================================================
-- room_hole_cards: 本人のみ読めるホールカード配信
-- ============================================================
create table if not exists public.room_hole_cards (
  room_id     uuid not null references public.rooms(id) on delete cascade,
  hand_number integer not null,
  uid         uuid not null references auth.users(id) on delete cascade,
  hole        jsonb not null,                       -- [Card, Card]
  created_at  timestamptz not null default now(),
  primary key (room_id, hand_number, uid)
);

-- ============================================================
-- メンバー判定（security definer で RLS 再帰を回避）
-- ============================================================
create or replace function public.is_room_member(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.room_players rp
    where rp.room_id = rid and rp.uid = auth.uid()
  );
$$;

-- ============================================================
-- RLS: クライアントは参加者 SELECT のみ。書込は service role（RLS バイパス）。
-- ============================================================
alter table public.rooms           enable row level security;
alter table public.room_players    enable row level security;
alter table public.room_states     enable row level security;
alter table public.room_engine     enable row level security;
alter table public.room_hole_cards enable row level security;

-- rooms: メンバー or ホストのみ SELECT。書込ポリシーなし（=クライアント不可）。
create policy "rooms_select_member" on public.rooms
  for select using (public.is_room_member(id) or host_uid = auth.uid());

-- room_players: 同室メンバーは全員分 SELECT 可（参加者一覧表示）。書込ポリシーなし。
create policy "room_players_select_member" on public.room_players
  for select using (public.is_room_member(room_id));

-- room_states: 同室メンバーのみ SELECT。書込ポリシーなし。
create policy "room_states_select_member" on public.room_states
  for select using (public.is_room_member(room_id));

-- room_engine: SELECT ポリシーを一切作らない → クライアントは読めない（service role のみ）。

-- room_hole_cards: 本人の行のみ SELECT。書込ポリシーなし。
create policy "room_hole_select_own" on public.room_hole_cards
  for select using (uid = auth.uid() and public.is_room_member(room_id));

-- ============================================================
-- Realtime: 公開状態と参加者一覧のみ発行対象に追加
-- ============================================================
alter publication supabase_realtime add table public.room_states;
alter publication supabase_realtime add table public.room_players;
-- room_hole_cards は本人配信のため任意で追加可（RLSで本人行のみ届く）:
alter publication supabase_realtime add table public.room_hole_cards;
```

> 設計判断: `room_engine` に SELECT ポリシーを作らないことで、RLS 有効テーブルは「該当ポリシー無し = 全拒否」となりクライアントから読めない。deck と全 hole はここだけに置く。公開すべき情報は Function が `room_states.public` に射影して書く。

---

## 5. サーバー権威フロー & Realtime 購読フロー

### 5.1 全体像

```
[Client A]                         [Edge Function: online-room]                 [Postgres]
   |  invoke(create_room, config)         |                                          |
   |------------------------------------->| verify JWT -> uid                        |
   |                                      | service role: insert rooms/room_players  |
   |                                      | insert room_states(phase=idle)           |
   |<------ {roomCode, roomId} ----------|                                          |
   |  subscribe postgres_changes(room_states, room_players where room_id=eq)         |
   |========================= Realtime channel (RLS filtered) ======================>|
```

### 5.2 1 アクションの流れ（楽観ロック）

```
Client（自分の番）
  1. invoke('online-room', { action:'player_action', roomId, version, action:{type,amount} })
Function
  2. JWT 検証 -> uid
  3. service role: room_engine を SELECT（state, version）
  4. version 不一致 -> {ok:false, error:'stale'}（クライアントは最新を待って再送）
  5. seat_uids から uid の seatIndex 特定。state.toAct !== seatIndex -> {ok:false,'not_your_turn'}
  6. legalActions で検証 -> applyAction（不正は clamp 済みで再検証）
  7. toAct===null なら advanceStreet / resolveShowdown まで一気に進める（ボード配布はサーバーで）
  8. version+1 で room_engine を conditional update（where version=expected）。0 行なら競合 -> 再試行 or stale
  9. toPublicState を room_states.public に、action_deadline を再計算して書込（同 version）
 10. ハンド終了なら tournament.applyHandResult -> room_players.stack/status/finish_rank 更新、
     次ハンドの hole を room_hole_cards に service role で insert、rooms.status 更新
Postgres -> Realtime
 11. room_states / room_players の UPDATE が全参加者へ push（RLS で同室のみ）
Client 全員
 12. 公開状態を受信して再描画。自分の hole は別途 room_hole_cards から取得済み
```

### 5.3 postgres_changes と Broadcast の使い分け（確定 + 理由）

- **権威状態 = postgres_changes**（`room_states`, `room_players`, `room_hole_cards`）
  - 理由: 公開状態は既に **version 付きで永続化**され順序も一意。行変更購読が最も自然で、途中参加者は「SELECT で現在値取得 → subscribe」で確実に整合。RLS が購読者ごとに配信を絞るため**秘匿がトランスポート層で保証**される（hole は本人のみ届く）。無料枠でも 6 人 × 数十メッセージ/分は軽量。
- **一過性イベント = Broadcast**（絵文字リアクション、カウントダウン ping、ショーダウン演出トリガ）
  - 理由: DB 保存不要・低レイテンシ・履歴不要。`channel.send({ type:'broadcast', event:'reaction', payload })`。誰が投げたかは payload に uid（自己申告）で十分（演出のみ、権威に影響しない）。

### 5.4 購読チャンネル構成（クライアント）

```
const ch = supabase.channel(`room:${roomId}`)
  .on('postgres_changes', { event:'*', schema:'public', table:'room_states',  filter:`room_id=eq.${roomId}` }, onState)
  .on('postgres_changes', { event:'*', schema:'public', table:'room_players', filter:`room_id=eq.${roomId}` }, onPlayers)
  .on('postgres_changes', { event:'INSERT', schema:'public', table:'room_hole_cards', filter:`room_id=eq.${roomId}` }, onHole) // RLSで本人行のみ
  .on('broadcast', { event:'reaction' }, onReaction)
  .subscribe()
// 初期同期: subscribe 後に room_states / room_players / 自分の room_hole_cards を一度 SELECT
```

---

## 6. Edge Function `online-room`（単一ルーター）

`supabase/functions/online-room/index.ts`。Deno。`Authorization: Bearer <access_token>` で認証、`action` フィールドでルーティング。JWT 検証は anon クライアント + `auth.getUser(jwt)`、DB 書込は **service role クライアント**（`SUPABASE_SERVICE_ROLE_KEY`、RLS バイパス）。

### 6.1 共通エンベロープ

```ts
type OnlineRequest =
  | { action: 'create_room'; config: TournamentConfigInput }
  | { action: 'join_room'; code: string; displayName: string }
  | { action: 'leave_room'; roomId: string }
  | { action: 'start_game'; roomId: string }
  | { action: 'player_action'; roomId: string; version: number; move: { type: PlayerActionType; amount?: number } }
  | { action: 'next_hand'; roomId: string }
  | { action: 'claim_timeout'; roomId: string; version: number; targetUid: string }
  | { action: 'heartbeat'; roomId: string };

type OnlineResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: OnlineErrorCode };

type OnlineErrorCode =
  | 'unauthorized' | 'room_not_found' | 'room_full' | 'not_host'
  | 'not_your_turn' | 'illegal_action' | 'stale' | 'not_in_hand'
  | 'already_started' | 'internal';
```

### 6.2 アクション別 req/res

| action | 主体 | 入力 | 出力 data | 処理概要 |
|---|---|---|---|---|
| `create_room` | 誰でも（要認証） | `config` | `{ roomId, code }` | 一意コード生成→ rooms/room_players(host, seat0)/room_states(idle) を service role で insert |
| `join_room` | 誰でも | `code, displayName` | `{ roomId, seat }` | status='lobby' の部屋に空席で追加。満席→`room_full`、開始済→`already_started` |
| `leave_room` | 参加者 | `roomId` | `{}` | ロビー中は行削除。プレイ中は §13.3 の離席バスト処理 |
| `start_game` | ホストのみ | `roomId` | `{ version }` | 2 人以上で `tournament.startTournament`→ 第1ハンド deal。非ホスト→`not_host` |
| `player_action` | toAct 本人 | `roomId, version, move` | `{ version }` | §5.2。version 不一致→`stale`、手番外→`not_your_turn`、非合法→`illegal_action` |
| `next_hand` | ホスト or 自動 | `roomId` | `{ version }` | phase='hand_over' かつ `canContinue` なら次ハンド deal |
| `claim_timeout` | 誰でも | `roomId, version, targetUid` | `{ version }` | `now > action_deadline` かつ targetUid が toAct のときのみ強制 check/fold（§13.2）。それ以外は no-op |
| `heartbeat` | 参加者 | `roomId` | `{}` | `room_players.last_seen=now, connected=true` |

> `create_room` のコード生成: 大文字英数から紛らわしい文字（`0/O/1/I/L`）を除いた 30 字集合で 6 桁。`rooms.code` の unique 制約に当たったら再生成（最大数回）。
>
> `next_hand` の自動化: MVP は phase='hand_over' で一定秒（例 4 秒）後に**任意のクライアントが next_hand を invoke**（先着 1 回が成功、以降は version で no-op）。専用スケジューラは持たない（無料枠方針）。

### 6.3 権威ロジックの置き場所

Function は薄いルーターに保ち、実ロジックは `_shared/` の純関数へ委譲する:
```
supabase/functions/
  online-room/index.ts          # ルーティング + 認証 + service role I/O のみ
  _shared/
    core/                       # sync:functions が生成（§8）
    rooms.ts                    # コード生成 / 参加者操作 / RLS越しでない service role ヘルパ
    engine-driver.ts            # applyAction 後に advanceStreet/resolveShowdown を終端まで進める純関数
    crypto-rng.ts               # crypto.getRandomValues -> () => number（shuffleDeck へ注入）
```

`engine-driver.ts`（サーバー版ドライバ、AI 無し・全員人間）:
```ts
/** applyAction 済みの state を、toAct が現れるか handが終わるまで自動で advance する。 */
export function progressToActionable(state: GameState): GameState;
// while (state.toAct === null && !(street==='showdown' && result)) state = advanceStreet(state);
```

---

## 7. 公開状態 PublicGameState と hole 配信

### 7.1 方針
`room_engine.state` に完全な `GameState`（deck + 全 hole）を保持し、クライアントには **射影済み** `PublicGameState` のみを `room_states.public` で配る。hole は `room_hole_cards`（本人 RLS）で配る。ショーダウンで公開された席の hole だけ公開状態に載せる。

### 7.2 型（新規 `src/core/online/types.ts`）

```ts
import type { GameState, PlayerState, Street, HandResult } from '../game/types';

/** 公開席: hole は自分/公開分以外 null。uid/displayName を付与、deck は持たない。 */
export type PublicPlayer = Omit<PlayerState, 'hole'> & {
  uid: string;
  displayName: string;
  hole: PlayerState['hole'];   // null unless revealed at showdown
};

export type PublicGameState = Omit<GameState, 'players' | 'deck'> & {
  players: PublicPlayer[];     // seatIndex 順（= engine の players 順）
  // deck は意図的に除外
};
```

### 7.3 射影関数（新規 `src/core/online/publicState.ts`、純 TS + テスト）

```ts
import type { GameState } from '../game/types';
import type { PublicGameState } from './types';

/**
 * engine の完全 state を公開状態へ射影する。
 * - deck は落とす。
 * - 各席の hole は「result.shown に含まれる（=ショーダウン公開）」場合のみ残し、他は null。
 * - seatUids[i] を players[i].uid に、names[i] を displayName に付与。
 * サーバー(Function)がブロードキャスト前に必ず通す。クライアント自席の hole は別経路で合流。
 */
export function toPublicState(
  state: GameState,
  seatUids: string[],
  names: Record<string, string>,
): PublicGameState;
```

- テスト（§9.5）: 進行中は全席 `hole===null`、ショーダウンで `result.shown` の席のみ `hole` が残る、`deck` プロパティが存在しない。
- クライアント表示時は `players[i].uid === myUid` の席に自分の hole（`room_hole_cards` から取得）を合成し、`isHero` フラグを立てて既存 `SeatView` に渡す（§11.2）。

---

## 8. エンジン共有（`src/core/` → Deno）

### 8.1 方針
単一ソースを保つため `src/core/` を Function にコピーする（シンボリックリンクや monorepo import は Deno/Supabase デプロイと相性が悪いため採用しない）。

### 8.2 同期スクリプト `scripts/sync-functions.mjs` + `npm run sync:functions`

`package.json` scripts に追加:
```jsonc
"sync:functions": "node scripts/sync-functions.mjs"
```

スクリプト仕様（Sonnet 実装）:
1. コピー元 `src/core/`、コピー先 `supabase/functions/_shared/core/`。
2. コピー対象: `cards.ts, evaluator.ts, handNotation.ts, ranges/**, game/**`（`*.test.ts` は除外）。
   - `ai/**` と `equity.ts` は **除外**（オンライン MVP は全員人間で AI 不使用。将来 AI 席を足すときに追加）。`potOdds.ts` も除外可（ゲーム進行に不要）。
3. **Deno 対応の変換**: コピー時に各ファイルの相対 import へ `.ts` を付与。
   - 対象: `from './x'` / `from '../y/z'` / `import type ... from './x'`。既に拡張子付き・非相対はスキップ。
   - 正規表現例（仕様）: `from '(\.\.?/[^']+?)(?<!\.ts)'` → `from '$1.ts'`。
4. 生成先を Git 追跡する（デプロイ再現性のため）。冒頭に `// AUTO-GENERATED by sync:functions. Do not edit.` を付与。
5. CI/ローカルで `sync:functions` 後に差分が無いことを確認する軽い検証（任意）。

### 8.3 検証済みの移植可否
- 非相対 import: **無し**（全て相対）→ OK。
- Node/Browser グローバル: **無し**（`handStrength.ts` の `window` はローカル配列変数で無害。ただし AI は同期対象外）。
- `import.meta.env` / `localStorage` / `process`: `src/core/` に**無し**（`src/lib/supabase.ts` 等の外側のみ）→ OK。
- 乱数: `deck.ts::shuffleDeck(rng)` に `crypto-rng.ts` の rng を注入。`Math.random` 直書きは AI/equity のみ（同期対象外）。
- **唯一の必須変換 = 相対 import の `.ts` 付与**（§8.2-3）。

---

## 9. マルチプレイ core — `src/core/online/tournament.ts`（新規・純 TS + Vitest）

`session.ts`（seat0=hero）を流用せず、複数 uid・エリミネーション・順位を管理する。`BlindLevel` / `DEFAULT_TOURNAMENT_LEVELS` / `DEFAULT_HANDS_PER_LEVEL` は `session.ts` から import 流用。

### 9.1 型

```ts
import type { GameConfig, GameState } from '../game/types';
import type { BlindLevel } from '../game/session';

export type TournamentConfig = {
  startingStack: number;              // 全席同一の初期チップ
  blindLevels: BlindLevel[];          // DEFAULT_TOURNAMENT_LEVELS 流用可
  handsPerLevel: number;              // DEFAULT_HANDS_PER_LEVEL 流用可
  difficulty?: GameConfig['difficulty']; // AI 不使用のため任意（GameConfig 充足用に 'normal' 既定）
};

// create_room が受け取る入力（数値の妥当性は Function で clamp）
export type TournamentConfigInput = Partial<TournamentConfig>;

export type OnlinePlayer = {
  uid: string;
  displayName: string;
  seat: number;                       // 着席順（安定・room_players.seat と一致）
  stack: number;                      // ハンド間で持ち越すチップ
  status: 'playing' | 'busted' | 'left';
  finishRank: number | null;          // 1=優勝。bust/left 確定時にセット
  bustedHand: number | null;          // バストしたハンド番号
};

export type TournamentState = {
  config: TournamentConfig;
  players: OnlinePlayer[];            // seat 昇順（安定。busted も順位確定のため残す）
  handNumber: number;                 // 通し番号（0=未開始）
  currentLevel: number;               // blindLevels の index
  buttonUid: string | null;           // 生存者内でローテーション
  status: 'lobby' | 'playing' | 'finished';
  winnerUid: string | null;
};
```

### 9.2 関数シグネチャ

```ts
/** ロビー参加者からトーナメント開始。全員 startingStack、button=先頭 seat、status='playing'。 */
export function startTournament(
  seats: { uid: string; displayName: string; seat: number }[],
  config: TournamentConfig,
): TournamentState;

/** 現在プレイ継続中（status==='playing' かつ stack>0）の players を seat 順で返す。 */
export function livePlayers(t: TournamentState): OnlinePlayer[];

/** 次ハンドを配るためのセットアップを作る。button 起点で着席順を並べ替える。 */
export type HandSetup = {
  uids: string[];        // このハンドに座る uid（engine の seatIndex 0..n-1 と対応）
  seatStacks: number[];  // uids と同順の持ちチップ
  buttonSeat: number;    // engine に渡す button の index（uids 配列内）。MVP は 0
  config: GameConfig;    // 現レベルの sb/bb/ante を反映（difficulty 既定 'normal', mode 'tournament'）
};
export function setupHand(t: TournamentState): HandSetup;

/**
 * ハンド終了 GameState を受けて反映する:
 *  - ended.players[i].stack を uids[i] の OnlinePlayer.stack に書き戻し
 *  - stack<=0 の生存者を busted 化し finishRank/bustedHand を確定（同ハンド複数バストは
 *    ハンド開始時スタックの大きい順に上位）
 *  - handNumber++、handsPerLevel でレベルアップ、button を次の生存者へ
 *  - 生存者が 1 人 -> status='finished', winnerUid セット, その人 finishRank=1
 */
export function applyHandResult(t: TournamentState, ended: GameState, uids: string[]): TournamentState;

/** プレイヤーの離席（切断バスト）。stack を没収し busted 化、順位確定。 */
export function markLeft(t: TournamentState, uid: string): TournamentState;

/** 次ハンドを開始できるか（status==='playing' かつ生存者 2 人以上）。 */
export function canContinue(t: TournamentState): boolean;

/** 順位表（finishRank 昇順=優勝→最初のバスト。未確定は stack 降順で暫定表示）。 */
export function standings(t: TournamentState): OnlinePlayer[];
```

### 9.3 button ローテーション仕様
- MVP は `setupHand` が **button を index0** に置くよう uids を並べる（`startHand(null, config, seatStacks)` が prev=null で buttonSeat=0 を採るため engine 変更を最小化）。
- 次ハンドの button = 現 buttonUid の次の生存者（seat 昇順で循環）。`applyHandResult` で `buttonUid` を更新し、`setupHand` はそこから並べ替える。
- 生存者数が変わるため、engine は §3.1 の n 一般化が前提。

### 9.4 同ハンド複数バストの順位規則（確定）
- 1 ハンドで複数人が 0 チップになった場合、**そのハンド開始時のスタックが大きいプレイヤーほど上位**（＝より遅くバストした扱い）。同額なら seat 昇順で上位。`finishRank` は「残り生存者数 + 1」から連番で付与。

### 9.5 テスト（Vitest）
- `src/core/online/tournament.test.ts`:
  1. `startTournament`: 全 stack=startingStack、status='playing'、button=先頭、handNumber=0。
  2. `setupHand`: button が index0、seatStacks が uids と同順、config の bb がレベル反映。
  3. `applyHandResult`: stack 書き戻し、bust 検出、finishRank 連番、button 前進、handNumber++。
  4. レベルアップ: handsPerLevel=2 で 2 ハンド後 currentLevel=1。
  5. 独り勝ち: 生存 1 人で status='finished'、winnerUid、finishRank=1。
  6. 複数同時バスト順位（§9.4）。
  7. `markLeft`: stack 没収・busted・順位確定・`canContinue` 反映。
  8. **チップ保存**: セッション内総チップ = `n * startingStack` 一定（持ち越しゼロサム）。
- `src/core/online/publicState.test.ts`（§7.3）: 進行中 hole=null、showdown 公開分のみ残る、deck 無し。
- `src/core/game/engine.test.ts` に **n=2..5 追加**（§3.1/3.2）: ポジション割当・プリ/ポストフロップ先手（特に HU ポストフロップ=BB）。既存 6-max ケースは不変で緑。

---

## 10. 認証

- **Google OAuth**: 既存 `src/store/auth.ts` の導線をそのまま利用。ログイン済みならその uid で参加。
- **Anonymous sign-in**: `supabase.auth.signInAnonymously()` を「表示名だけで参加」導線に使う。生成される `auth.users` 行に uid が付くため **RLS の `auth.uid()` はそのまま機能**（`room_players.uid`・`room_hole_cards` の本人判定が成立）。
  - 導線: `/online` のロビーで未ログイン時に「Google でログイン」/「表示名だけで参加（ゲスト）」を提示。後者は `signInAnonymously` → `displayName` を `room_players` に保存。
  - 制約: 匿名ユーザーはブラウザセッション紐付き（別端末・クリアで別人）。学習用の永続データはひも付かない旨を UI に注記。
  - **有効化が必要**（運用手順 §15）: Supabase Dashboard → Authentication → Providers → Anonymous を ON。未有効なら匿名導線を隠し Google のみ表示（`signInAnonymously` 失敗を検出してフォールバック）。

---

## 11. クライアント新規ファイル一覧と責務

### 11.1 新規ファイル

| ファイル | 種別 | 責務 |
|---|---|---|
| `src/lib/onlineClient.ts` | lib | `supabase.functions.invoke('online-room', { body })` の薄いラッパ。`OnlineRequest`→`OnlineResponse` 型付け、`Authorization` 付与、エラー正規化。`supabase===null` なら即エラー |
| `src/store/online.ts` | zustand store | 現在の部屋の**揮発**状態: `room`(config/status), `players`(PublicPlayer 一覧), `publicState`, `myHole`, `myUid`, `myVersion`, `connection`。**persist しない**（再訪は roomCode 手入力）。ただし最後の `roomCode` のみ `sessionStorage` に保持して即再入場を許容（任意） |
| `src/hooks/useOnlineRoom.ts` | hook | 購読の確立/解除（§5.4）、初期 SELECT、`create/join/leave/start/act/react/heartbeat` の公開、`legal`（自席の `legalActions(publicStateAsGameState, mySeat)`）と `isMyTurn` の導出、`action_deadline` からの残時間算出、ハートビート `setInterval`（例 15s） |
| `src/pages/Online.tsx` | page | ルート `/online`。`isBackendEnabled` ガード（false→案内表示）。`room.status` で Lobby / Table / Results を出し分け |
| `src/components/online/OnlineLobby.tsx` | component | 部屋作成（config 選択→コード表示・コピー）、コード入力で参加、参加者一覧、**開始ボタン（ホストのみ）**、ゲスト参加導線（§10） |
| `src/components/online/OnlineTable.tsx` | component | 公開状態でテーブル描画。**自席を下部に回転配置**して N 席（2〜6）をレイアウト。`SeatView`/`BoardView`/`PotDisplay`/`BetControls` を流用（§11.2） |
| `src/components/online/ReactionBar.tsx` | component | 絵文字クイックリアクション（Broadcast 送信 + 受信アニメ） |
| `src/components/online/ActionTimer.tsx` | component | `action_deadline` からの残時間バー。0 で `claim_timeout` を invoke |
| `src/components/online/OnlineResults.tsx` | component | 順位表（`standings`）+ 各プレイヤーのチップ推移。既存 `src/components/charts/LineChart.tsx` を流用 |

### 11.2 既存コンポーネント流用可否（実コードを読んだ判定）

- **`BetControls.tsx`**: `{ legal, potForSizing, onAction }` のみ依存 → **そのまま流用**。クライアントは公開状態から自席の `legalActions` を計算（stack/committedStreet は公開状態にあり hole 不要）して渡す。
- **`SeatView.tsx`**: `player: PlayerState` + `isToAct/showCards` に依存。`isHero`/`hole`/`pos`/`status`/`committedStreet` を読む。→ **流用可**（`PublicPlayer` は `PlayerState` 互換の形）。必要変更:
  - `displayName` 表示を追加（現状 `pos` + `YOU`）。prop 追加 or `PublicPlayer.displayName` を読む小改修。
  - 「自分」は `player.uid === myUid` で `isHero=true` を合成して渡す（OnlineTable 側で付与）。他席は `hole=null`＋`faceDown`（現状の `!isHero && !showCards` 分岐で既に face-down）。ショーダウン公開席は `hole` が入り `showCards` で表向き。
- **`BoardView.tsx` / `PotDisplay.tsx` / `PlayingCard.tsx`**: 状態非依存の表示 → **そのまま流用**。
- **`PokerTable.tsx`**: `SEAT_POS` が **`Position`（6-max 固定）キーの絶対座席**で、(a) N<6 に対応せず (b) 自席を下部に回転しない。→ **流用不可、`OnlineTable.tsx` を新設**（単発 Versus の `PokerTable` は温存＝リスク最小）。`OnlineTable` は「席数 n と自席 index から楕円上に座標を割り当て、自分を下(90°)に固定して時計回り配置」する座標計算を持ち、各席に `SeatView` を載せる。`SeatView`/`BoardView`/`PotDisplay` は流用。
- **`useVersusSession.ts` / `useVersusGame.ts`**: ローカルエンジン駆動・CPU・seat0=hero 前提 → **流用不可**。`useOnlineRoom` を新設（サーバー権威・購読駆動・自席のみ操作）。ただしタイマー/クリーンアップの実装パターンは参考にする。

### 11.3 ナビ / ルート
- `App.tsx`: `{ path: 'online', element: <Online /> }` を追加。
- `AppShell.tsx`: デスクトップ サイドバーの **「プレイ」セクション**に「オンライン対戦」を追加（アイコン `Users` or `Wifi`、lucide）。**`MOBILE_NAV`（5 枠固定）は変更しない**。
- `Home.tsx`: 「オンライン対戦」カードを 1 枚追加（`isBackendEnabled` が false のときはカードに「設定が必要」注記 or 非活性）。

---

## 12. 盛り上げ機能（小さく設計）

1. **クイック絵文字リアクション**: `ReactionBar` の固定候補（例 👍🔥😂😱💪）を Broadcast（`event:'reaction', payload:{uid, emoji}`）。受信側は投げた席から絵文字が浮かんで消える `framer-motion` アニメ。**DB 保存なし**。
2. **ショーダウン勝敗演出**: `phase` が `hand_over` かつ `result` あり → 勝者席をハイライト + ポットが勝者へ流れるチップアニメ（既存 `framer-motion`）。役名（`result.shown[].handName`）を表示。演出トリガはローカル（公開状態の遷移で発火）で Broadcast 不要。
3. **アクション制限時間バー**: `ActionTimer` が `room_states.action_deadline` までの残時間を表示。0 で自席以外の誰かが `claim_timeout` を投げてもよい（サーバーが期限検証）。自席が期限切れなら自動で check/fold される（§13.2）。

> これ以上（アバター/スタンプ購入/実績等）は §16「将来案」に留める。

---

## 13. 切断・タイムアウト対応

### 13.1 ハートビート
- `useOnlineRoom` が `heartbeat` を 15 秒周期で invoke → `room_players.last_seen/connected` 更新。
- 各クライアントは受信した `room_players` から、`last_seen` が閾値（例 40 秒）超過の相手を「接続不安定」表示。

### 13.2 アクションタイムアウト
- ハンド内で toAct が決まるたびサーバーが `action_deadline = now + 制限秒（例 30s）` を `room_states` に書く。
- 期限を過ぎたら**任意のクライアント**が `claim_timeout(roomId, version, targetUid)` を invoke。
- サーバーは `now > action_deadline` かつ `targetUid` が現 toAct のときのみ、**check 可能なら check、不可なら fold** を `applyAction` で強制し、通常どおり進行。version でリプレイ防止。

### 13.3 途中退出 / 切断バスト
- 明示退出（`leave_room`）またはハートビート長時間途絶（サーバー判断は `claim_timeout` の副次でなく、プレイ中は「タイムアウト連続 → left 化」を採る）:
  - `tournament.markLeft(uid)` で stack 没収・`busted`（`status='left'`）化・順位確定。
  - 現在そのハンドで toAct 中なら fold 相当で処理してから離席反映。
- **ホスト切断でもゲームは継続**: 権威は Function にあり、`start_game` 以外の進行（`player_action`/`next_hand`/`claim_timeout`）はホスト権限不要。ホストが落ちても他プレイヤーの操作でハンドは進む。`next_hand` は先着 1 クライアントが駆動（§6.2）。
  - 新規ハンド開始（`start_game`）だけはホスト操作。開始後にホストが落ちても影響しない。ロビー段階でホストが落ちた場合は部屋を畳む（他者は `leave_room`）。

---

## 14. フェーズ分割と完了条件

各フェーズ末で `npm run build` / `npm run test` が緑、かつ **env 無しで既存機能がゲスト動作**（回帰）を満たす。

### Phase 1 — core 修正 + tournament + Edge Function（サーバー基盤）
- engine 一般化（§3.1/3.2/3.3）、`toPublicState`（§7.3）、`src/core/online/tournament.ts`（§9）、Vitest（§9.5）。
- `supabase/migrations/0002_online.sql`（§4）、`scripts/sync-functions.mjs` + `npm run sync:functions`（§8）。
- Edge Function `online-room`（§6）+ `_shared/engine-driver.ts`/`crypto-rng.ts`。
- **完了条件**: 既存 engine/session テスト緑 + n=2..5 の新テスト緑 + tournament/publicState テスト緑。ローカル（`supabase functions serve` + `supabase start`）で create/join/start/player_action が curl/スクリプトで一巡でき、他人の hole が `room_states` に出ないことを確認。

### Phase 2 — クライアント UI（実プレイ）
- `onlineClient.ts` / `store/online.ts` / `useOnlineRoom.ts` / `pages/Online.tsx` / `OnlineLobby` / `OnlineTable`(+`SeatView`小改修) / `OnlineResults`。
- ナビ・ルート・Home カード追加（§11.3）。認証（§10）。
- **完了条件**: 2 端末（またはシークレット窓）で部屋作成→参加→トーナメント 1 回を最後まで（優勝確定 + 結果画面のチップ推移グラフ表示）遊べる。`isBackendEnabled=false` で `/online` が案内表示のみ・他機能無影響。

### Phase 3 — 盛り上げ + 堅牢化
- `ReactionBar`（Broadcast）、ショーダウン演出、`ActionTimer` + `claim_timeout`、ハートビート、離席バスト（§12/§13）。
- **完了条件**: 1 人が放置→タイムアウト自動フォールドで進行継続、離席→順位確定、ホスト切断後も残りで続行。絵文字が全員に届く。

---

## 15. 運用手順

### 15.1 マイグレーション
- Supabase Dashboard → SQL Editor に `supabase/migrations/0002_init` ではなく `0002_online.sql`（§4）を貼って実行。または `supabase db push`。

### 15.2 Anonymous auth 有効化
- Dashboard → Authentication → Providers → **Anonymous** を Enable。Google は既存設定を流用（`docs/V3-PLATFORM.md` §1.4）。

### 15.3 Edge Function デプロイ
```bash
npm run sync:functions                         # src/core -> _shared/core（Deno用に変換）
supabase functions deploy online-room --no-verify-jwt=false
# 必要な secrets（service role）を設定:
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
# SUPABASE_URL / SUPABASE_ANON_KEY はプラットフォーム既定で注入される
```
> service role key は **クライアントに絶対出さない**。Function の secret としてのみ設定する。

### 15.4 ローカル開発
```bash
supabase start                                 # ローカル Postgres/Auth/Realtime
supabase db reset                              # migrations 適用（0001+0002）
npm run sync:functions
supabase functions serve online-room --env-file supabase/.env.local
npm run dev                                     # フロント（.env.local に VITE_SUPABASE_URL/ANON_KEY をローカル値で）
```
- Realtime は `supabase start` に含まれる。2 つのブラウザプロファイルで動作確認。

### 15.5 Vercel
- 追加の env は不要（既存 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` を流用）。Function は Supabase 側にデプロイ。

---

## 16. 将来課題（節のみ）

- **キャッシュ形式**: 途中参加/離脱、リバイ・トップアップ、固定ブラインド。`rooms.config` に `format:'cash'` を足し、`tournament.ts` とは別の `cashTable.ts`（席の動的増減）を新設する想定。ハンド履歴の `versus_hands` 相当をオンライン用に保存するかも別途検討。
- **AI 席補完**: 人数が揃わないとき CPU を混ぜる。`_shared/core` に `ai/` を同期し、Function 側で空席を `decideCpu` で埋める（`estimateEquity` の rng を crypto に）。
- 観戦モード、テキストチャット、複数卓、レーティング、リプレイ共有。

---

## 17. 既存規約との整合

- コメントは「なぜ」が非自明なときのみ（SQL の設計判断ノート等）。UI 文言は日本語、ポーカー用語は英語。
- `cn()` でクラス結合、Zustand は `create`（online store は persist しない揮発状態）。エラーハンドリングはシステム境界（Function I/O・Realtime・auth）のみ。
- `src/core/online/*` は React/Supabase 非依存の純 TS を厳守（Function から共有するため）。Supabase 呼び出しは `src/lib`/`src/store`/`src/hooks`/`src/pages` に閉じる。
- 早すぎる抽象化を避ける: `OnlineTable` は `PokerTable` を無理に一般化せず新設（単発モードの回帰リスクを排除）。
```
