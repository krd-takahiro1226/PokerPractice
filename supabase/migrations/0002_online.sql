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
  -- TournamentState のミラー（hole/deck を含まず秘匿情報ゼロ）。
  -- 結果画面の stackCurve/順位に使う。権威は room_engine.state.tournament（クライアント読取不可）。
  tournament  jsonb not null default '{}'::jsonb,
  action_deadline timestamptz,                      -- 現 toAct の締切（タイムアウト用）
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- room_engine: 完全なエンジン状態（deck+全hole）。クライアント読取不可。
-- state の中身は { tournament: TournamentState, hand: GameState | null }
--   - tournament: トーナメント全体の状態（スタック・順位・レベル等）。ハンド間も常駐。
--   - hand: 進行中ハンドの完全な GameState（deck/全hole含む）。ハンド間は null。
-- ============================================================
create table if not exists public.room_engine (
  room_id   uuid primary key references public.rooms(id) on delete cascade,
  version   integer not null default 0,             -- 楽観ロックの真実
  state     jsonb not null default '{}'::jsonb,     -- { tournament: TournamentState, hand: GameState | null }
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
-- Realtime: UPDATE/DELETE でも変更前後の全カラムを配信するため replica identity を full に。
-- （デフォルトの primary key のみでは、DELETE/UPDATE の old record 全体が Realtime ペイロードに
--   含まれず、クライアント側の楽観的マージや削除検知が壊れるため。INSERT のみのテーブルには
--   実害はないが、将来 UPDATE/DELETE を扱う変更に備えて統一する。）
-- ============================================================
alter table public.room_states     replica identity full;
alter table public.room_players    replica identity full;
alter table public.room_hole_cards replica identity full;

-- ============================================================
-- Realtime: 公開状態と参加者一覧のみ発行対象に追加
-- ============================================================
alter publication supabase_realtime add table public.room_states;
alter publication supabase_realtime add table public.room_players;
-- room_hole_cards は本人配信のため任意で追加可（RLSで本人行のみ届く）:
alter publication supabase_realtime add table public.room_hole_cards;
