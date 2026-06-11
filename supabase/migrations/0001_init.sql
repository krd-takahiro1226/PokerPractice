-- supabase/migrations/0001_init.sql
-- PokerPractice V3 initial schema. All tables: user_id + RLS (owner only).

create extension if not exists "pgcrypto";

-- ============================================================
-- profiles: ユーザ設定（デフォルトモード等）
-- ============================================================
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  default_mode text not null default 'tournament',
  migrated_at  timestamptz,            -- localStorage 一括移行済みフラグ（null=未移行）
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ============================================================
-- versus_sessions: 対戦セッション（トーナメント/キャッシュ）
-- ============================================================
create table if not exists public.versus_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  format         text not null,         -- 'tournament' | 'cash'
  mode           text not null,         -- GameMode: 'tournament'|'cash-ante'|'cash-noante'
  difficulty     text not null,         -- 'easy'|'normal'|'hard'
  starting_stack integer not null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  result         text,                  -- 'bust' | 'win' | 'quit' | null(進行中)
  hands_played   integer not null default 0,
  -- ハンドごとのスタック推移（軽量グラフ用）。number[]（ハンド終了時のヒーロースタック）
  stack_curve    jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists versus_sessions_user_idx on public.versus_sessions (user_id, started_at desc);

-- ============================================================
-- versus_hands: ハンド履歴（SavedHand 相当 jsonb + 集計列）
-- ============================================================
create table if not exists public.versus_hands (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  session_id  uuid references public.versus_sessions(id) on delete cascade,  -- 単発モードは null
  ts          bigint not null,          -- SavedHand.ts（クライアント生成のミリ秒）
  mode        text not null,            -- GameMode
  hero_pos    text not null,            -- Position
  hero_net    numeric not null,         -- bb 収支
  payload     jsonb not null,           -- SavedHand 全体（board/log/result/heroHole 等）
  created_at  timestamptz not null default now()
);
create index if not exists versus_hands_user_idx on public.versus_hands (user_id, ts desc);
create index if not exists versus_hands_session_idx on public.versus_hands (session_id);

-- ============================================================
-- quiz_attempts: 全ドリル統一イベントログ
-- ============================================================
create table if not exists public.quiz_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ts          bigint not null,
  drill_kind  text not null,            -- 'range'|'quiz'|'potOdds'|'reqEquity'|'mdf'|'cbet'
  scenario_id text,                     -- 'RFI_UTG' 等。無い場合 null
  position    text,                     -- Position（あれば）
  hand_class  text,                     -- HandClass（あれば）
  expected    text not null,            -- 正解の表現（文字列化）
  answered    text not null,            -- ユーザの解答（文字列化）
  correct     boolean not null,
  payload     jsonb not null default '{}'::jsonb,  -- ドリル固有の追加情報
  created_at  timestamptz not null default now()
);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id, ts desc);
create index if not exists quiz_attempts_kind_idx on public.quiz_attempts (user_id, drill_kind);

-- ============================================================
-- bookmarks: 復習用ブックマーク（問題識別子 + メモ）
-- ============================================================
create table if not exists public.bookmarks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  problem_key text not null,            -- 問題の一意識別子（§7.3 で定義）
  note        text,
  created_at  timestamptz not null default now(),
  unique (user_id, problem_key)
);
create index if not exists bookmarks_user_idx on public.bookmarks (user_id, created_at desc);

-- ============================================================
-- custom_ranges: ユーザ別カスタムレンジ
-- ============================================================
create table if not exists public.custom_ranges (
  user_id    uuid not null references auth.users(id) on delete cascade,
  range_key  text not null,             -- §4.1 の rangeKey
  range      jsonb not null,            -- Range（Record<HandClass, HandAction>）
  updated_at timestamptz not null default now(),
  primary key (user_id, range_key)
);

-- ============================================================
-- RLS: 全テーブル「本人のみ read/write」
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.versus_sessions enable row level security;
alter table public.versus_hands    enable row level security;
alter table public.quiz_attempts   enable row level security;
alter table public.bookmarks       enable row level security;
alter table public.custom_ranges   enable row level security;

-- profiles
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- versus_sessions
create policy "vs_sessions_select_own" on public.versus_sessions for select using (auth.uid() = user_id);
create policy "vs_sessions_insert_own" on public.versus_sessions for insert with check (auth.uid() = user_id);
create policy "vs_sessions_update_own" on public.versus_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vs_sessions_delete_own" on public.versus_sessions for delete using (auth.uid() = user_id);

-- versus_hands
create policy "vs_hands_select_own" on public.versus_hands for select using (auth.uid() = user_id);
create policy "vs_hands_insert_own" on public.versus_hands for insert with check (auth.uid() = user_id);
create policy "vs_hands_delete_own" on public.versus_hands for delete using (auth.uid() = user_id);

-- quiz_attempts
create policy "quiz_attempts_select_own" on public.quiz_attempts for select using (auth.uid() = user_id);
create policy "quiz_attempts_insert_own" on public.quiz_attempts for insert with check (auth.uid() = user_id);
create policy "quiz_attempts_delete_own" on public.quiz_attempts for delete using (auth.uid() = user_id);

-- bookmarks
create policy "bookmarks_select_own" on public.bookmarks for select using (auth.uid() = user_id);
create policy "bookmarks_insert_own" on public.bookmarks for insert with check (auth.uid() = user_id);
create policy "bookmarks_update_own" on public.bookmarks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bookmarks_delete_own" on public.bookmarks for delete using (auth.uid() = user_id);

-- custom_ranges
create policy "custom_ranges_select_own" on public.custom_ranges for select using (auth.uid() = user_id);
create policy "custom_ranges_insert_own" on public.custom_ranges for insert with check (auth.uid() = user_id);
create policy "custom_ranges_update_own" on public.custom_ranges for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "custom_ranges_delete_own" on public.custom_ranges for delete using (auth.uid() = user_id);
