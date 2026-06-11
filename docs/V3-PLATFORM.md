# V3-PLATFORM — Supabaseバックエンド / レンジ刷新・カスタマイズ / 10-max / 対戦セッション / 統計・復習 設計ドキュメント

PokerPractice を「ログイン+クラウド保存つきの学習プラットフォーム」へ拡張する V3 設計。
本ドキュメントは **Sonnet が単独で実装着手できる粒度**（型定義・関数シグネチャ・ファイル配置・完全なSQL・UI変更点・テスト方針・フェーズ分割）まで具体化したものであり、RANGES-V2.md と同等の具体度を満たす唯一の成果物である。

## 前提（変更禁止 / 不変条件）

- `src/core/ranges/yokosawa.ts` の現在のティアデータは **ユーザーが手修正済みの ground truth。一切変更しない**。RANGES-V2.md §1 のリテラルは古いので参照しない（構造説明としてのみ参照可）。本ドキュメントのコード例で `TIER1..TIER7` / `BB_CALL` を参照する場合も **import するだけ**で、中身を書き換えない。
- `src/core/` は React 非依存の純粋TSを維持（テスト容易性・Worker利用のため）。Supabase クライアント・認証・同期は `src/core/` の外（`src/lib/`, `src/store/`, `src/hooks/`, `src/pages/`）に置く。
- UI言語は日本語。ポーカー用語（open, RFI, 3bet, call, ante, BB ante 等）は英語のまま。
- 静的SPA + Vercel無料枠の構成を維持（サーバーコードなし）。Supabase はクライアントから `@supabase/supabase-js` で直接叩く。
- **env 未設定 or 未ログイン時は現行どおり localStorage で全機能が動作（ゲストモード）**。ログイン時は DB が正。
- RANGES-V2.md は **すでに実装完了済み**（`yokosawa.ts` / `mode.ts` / `rfi.ts` / `vsOpen.ts` / `GameConfig.mode/ante` / `SavedHand.mode` migration v2 すべて反映済み）。V3 はこの土台の上に積む。

---

## 0. スコープと重要な設計判断（サマリ）

| 論点 | 判断 |
|---|---|
| バックエンド | Supabase（Postgres + Auth + RLS）。`@supabase/supabase-js` をクライアント直叩き。 |
| env | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。未設定なら `supabase = null` で全機能 localStorage 動作。 |
| 認証 | Supabase Auth の Google OAuth のみ（初版）。 |
| データ所有 | 全テーブル `user_id` 列 + RLS「本人のみ read/write」。 |
| ゲスト→ログイン移行 | 初回ログイン時に localStorage の履歴/進捗/カスタムレンジを **一回限り**一括インポート（`migrated_at` フラグで二重移行防止）。 |
| 永続化の単一API | `src/store/persistence.ts` に `DataPort` 抽象を置き、ログイン時=Supabase / ゲスト時=localStorage を切替。各ストアはこの port 経由。 |
| レンジ単一ソース | `getEffectiveRange(rangeKey, mode)` を `src/core/ranges/effective.ts` に新設。custom > デフォルト導出。RangeTrainer/ドリル/reviewHand/AI が全てこれ経由。**core はカスタムレンジを「注入された store snapshot」として受け取り、React/Supabase に依存しない**（§4）。 |
| vs-open バグ修正 | vs-open ディフェンスをヨコサワ tier から導出する単一ロジックに刷新。BB vs CO で T9o が call になることをテストで保証（§3）。RangeTrainer に vs-open チャートを追加し、FB と同一オブジェクトを参照。 |
| 10-max | RangeTrainer に人数セレクタ（2〜10）。`SeatLabel` 一般化型を新設。対戦エンジンは 6-max 据え置き（§5）。 |
| 対戦セッション | トーナメント/キャッシュの2形式。`src/core/game/session.ts`（純TS、スタック持ち越し・ブラインドレベル）を engine.ts の上位に新設。engine.ts のストリート進行は据え置き（§6）。 |
| 統計・復習 | `quiz_attempts` イベントログを新設し統計はログから集計。`bookmarks` で復習。`src/pages/Stats.tsx` / `Review.tsx` 新規（§7）。progress.ts は残す。 |
| クイズ統一スキーマ | 全ドリル（range/quiz/potOdds/reqEquity/mdf/cbet）を `QuizAttempt` 統一型で記録。`recordAttempt()` 単一API（§7.1）。 |

### フェーズ依存
- **Phase A**（レンジ刷新）: Supabase 非依存で完結。
- **Phase B**（Supabase 基盤）: A に非依存だが、C/D が依存。
- **Phase C**（統計・復習・レンジカスタマイズ）: A + B に依存。
- **Phase D**（対戦セッション）: B に依存。

各フェーズ末で `npm run build` / `npm run test` が通る独立単位。

---

## 1. 依存追加・環境

### 1.1 npm 依存

```jsonc
// package.json dependencies に追加
"@supabase/supabase-js": "^2"
```

グラフは依存追加せず **軽量 SVG 自作**（§6.6）。理由: chart ライブラリは bundle が重く、折れ線1本に過剰。

### 1.2 環境変数（Vite）

| 変数 | 用途 | 例 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase プロジェクト URL | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon public key | `eyJ...` |

- ローカル: `.env.local`（gitignore 済みを確認。無ければ `.gitignore` に追記）。
- Vercel: Project Settings → Environment Variables に両方を設定（Production/Preview/Development）。
- **両方が空 or undefined のとき `supabase = null`**。アプリは全機能 localStorage で動作（ゲスト）。

### 1.3 Supabase クライアント — `src/lib/supabase.ts`（新規）

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** env 未設定なら null（= ゲストモード）。アプリ全体はこの null チェックで分岐する。 */
export const supabase: SupabaseClient | null =
  url && anon ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export const isBackendEnabled = supabase !== null;
```

### 1.4 セットアップ手順（README へ追記する内容）

`README.md` に「## クラウド同期（任意）」節を追加し、以下を逐語で記載すること:

1. **Supabase プロジェクト作成**: supabase.com でプロジェクトを作成。Settings → API から `Project URL` と `anon public` キーを控える。
2. **マイグレーション適用**: Supabase Dashboard → SQL Editor に `supabase/migrations/0001_init.sql`（§2）を貼り付けて実行。
3. **Google OAuth 設定**: Authentication → Providers → Google を有効化。Google Cloud Console で OAuth クライアントを作成し、承認済みリダイレクト URI に `https://<project-ref>.supabase.co/auth/v1/callback` を登録。Client ID / Secret を Supabase に貼る。Authentication → URL Configuration の Site URL に本番 URL（Vercel ドメイン）と `http://localhost:5173` を追加。
4. **Vercel env 設定**: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定して再デプロイ。
5. env を設定しなければ従来どおりゲスト（localStorage）動作のまま、と明記。

---

## 2. SQL マイグレーション — `supabase/migrations/0001_init.sql`（新規・逐語）

ファイルを **そのまま** 作成する。全テーブル `user_id uuid` + RLS「本人のみ」。

```sql
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
```

> 設計判断: 統計はビューやストアドではなく **クライアント側集計**（`quiz_attempts` を SELECT して JS で集計）。データ量は1ユーザ数千行で十分小さく、Vercel/Supabase 無料枠の負荷も軽い。複雑化を避ける。

---

## 3. Phase A — vs-open レンジ刷新・FB修正・単一ソース化

### 3.1 バグの正確な原因（確認済み）

- `reviewHand.ts` の `reviewVsOpen` は **ポジションを正しく見ている**（`getVsOpen(heroPos, openerPos)`）。位置バグではない。
- 原因は **データ不整合**: `vsOpen.ts` の `BB_vs_CO` は手書きの簡易レンジで `T9o` を含まない。一方ユーザが見るヨコサワ表では `T9o` は tier6 にあり、BB defense（tier 由来）のコールレンジには入るべき。
- かつ **vs-open レンジが UI のどこにも表示されない**ため、ユーザは「FBが使うレンジ」を確認できない。
- 修正方針: vs-open ディフェンスを **ヨコサワ tier から導出する単一ロジック**に刷新し、全ポジション組合せを網羅して「レンジデータなし」を撲滅。RangeTrainer に vs-open チャートを追加し、FB と同一オブジェクトを参照させる。

### 3.2 導出ルール（確定）— `src/core/ranges/vsOpen.ts` 全面刷新

オープナーのポジション P の `BASE_MAX_TIER`（`mode.ts` 既存）を `b` とする。ヒーローのディフェンスを次のルールで tier から導出する:

- **3bet (raise)** = `BB_DEF_RAISE`（現行を踏襲・固定）: `['AA','KK','QQ','JJ','AKs','AKo','A5s','A4s']`。
  - うち `A5s,A4s` は bluff、それ以外は value。**モード非依存・ヒーローポジション非依存**で固定。
- **call** = ヒーローがBBか否かで base を変える:
  - **BB がヒーロー**: `call = tier2..min(7, b+1) のハンド` − `{3betハンド}`。さらに **オープナーが BTN のときのみ** `BB_CALL` 層を追加。
  - **BB 以外（SB/BTN 等）がヒーロー**: `call = tier2..b のハンド`（`+1` しない）− `{3betハンド}`。
- 「tierK..tierM のハンド」は `TIERS.slice(K-1, M).flat()`（K,M は 1始まり）。
- `b` は `BASE_MAX_TIER[openerPos]`（UTG/HJ=5, CO=6, BTN=7, SB=7）。**vs-open は mode 非依存**（RANGES-V2 の方針を踏襲。ante/トーナメント差で BB defense を動かさない簡易設計）。

> **検証必須**: BB vs CO で `b=6` → call = tier2..min(7,7)=tier2..tier7、`T9o`（tier6）が含まれる → call になる。これをテストに明記（§3.5）。

#### 3.2.1 網羅する (hero, opener) 組合せ

オープナーは UTG/HJ/CO/BTN/SB、ヒーローは「そのオープナーより後ろの全ポジション」。アクション順 `UTG < HJ < CO < BTN < SB < BB`（`POS_ORDER`）で opener より後ろを列挙:

| opener | hero 候補（後ろ） |
|---|---|
| UTG | HJ, CO, BTN, SB, BB |
| HJ | CO, BTN, SB, BB |
| CO | BTN, SB, BB |
| BTN | SB, BB |
| SB | BB |

全 15 組合せを生成し「レンジデータなし」を撲滅する。

### 3.3 実装シグネチャ — `src/core/ranges/vsOpen.ts`

`VsOpenScenario` 型・`getVsOpen` シグネチャ・`VSOPEN_SCENARIOS` の **構造は維持**。生成ロジックを差し替える。

```ts
// src/core/ranges/vsOpen.ts （全面刷新）
import { TIERS, BB_CALL } from './yokosawa';
import type { HandClass } from '../handNotation';
import type { Position, Range } from './types';

export type VsOpenScenario = {
  id: string;
  label: string;
  heroPos: Position;
  villainPos: Position;
  range: Range;
};

/** アクション順（プリフロップ）。opener より後ろ＝この配列でindexが大きい側。 */
const POS_ORDER: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/** opener の使用最大tier（=後ろ人数ベース）。mode.ts の BASE_MAX_TIER と一致させる。 */
const OPENER_BASE_TIER: Record<Position, number> = {
  UTG: 5, HJ: 5, CO: 6, BTN: 7, SB: 7, BB: 0,
};

/** value/bluff 3bet（固定・mode非依存・heroPos非依存）。 */
const BB_DEF_RAISE: HandClass[] = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'A5s', 'A4s'];
const RAISE_SET = new Set<HandClass>(BB_DEF_RAISE);

/** tier K..M（1始まり, 両端含む）を flat 展開。 */
function tierSlice(fromTier1: number, toTier1: number): HandClass[] {
  if (toTier1 < fromTier1) return [];
  return TIERS.slice(fromTier1 - 1, toTier1).flat();
}

/** (hero, opener) → defense Range を導出。 */
function deriveDefense(heroPos: Position, openerPos: Position): Range {
  const b = OPENER_BASE_TIER[openerPos];
  const isBB = heroPos === 'BB';
  // call の最大tier
  const callMaxTier = isBB ? Math.min(7, b + 1) : b;
  const callHands: HandClass[] = tierSlice(2, callMaxTier).filter((h) => !RAISE_SET.has(h));
  // BB が BTN のオープンに対するときのみ bbCall 層を追加
  if (isBB && openerPos === 'BTN') {
    for (const h of BB_CALL) if (!RAISE_SET.has(h)) callHands.push(h);
  }
  const range: Range = {};
  for (const h of callHands) range[h] = { call: 1 };
  for (const h of BB_DEF_RAISE) range[h] = { raise: 1 }; // raise 優先で上書き
  return range;
}

function posLabel(p: Position): string { return p; }

function buildScenarios(): VsOpenScenario[] {
  const out: VsOpenScenario[] = [];
  for (let oi = 0; oi < POS_ORDER.length; oi++) {
    const openerPos = POS_ORDER[oi];
    if (OPENER_BASE_TIER[openerPos] === 0) continue; // BB は opener にならない
    for (let hi = oi + 1; hi < POS_ORDER.length; hi++) {
      const heroPos = POS_ORDER[hi];
      out.push({
        id: `vs${openerPos}_from${heroPos}`,
        label: `vs ${posLabel(openerPos)} open（あなた${posLabel(heroPos)}）`,
        heroPos,
        villainPos: openerPos,
        range: deriveDefense(heroPos, openerPos),
      });
    }
  }
  return out;
}

export const VSOPEN_SCENARIOS: VsOpenScenario[] = buildScenarios();

export function getVsOpen(heroPos: Position, villainPos: Position): VsOpenScenario | undefined {
  return VSOPEN_SCENARIOS.find((s) => s.heroPos === heroPos && s.villainPos === villainPos);
}
```

> 旧 `tokensToRangeWithActions` ベースの手書き `BB_vs_CO` / `SB_vs_BTN` / `BTN_vs_CO` / `BB_vs_UTG` は **すべて削除**。これらは導出で置換される。`expand.ts` への import は不要になるので削除。

### 3.4 RangeTrainer に vs-open チャートを追加（単一ソース）

`src/pages/RangeTrainer.tsx` の `ChartView` に「閲覧対象」セレクタを追加し、**RFI** と **vs open ディフェンス**を切替表示する。表示に使う Range は **`getVsOpen(...).range` そのもの**（FB が参照するのと同一オブジェクト）。

- `ChartView` に内部 state `chartKind: 'rfi' | 'vsOpen'` を追加。
- `vsOpen` 選択時: opener × hero のセレクタ（`VSOPEN_SCENARIOS` から生成）。選んだ scenario の `range` を `<RangeGrid>` に渡す。
- 凡例: raise=3bet（緑）、call（青）、fold（灰）と注記。`vs-open は全モード共通` と明記。
- DrillView も `chartKind` に応じて vs-open ドリルを出題可能にする（任意・MVPでは RFI のみで可。ただし vs-open チャート閲覧は必須）。

> **「FBが使うレンジと表示レンジを同一オブジェクト」要件**: RangeTrainer / reviewHand / preflop AI はすべて `getVsOpen` を呼ぶ。`getVsOpen` の戻り Range は `VSOPEN_SCENARIOS` の同一参照なので、自動的に単一ソースになる。テストで `getVsOpen('BB','CO') === VSOPEN_SCENARIOS.find(...)` の参照同一性を確認する。

### 3.5 Phase A テスト方針

新規/更新（Vitest, `src/core/ranges/vsOpen.test.ts`）:

1. **T9o バグ回帰**: `getVsOpen('BB','CO')!.range['T9o']` の `primaryAction` が `'call'`。
2. **3bet 固定**: `AA/KK/QQ/JJ/AKs/AKo` が `raise`、`A5s/A4s` が `raise`（bluff）。`A3s`/`T8s` は `call`。
3. **BB vs BTN の bbCall 層**: `getVsOpen('BB','BTN')!.range` に `BB_CALL` 由来（例 `'A2o'`, `'87o'`）が `call` で含まれる。BB vs CO には bbCall 層が **含まれない**（例 `'A2o'` が undefined/fold）。
4. **網羅**: 全15組合せが `VSOPEN_SCENARIOS` に存在（opener×hero マトリクス）。各 scenario の id が `vs<opener>_from<hero>`。
5. **非BBは +1 しない**: `getVsOpen('SB','BTN')` の callMaxTier=7（b=7 で同じ）、`getVsOpen('BTN','CO')` の callMaxTier=6（b=6, +1なし）→ tier7 のハンド（例 `'54s'`）が含まれない。
6. **raise/call 排他**: 全 scenario で同一ハンドに raise と call が同時に立たない（raise 優先）。
7. **参照同一性**: `getVsOpen(h,o)` が `VSOPEN_SCENARIOS` 内の同一オブジェクトを返す。

受け入れ条件: 上記テスト緑 + `npm run build` 緑。reviewHand の既存テスト（`reviewHand.test.ts`）が新導出レンジで通る（必要なら期待値を導出値に合わせて更新）。

---

## 4. レンジカスタマイズ + 単一解決API（Phase C、coreはA段階で用意）

### 4.1 rangeKey とエフェクティブレンジ — `src/core/ranges/effective.ts`（新規）

レンジを一意に指す `RangeKey` を定義し、`getEffectiveRange(key, mode, custom)` で「custom > デフォルト導出」を解決する。**core は React/Supabase を知らない**。カスタムは「呼び出し側が渡す snapshot（`Record<RangeKey, Range>`）」として受け取る。

```ts
// src/core/ranges/effective.ts
import { getRfiRange } from './rfi';
import { getVsOpen } from './vsOpen';
import { type GameMode } from './mode';
import type { Position, Range } from './types';

/** RFI: `RFI_<pos>` / vsOpen: `VSOPEN_<opener>_<hero>`。 */
export type RangeKey = `RFI_${Position}` | `VSOPEN_${Position}_${Position}`;

export type CustomRanges = Partial<Record<RangeKey, Range>>;

export function rfiKey(pos: Position): RangeKey { return `RFI_${pos}`; }
export function vsOpenKey(opener: Position, hero: Position): RangeKey {
  return `VSOPEN_${opener}_${hero}`;
}

/** デフォルト導出（custom なし）。RFI は mode 依存、vsOpen は mode 非依存。 */
export function defaultRange(key: RangeKey, mode: GameMode): Range | undefined {
  if (key.startsWith('RFI_')) {
    const pos = key.slice(4) as Position;
    return getRfiRange(mode, pos);
  }
  // VSOPEN_<opener>_<hero>
  const [, opener, hero] = key.split('_') as [string, Position, Position];
  return getVsOpen(hero, opener)?.range;
}

/** custom があれば優先、無ければデフォルト導出。 */
export function getEffectiveRange(
  key: RangeKey,
  mode: GameMode,
  custom?: CustomRanges,
): Range | undefined {
  const c = custom?.[key];
  if (c && Object.keys(c).length > 0) return c;
  return defaultRange(key, mode);
}
```

### 4.2 呼び出し側の切替（custom 注入）

| 呼び出し元 | 変更 |
|---|---|
| `RangeTrainer.tsx`（チャート/ドリル） | `useCustomRanges()`（§4.4）の snapshot を `getEffectiveRange(key, mode, custom)` に渡して表示・出題 |
| `reviewHand.ts`（`reviewRFI`/`reviewVsOpen`/`buildVillainRangeFromLog`） | 引数に `custom?: CustomRanges` を追加（`reviewHand(hand, custom?)`）。各所で `getEffectiveRange(...)`。custom 無指定なら従来挙動 |
| `preflop.ts`（`decidePreflopRFI`/`VsOpen`） | **変更しない**（CPU は常にデフォルトレンジでプレイ。カスタムは「ヒーローの学習対象」であり相手AIを歪めない）。設計判断として明記 |

> **reviewHand の custom 注入経路**: `reviewHand(hand)` を呼ぶ UI（Versus の HandReviewPanel）が `useCustomRanges()` の snapshot を第2引数で渡す。core 自体は store を知らない。

### 4.3 カスタムレンジ保存ストア — `src/store/customRanges.ts`（新規）

ログイン時 `custom_ranges` テーブル、ゲスト時 localStorage。`DataPort`（§5.2 of Phase B... ここでは §8.1）経由。

```ts
// src/store/customRanges.ts
import { create } from 'zustand';
import type { CustomRanges, RangeKey } from '../core/ranges/effective';
import type { Range } from '../core/ranges/types';

type CustomRangesState = {
  ranges: CustomRanges;
  loaded: boolean;
  load: () => Promise<void>;                          // port から読み込み（ログイン/ゲスト両対応）
  setRange: (key: RangeKey, range: Range) => void;    // 1キーを上書き保存
  resetRange: (key: RangeKey) => void;                // デフォルトに戻す（custom 削除）
  resetAll: () => void;
};
```

- 永続化は §8.1 の `rangesPort`（ログイン=Supabase upsert / ゲスト=localStorage `poker-trainer-custom-ranges`）。
- `setRange` は楽観的更新 + port へ書き込み（失敗は握りつぶしてローカル保持）。

### 4.4 カスタム編集UI — RangeTrainer 内「編集モード」

`ChartView` に「編集」トグルを追加（MVP は専用コンポーネント不要、`RangeGrid` にクリックハンドラを足す）。

- 編集ON時: セルクリックで `raise → call → fold → raise` の3状態サイクル（pure 戦略のみ。混合頻度編集は対象外）。
- 変更は `setRange(key, nextRange)` で保存。「リセット」ボタンで `resetRange(key)`（デフォルト導出に戻る）。
- 表示中の Range は常に `getEffectiveRange(key, mode, custom)`。custom があればバッジ「カスタム」を表示。
- `RangeGrid.tsx` に `onCellClick?: (hand: HandClass) => void` prop を追加（既存表示は不変、prop 省略時は従来表示）。

### 4.5 Phase C（カスタム部分）テスト

- `effective.test.ts`: `getEffectiveRange('RFI_UTG','tournament')` がデフォルト導出と一致。custom を渡すと custom を返す。空 custom (`{}`) は無視してデフォルト。
- `vsOpenKey`/`rfiKey` の往復、`defaultRange('VSOPEN_CO_BB','tournament')` が `getVsOpen('BB','CO').range` と一致。

---

## 5. 10-max レンジ確認（Phase A、対戦エンジンは 6-max 据え置き）

### 5.1 一般化型 `SeatLabel` — `src/core/ranges/seats.ts`（新規）

既存 `Position`（6-max, 対戦エンジン用）は **変更しない**。レンジ表用に別の一般化型を導入。

```ts
// src/core/ranges/seats.ts
export type SeatLabel = string; // 'UTG'|'UTG1'|'LJ'|'HJ'|'CO'|'BTN'|'SB'|'BB' 等

/** 人数 n（2..10）に応じた席ラベル配列をアクション順（UTG→…→BB）で返す。末尾2つが SB,BB。 */
export function seatLabels(n: number): SeatLabel[] {
  // 後ろから固定: BTN, SB, BB は常に存在（n>=2）
  // 前方の早い席を人数に応じて生成
  const tail = ['CO', 'BTN', 'SB', 'BB'];           // n>=4 で CO 以降固定
  const early = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ']; // 早い席の順序（増える方向）
  switch (n) {
    case 2: return ['SB', 'BB'];                       // heads-up（SB=BTN）
    case 3: return ['BTN', 'SB', 'BB'];
    case 4: return ['CO', 'BTN', 'SB', 'BB'];
    case 5: return ['HJ', 'CO', 'BTN', 'SB', 'BB'];
    case 6: return ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    default: {
      // 7..10: UTG, UTG1, ... を必要数だけ前に足す
      const extra = n - 6;                              // 1..4
      const earlies = ['UTG', 'UTG1', 'UTG2', 'LJ'].slice(0, extra + 1); // UTG always
      // 6max の UTG を置き換える形で先頭を組む
      const base = ['HJ', 'CO', 'BTN', 'SB', 'BB'];
      return [...earlies, ...base];
    }
  }
}

/** 席ラベルの「後ろの人数 b」= その席より後ろ（BTN方向、BB含む手前まで）にいる未アクション人数。 */
export function playersBehind(n: number, seatIndex: number): number {
  // seatIndex は seatLabels(n) のインデックス。BB は最後。
  // RFI の「後ろの人数」= 自分より後ろの席数（BB含むがBBは特殊なので RFI 対象外席のみ呼ぶ）
  return n - 1 - seatIndex;
}
```

> **確定仕様（擬似コードではなくこの固定配列を実装すること）**: `seatLabels(n)` は 2..10 の各ケースを以下の固定配列で返す。
>
> | n | ラベル（アクション順） |
> |---|---|
> | 2 | SB, BB |
> | 3 | BTN, SB, BB |
> | 4 | CO, BTN, SB, BB |
> | 5 | HJ, CO, BTN, SB, BB |
> | 6 | UTG, HJ, CO, BTN, SB, BB |
> | 7 | UTG, LJ, HJ, CO, BTN, SB, BB |
> | 8 | UTG, UTG1, LJ, HJ, CO, BTN, SB, BB |
> | 9 | UTG, UTG1, UTG2, LJ, HJ, CO, BTN, SB, BB |
> | 10 | UTG, UTG1, UTG2, UTG3, LJ, HJ, CO, BTN, SB, BB |

### 5.2 人数 → tier の一般化マッピング — `src/core/ranges/seats.ts`

確定ルール（`b` = その席の後ろの人数）:

| b（後ろの人数） | tier |
|---|---|
| b ≥ 8 | tier3 |
| b ∈ {6,7} | tier4 |
| b ∈ {4,5} | tier5 |
| b = 3 | tier6 |
| b ≤ 2 | tier7 |

```ts
/** 後ろ人数 b → 使用最大tier番号(1..7)。tournament/cash-ante 基準。 */
export function maxTierForSeats(b: number): number {
  if (b >= 8) return 3;
  if (b >= 6) return 4;   // 6,7
  if (b >= 4) return 5;   // 4,5
  if (b === 3) return 6;
  return 7;               // b<=2
}

/** cash-noante は 1 tier タイト化。 */
export function maxTierForSeatsMode(b: number, mode: GameMode): number {
  const base = maxTierForSeats(b);
  return mode === 'cash-noante' ? base - 1 : base;
}
```

**6-max との一致テスト（必須）**: 6max で UTG=後ろ5人→tier5, HJ=4→tier5, CO=3→tier6, BTN=2→tier7, SB=1→tier7。これが既存 `BASE_MAX_TIER`（UTG/HJ=5, CO=6, BTN/SB=7）と一致することを `seats.test.ts` で担保。

### 5.3 RangeTrainer 人数セレクタ

- `RangeTrainer` 親に `seatCount` state（既定6, 範囲2..10）。セレクタ（数値 pill or `<select>`）を追加。
- `ChartView` は `seatCount` から `seatLabels(seatCount)` を生成し、各席（BB除く RFI 対象席）について `maxTierForSeatsMode(b, mode)` で `TIERS.slice(0, maxTier).flat()` を Range 化して表示。
- 席ごとの「後ろ N人 → tier1..tierK」をティア早見に表示（既存 TierLegend を流用）。
- **vs-open / カスタム編集は 6-max のみ**（10-max は閲覧専用、RFI tier 表示に限定）。10-max 選択時は「閲覧のみ」注記。

### 5.4 Phase A テスト（seats）

- `seatLabels(6)` = `['UTG','HJ','CO','BTN','SB','BB']`。`seatLabels(10)` の長さ=10、末尾2つが `['SB','BB']`、先頭が `'UTG'`。
- `maxTierForSeats`: b=8→3, b=7→4, b=5→5, b=3→6, b=2→7, b=1→7。
- 6max 整合: UTG(b=5)→5, CO(b=3)→6, BTN(b=2)→7, SB(b=1)→7 が `BASE_MAX_TIER` と一致。
- `maxTierForSeatsMode(5,'cash-noante')`=4。

---

## 6. Phase D — 対戦セッション（トーナメント / キャッシュ）

### 6.1 設計の核心: engine 据え置き、session 層を新設

`engine.ts` の `startHand/applyAction/advanceStreet/resolveShowdown` は **1ハンドのストリート進行**に責任を限定したまま（変更しない）。スタック持ち越し・ブラインドレベル・終了判定は **上位の session 層**で管理する。

問題: 現行 `startHand` は毎ハンド `stack = config.startingStack` で全員リセットする（engine.ts 103-113行）。セッションでは前ハンドのスタックを持ち越す必要がある。

**最小変更方針**: `startHand` に「初期スタックを seat ごとに上書きする任意引数」を追加する（後方互換）。

```ts
// engine.ts: startHand のシグネチャ拡張（後方互換）
export function startHand(
  prev: GameState | null,
  config: GameConfig,
  seatStacks?: number[],   // ★追加。長さ6。指定時は config.startingStack の代わりに使う
): GameState;
```

- `seatStacks` 省略時は現行どおり `config.startingStack`（単発モード・テストは無改修）。
- 指定時は `players[i].stack = seatStacks[i]` で初期化。SB/BB/ante 投下はそのスタックから引く。
- スタック0の席は all-in 扱い（既存ガードを流用）。トーナメントで bust した席はそのハンドに参加しない扱いだが、**MVP では席数固定6**で「スタック0の席はブラインドを払えず即fold/skip」とする（§6.2 で簡略化）。

### 6.2 session 層 — `src/core/game/session.ts`（新規・純TS）

```ts
// src/core/game/session.ts
import type { GameConfig, GameState } from './types';
import type { GameMode } from '../ranges/mode';

export type SessionFormat = 'tournament' | 'cash';

export type BlindLevel = { sb: number; bb: number; ante: number };

export type SessionConfig = {
  format: SessionFormat;
  mode: GameMode;
  difficulty: GameConfig['difficulty'];
  startingStack: number;          // 全席同一（bb 単位 or チップ）
  /** tournament のみ: レベル表 + 何ハンドごとに上げるか。cash は単一固定レベル。 */
  blindLevels: BlindLevel[];      // index 0 = level1
  handsPerLevel: number;          // 例 10（tournament）。cash は実質無視（level 固定）
};

// format と mode の整合は UI 側で制約する（core では検証しない）:
//   format='tournament' → mode='tournament' 固定
//   format='cash'       → mode は 'cash-ante' | 'cash-noante' から選択（ante 有無）


export type SessionState = {
  config: SessionConfig;
  seatStacks: number[];           // 長さ6。ハンド間で持ち越す現在スタック
  handNumber: number;             // セッション内通し番号（1始まり）
  currentLevel: number;           // 0始まり（blindLevels の index）
  stackCurve: number[];           // ハンド終了時のヒーロー(seat0)スタック推移
  status: 'active' | 'bust' | 'win' | 'quit';
};

/** セッション開始: 全席 startingStack。 */
export function startSession(config: SessionConfig): SessionState;

/** 現在のブラインドレベルから GameConfig を構築（startHand に渡す）。 */
export function configForHand(s: SessionState): GameConfig;

/** ハンド終了後の GameState を受け取り、スタック持ち越し・レベル更新・終了判定を行う。 */
export function commitHandResult(s: SessionState, ended: GameState): SessionState;

/** 次ハンドを開始すべきか（active かつ複数席に有効スタックがある）。 */
export function canContinue(s: SessionState): boolean;
```

#### 6.2.1 ロジック仕様（逐語）

- `startSession`: `seatStacks = Array(6).fill(startingStack)`, `currentLevel=0`, `handNumber=0`, `stackCurve=[startingStack]`, `status='active'`。
- `configForHand`: `currentLevel` の `BlindLevel` を使い `{ ...base, sb, bb, ante, mode, difficulty, startingStack }` を返す。`startHand(prev, configForHand(s), s.seatStacks)` で呼ぶ。
- `commitHandResult(s, ended)`:
  1. `seatStacks[i] = ended.players[i].stack`（resolveShowdown 後の最終スタック）。
  2. `stackCurve.push(seatStacks[0])`。
  3. `handNumber += 1`。
  4. **tournament のレベルアップ**: `format==='tournament'` かつ `handNumber % handsPerLevel === 0` かつ `currentLevel < blindLevels.length-1` → `currentLevel += 1`。
  5. **終了判定**:
     - tournament: ヒーロー(seat0) `stack <= 0` → `status='bust'`。他5席が全員 `stack<=0`（= ヒーロー独り勝ち）→ `status='win'`。
     - cash: 自動終了なし（ユーザが quit するまで `active`）。
  6. **スタック補充（cash のリバイ/トップアップ）**: MVP では **なし**（任意設計と明記）。cash でヒーローが 0 になったら `status='bust'`（再戦は新セッション）。
- `canContinue`: `status==='active'` かつ「有効スタック（>0）の席が2以上」。

> **ブラインドが払えない席の扱い（MVP簡略化）**: 6席固定を維持し、`startHand` で `seatStacks` を渡す。スタックが SB/BB 未満の席はブラインド投下で all-in になる（既存 `Math.min` ガードで処理済み）。**席の除外（bust seat の再構成）は MVP では行わない**——スタック0の席は次ハンドで「ブラインド=0、即fold相当」になり実質不参加。これによりトーナメントの厳密な席数縮小は省略しつつ、ヒーローの bust/win 判定は成立する。設計判断として割り切る。

#### 6.2.2 デフォルトのブラインドレベル表（トーナメント）

```ts
// session.ts に定数として
export const DEFAULT_TOURNAMENT_LEVELS: BlindLevel[] = [
  { sb: 0.5, bb: 1, ante: 1 },   // level1
  { sb: 1, bb: 2, ante: 2 },     // level2
  { sb: 1.5, bb: 3, ante: 3 },
  { sb: 2, bb: 5, ante: 5 },
  { sb: 3, bb: 8, ante: 8 },
  { sb: 5, bb: 12, ante: 12 },
];
export const DEFAULT_HANDS_PER_LEVEL = 10;

export const CASH_LEVEL_ANTE: BlindLevel = { sb: 0.5, bb: 1, ante: 1 };   // cash-ante
export const CASH_LEVEL_NOANTE: BlindLevel = { sb: 0.5, bb: 1, ante: 0 }; // cash-noante
```

- cash は `blindLevels=[CASH_LEVEL_ANTE or NOANTE]`, `handsPerLevel=Infinity` 相当（レベル固定）。
- 開始スタック選択: トーナメント=`50/100/200`（チップ表記＝bb 単位の数値、ラベルだけ「チップ」）、キャッシュ=`50/100/200`bb。

### 6.3 単発モードとの関係（設計判断）

- **並存**。既存 Versus の「1ハンド単発」モードは残す（`useVersusGame` 現行）。
- Versus 画面にタブ/トグルを追加: 「単発」/「セッション」。
- セッションは新フック `useVersusSession`（§6.4）が `useVersusGame` のハンド進行ロジックを内包しつつ `session.ts` で持ち越す。
- 既存 `useVersusGame` は単発モード専用として温存（リファクタしない＝リスク最小）。セッション用に別フックを立てる。

### 6.4 セッション用フック — `src/hooks/useVersusSession.ts`（新規）

`useVersusGame` のループ駆動（CPU処理・advance・cleanup）を踏襲し、ハンド終了時に `commitHandResult` でスタックを持ち越して `startHand(prev, configForHand, seatStacks)` で次ハンドを開始する。

```ts
export type VersusSessionController = {
  session: SessionState;
  game: GameState;
  legal: LegalActions | null;
  isHeroTurn: boolean;
  heroAct: (action: PlayerAction) => void;
  nextHand: () => void;          // 手動 or 自動で次ハンド
  quit: () => void;              // セッション終了（status='quit'）→ DB保存
  start: (config: SessionConfig) => void;
};
```

- ハンド終了 → `commitHandResult` → `canContinue` なら `nextHand` 可、不可なら status を確定。
- セッション終了（bust/win/quit）時に **DB/localStorage へ保存**（§6.5）。各ハンドは従来どおり `versus_hands`（session_id 付き）にも保存。

### 6.5 セッション保存 — `src/store/sessions.ts`（新規）

- ログイン時: `versus_sessions` に upsert（開始時 insert、終了時 update で `ended_at/result/hands_played/stack_curve`）。各ハンドは `versus_hands`（`session_id` 付き）に insert。
- ゲスト時: localStorage `poker-trainer-sessions`（`SessionRecord[]`、最大50件 ring buffer）。
- `SessionRecord` 型:
  ```ts
  export type SessionRecord = {
    id: string;
    format: SessionFormat;
    mode: GameMode;
    difficulty: GameConfig['difficulty'];
    startingStack: number;
    startedAt: number;
    endedAt: number | null;
    result: 'bust' | 'win' | 'quit' | null;
    handsPlayed: number;
    stackCurve: number[];
  };
  ```

### 6.6 成績ページ — `src/pages/Sessions.tsx`（新規）+ 軽量SVGグラフ

- セッション一覧（新しい順）: format/mode/result/handsPlayed/最終スタック。
- 各セッションを開くと **チップ推移グラフ**（`stackCurve`）を表示。
- グラフは **依存追加せず軽量 SVG 自作** — `src/components/charts/LineChart.tsx`（新規）:
  ```ts
  // props: { data: number[]; width?: number; height?: number; baseline?: number }
  // polyline で折れ線、baseline（開始スタック）に水平線、min/max ラベルのみ。framer-motion 不要。
  ```
  理由: chart ライブラリ（recharts 等）は bundle 増を招き、折れ線1本に過剰。SVG `<polyline>` で十分。
- ナビ追加: AppShell の「対戦」セクションに「成績」(`/sessions`) を追加。

### 6.7 Phase D テスト（session.ts は純TSで決定的にテスト可能）

`src/core/game/session.test.ts`（新規）。`configForHand` + `startHand`（`config.rng` 固定）で決定的に:

1. `startSession`: seatStacks 全6=startingStack、stackCurve=[startingStack]、status='active'。
2. `commitHandResult`: ended の各 player.stack が seatStacks に反映、stackCurve に seat0 が追記、handNumber+1。
3. **レベルアップ**: tournament, handsPerLevel=2 で 2ハンド commit 後 currentLevel=1、`configForHand` の bb が level2 の値。
4. **bust 判定**: seat0.stack=0 の ended を commit → status='bust'、`canContinue=false`。
5. **win 判定**: seat1..5 全 stack=0 の ended → status='win'。
6. **cash**: format='cash' は handsPerLevel を跨いでも currentLevel が動かない、ユーザ quit まで active。
7. **チップ保存性**: 1セッション複数ハンドで `Σ seatStacks` がブラインド/ante を含めゼロサム保存（各ハンド終了時 `Σ stack === 6 * startingStack` は持ち越しで崩れるが、**セッション内総チップ = 6*startingStack 一定**を確認）。

受け入れ条件: 上記緑 + Versus セッションタブで bust まで遊べる + 成績ページにグラフ表示 + `npm run build`/`npm run test` 緑。

---

## 7. Phase C — クイズ統計・復習

### 7.1 統一イベントログ — `QuizAttempt` 型 + `recordAttempt` 単一API

全ドリルを単一スキーマで記録する。`src/store/attempts.ts`（新規）。

```ts
// src/store/attempts.ts
export type DrillKind = 'range' | 'quiz' | 'potOdds' | 'reqEquity' | 'mdf' | 'cbet';

export type QuizAttempt = {
  id: string;
  ts: number;
  drillKind: DrillKind;
  scenarioId?: string;      // 'RFI_UTG' 等
  position?: string;        // Position
  handClass?: string;       // HandClass
  expected: string;         // 正解（文字列化: 'raise' / '33%' / 'cbet' 等）
  answered: string;
  correct: boolean;
  payload?: Record<string, unknown>;
};

type AttemptsState = {
  attempts: QuizAttempt[];           // ローカルキャッシュ（ゲスト=全件、ログイン=直近 N 件）
  loaded: boolean;
  record: (a: Omit<QuizAttempt, 'id' | 'ts'>) => void;  // ts/id 付与 + port 書き込み
  load: () => Promise<void>;
};
```

- `record` は楽観的に local 配列へ push し、`attemptsPort`（§8.1）で Supabase insert / localStorage 追記。
- ゲスト localStorage: `poker-trainer-attempts`（最大 2000 件 ring buffer）。
- **既存 progress.ts は残す**（カウンタ表示の後方互換）。各ドリルは `recordXxx`（progress）に加えて `record`（attempts）を **両方**呼ぶ。統計ページは attempts から集計。

#### 7.1.1 各ドリルの記録呼び出し（改修箇所）

| ファイル | 追加する `record(...)` 呼び出し |
|---|---|
| `RangeTrainer.tsx` DrillView | `{ drillKind:'range', scenarioId, position:heroPos, handClass:hand, expected, answered:a, correct }` |
| `Quiz.tsx` | `{ drillKind:'quiz', scenarioId:q.id, expected:q.answer, answered:value, correct }` |
| `PotOdds.tsx`（potOdds/reqEquity/mdf 3ドリル） | 各 `drillKind` で `expected`/`answered` を文字列化（`'call'/'fold'` or `'33%'`） |
| `Cbet.tsx` | `{ drillKind:'cbet', scenarioId:q.id, expected:q.answer, answered:value, correct }` |

各ドリルの問題に **安定した識別子**を付ける（§7.3 の `problem_key` 用）。Quiz/Cbet は既に `q.id` を持つ。range は `RFI_${pos}:${handClass}`、potOdds 系は問題パラメータをキー化（例 `potOdds:pot=100,call=50,outs=9,street=flop`）。

### 7.2 統計ページ — `src/pages/Stats.tsx`（新規）

attempts を集計してダッシュボード表示。集計は純関数 `src/core/stats/aggregate.ts`（新規・テスト可能）に置く。

```ts
// src/core/stats/aggregate.ts
import type { QuizAttempt, DrillKind } from '../../store/attempts';

export type Bucket = { key: string; attempts: number; correct: number };
export function accuracyOf(b: Bucket): number { return b.attempts ? b.correct / b.attempts : 0; }

export function overall(attempts: QuizAttempt[]): Bucket;
export function byDrillKind(attempts: QuizAttempt[]): Bucket[];        // key=DrillKind
export function byPosition(attempts: QuizAttempt[]): Bucket[];         // key=Position
export function byHandClass(attempts: QuizAttempt[]): Bucket[];        // key=HandClass
export function byScenario(attempts: QuizAttempt[]): Bucket[];         // key=scenarioId
/** 最低 minN 回フィルタ後、正答率昇順で苦手 top k。scenario×position 粒度。 */
export function weakest(attempts: QuizAttempt[], minN: number, k: number): Bucket[]; // key=`${scenarioId}@${position}`
```

- Stats.tsx UI: 全体正答率（ProgressRing 流用）、ドリル種別バー、ポジション別/ハンド別テーブル、試行数フィルタ（`minN` セレクタ: 1/3/5/10）。
- 苦手シチュエーション: `weakest(attempts, minN, 5)` を提示（「`vsCO_fromBB` @ BB が苦手」等のラベル）。

### 7.3 復習 — `src/pages/Review.tsx`（新規）+ `bookmarks`

- **間違い一覧**: `attempts.filter(a => !a.correct)` を新しい順表示（ドリル種別・問題内容・正解/解答）。
- **ブックマーク**: `src/store/bookmarks.ts`（新規）。`problem_key`（§7.1.1 のキー）+ note。port 経由（ログイン=`bookmarks` テーブル / ゲスト=localStorage `poker-trainer-bookmarks`）。
  ```ts
  type BookmarksState = {
    items: { problemKey: string; note?: string; createdAt: number }[];
    toggle: (problemKey: string, note?: string) => void;
    has: (problemKey: string) => boolean;
    load: () => Promise<void>;
  };
  ```
- **復習モード**: 間違えた問題 or ブックマークのみを再出題。
  - range/quiz/cbet は問題識別子から問題を復元できる（`QUIZ_QUESTIONS`/`CBET_QUESTIONS` は id 引き、range は `scenarioId+handClass` で再構成）。
  - potOdds 系はパラメータをキーから復元 or 同種ランダム再出題（MVP は同種ランダムで可、と明記）。
- **苦手分析**: `weakest()` の結果へのリンクで該当ドリルへ誘導。

### 7.4 Phase C テスト

- `aggregate.test.ts`: 既知 attempts 配列で `overall/byDrillKind/byPosition/byHandClass/weakest` の集計値を検証。`weakest` の minN フィルタと昇順ソートを検証。
- `effective.test.ts`（§4.5）。
- attempts/bookmarks ストアはゲスト localStorage 経路で smoke（port=local 固定）。

---

## 8. Phase B — Supabase 基盤（認証・同期・ゲストフォールバック・移行）

### 8.1 永続化抽象 `DataPort` — `src/store/persistence.ts`（新規）

各データ種ごとに「ログイン=Supabase / ゲスト=localStorage」を切替える薄い port。各ストアは port 経由で読み書きする。

```ts
// src/store/persistence.ts
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';  // §8.2

export type DataPort<T> = {
  load: () => Promise<T>;
  save: (value: T) => Promise<void>;
};

/** ログイン中の uid を返す（ゲストなら null）。 */
export function currentUserId(): string | null { /* useAuth.getState().userId */ }

/** localStorage 実装（JSON）。 */
export function localPort<T>(key: string, fallback: T): DataPort<T>;

/** Supabase 実装は各データ種で個別に書く（テーブル/カラムが違うため汎用化しない）。 */
// 例: attemptsSupabasePort, customRangesSupabasePort, sessionsSupabasePort, bookmarksSupabasePort
```

- 各ストア（attempts/customRanges/sessions/bookmarks/history）は `currentUserId()` を見て port を選ぶ。
- **過剰汎用化を避ける**: テーブルごとにカラム形が違うので、Supabase port はデータ種ごとに個別関数（`src/store/remote/*.ts`）。localStorage port のみ汎用。

### 8.2 認証ストア — `src/store/auth.ts`（新規）

```ts
type AuthState = {
  userId: string | null;        // null = ゲスト
  email: string | null;
  status: 'loading' | 'guest' | 'signedIn';
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  init: () => void;             // supabase.auth.onAuthStateChange を購読
};
```

- `init`: `supabase===null` なら即 `status='guest'`。あれば `getSession()` + `onAuthStateChange` で `userId/email/status` を更新。
- `signInWithGoogle`: `supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: location.origin } })`。
- `signOut`: `supabase.auth.signOut()`。
- アプリ起動時（`main.tsx` or `AppShell`）で `useAuth.getState().init()` を一度呼ぶ。

### 8.3 認証UI — AppShell に組み込み

- サイドバー下部に **ログイン状態表示**: ゲスト時「ゲスト（ローカル保存）」+「Googleでログイン」ボタン。ログイン時 email + 「ログアウト」。
- `supabase===null`（env未設定）のときはログインUIを **非表示**（ゲスト表記のみ）。
- モバイルは設定メニュー内に同等項目。
- 専用コンポーネント `src/components/AuthButton.tsx`（新規・小さく）。

### 8.4 初回ログイン移行（一回限り）— `src/store/migrateLocal.ts`（新規）

ログイン直後、`profiles.migrated_at` が null なら localStorage の既存データを一括インポートし、`migrated_at=now()` を立てる。

```ts
/** ログイン成功後に1回だけ呼ぶ。profiles.migrated_at が null のときだけ実行。 */
export async function migrateLocalToCloud(userId: string): Promise<void>;
```

移行対象と方法:
| localStorage | → Supabase |
|---|---|
| `poker-trainer-history`（SavedHand[]） | `versus_hands`（session_id=null で bulk insert、payload=SavedHand） |
| `poker-trainer-attempts`（QuizAttempt[]） | `quiz_attempts` bulk insert |
| `poker-trainer-custom-ranges` | `custom_ranges` upsert |
| `poker-trainer-bookmarks` | `bookmarks` upsert |
| `poker-trainer-sessions` | `versus_sessions`（+ 紐づく hands があれば）bulk insert |
| `poker-trainer-progress` | **移行しない**（attempts から再集計するため。progress は表示キャッシュ） |

- **profiles 行の作成**: profiles 行は自動では作られない。ログイン確定時（`onAuthStateChange` の signedIn）にまず `insert into profiles(user_id) ... on conflict (user_id) do nothing`（supabase-js では `upsert({ user_id }, { onConflict: 'user_id', ignoreDuplicates: true })`）で行を保証してから `migrated_at` を確認する。
- 実装: 上記 upsert → `profiles` を select、`migrated_at` が null のときのみ実行 → 最後に `update profiles set migrated_at=now()`。
- 失敗時はトーストで通知し再試行可能（migrated_at を立てない）。
- 移行後はクラウドが正。ローカルデータは消さず残す（ゲストに戻った時のため）。
- AuthButton/AppShell が `onAuthStateChange` の signedIn で `migrateLocalToCloud` を1回トリガ。

### 8.5 同期方針（読み書き）

- **ログイン時**: 各ストアの `load()` で Supabase から読み込み（起動時 or 各ページマウント時）。書き込みは即時 upsert/insert（楽観的更新）。リアルタイム購読は **不要**（単一ユーザ・単一端末想定。複数端末同時編集は対象外）。
- **ゲスト時**: localStorage（現行 zustand persist or localPort）。
- ネットワーク失敗時: ローカル state は保持、トーストで「保存に失敗（オフライン）」。MVP ではオフラインキュー再送は実装しない（割り切り、明記）。

### 8.6 Phase B 受け入れ条件・テスト

- env 未設定で `supabase===null` → 全ページがゲスト localStorage で従来どおり動作（回帰）。`isBackendEnabled===false`。
- env 設定 + ログインで attempts/history/custom/sessions が Supabase に保存され、リロード後も読める（手動E2E手順を README に記載）。
- 初回ログインで localStorage の既存履歴が `versus_hands` に移行され、二度目のログインで二重移行しない（`migrated_at`）。
- 純TS テスト対象: `localPort` の load/save、`aggregate.ts`（§7.4）。Supabase 経路は手動E2E（CIでは env 無し＝ゲスト経路のみ自動テスト）。

---

## 9. フェーズ分割（実装計画・Sonnet向け）

各フェーズ末で `npm run build` / `npm run test` が緑の独立単位。

### Phase A — レンジ刷新（Supabase 非依存）
- A1: `src/core/ranges/vsOpen.ts` 全面刷新（§3.3）+ `vsOpen.test.ts`（§3.5）。reviewHand 既存テストの期待値を導出値へ更新。
- A2: `src/core/ranges/seats.ts`（§5.1-5.2）+ `seats.test.ts`（§5.4）。
- A3: `src/core/ranges/effective.ts`（§4.1）+ `effective.test.ts`（§4.5）。
- A4: `RangeTrainer.tsx` に vs-open チャート（§3.4）+ 人数セレクタ（§5.3）。`RangeGrid.tsx` に `onCellClick` prop 追加（§4.4、編集UIは C で使うが prop だけ A で入れてよい）。
- 受け入れ: BB vs CO の T9o が call、vs-open チャートが UI に出る、10-max 閲覧可、ビルド/テスト緑。

### Phase B — Supabase 基盤
- B1: `@supabase/supabase-js` 追加、`src/lib/supabase.ts`（§1.3）、`supabase/migrations/0001_init.sql`（§2）、README 追記（§1.4）。
- B2: `src/store/auth.ts`（§8.2）、`src/components/AuthButton.tsx`、AppShell 組込（§8.3）、`main.tsx` で `init()`。
- B3: `src/store/persistence.ts`（§8.1）+ `localPort` テスト。
- B4: `src/store/migrateLocal.ts`（§8.4）。
- 受け入れ: env 無しでゲスト動作（回帰）、env 有りで Google ログイン→ログアウト、初回移行が走る、ビルド/テスト緑。

### Phase C — 統計・復習・レンジカスタマイズ（A+B 依存）
- C1: `src/store/attempts.ts`（§7.1）+ 各ドリルに `record(...)` 追加（§7.1.1）。Supabase port（`src/store/remote/attempts.ts`）。
- C2: `src/core/stats/aggregate.ts`（§7.2）+ `aggregate.test.ts`。`src/pages/Stats.tsx`、ナビ追加。
- C3: `src/store/bookmarks.ts` + `src/pages/Review.tsx`（§7.3）、復習モード。
- C4: `src/store/customRanges.ts`（§4.3）+ RangeTrainer 編集モード（§4.4）+ reviewHand に custom 注入（§4.2）。Supabase port。
- 受け入れ: 統計ページが正答率を集計表示、苦手提示、復習モードで間違い再出題、カスタムレンジが表示/ドリル/FB に反映、ビルド/テスト緑。

### Phase D — 対戦セッション（B 依存）
- D1: `engine.ts` の `startHand` に `seatStacks?` 追加（§6.1）+ 既存テスト回帰。
- D2: `src/core/game/session.ts`（§6.2）+ `session.test.ts`（§6.7）。
- D3: `src/hooks/useVersusSession.ts`（§6.4）、Versus に「単発/セッション」トグル（§6.3）。
- D4: `src/store/sessions.ts`（§6.5、Supabase port + local）、`src/pages/Sessions.tsx` + `src/components/charts/LineChart.tsx`（§6.6）、ナビ追加。
- 受け入れ: トーナメントで bust までプレイ→成績保存→グラフ表示、キャッシュで任意終了、ビルド/テスト緑。

---

## 10. 既存ドキュメントとの整合

- DESIGN.md・RANGES-V2.md は変更しない。本 V3-PLATFORM.md が V3 の source of truth。
- `Scenario`/`Range`/`HandAction`/`Position`/`GameMode`/`GameConfig` 型は維持。新規型は `SeatLabel`/`RangeKey`/`CustomRanges`/`SessionConfig`/`SessionState`/`QuizAttempt`/`DataPort` 等で、既存型を破壊しない。
- `yokosawa.ts` の ground truth ティアは参照のみ・不変。
- progress.ts は残置（後方互換カウンタ）。統計は attempts ログから集計する新系統。

---

## 付録: 新規/変更ファイル一覧

**新規（core, 純TS・テスト対象）**: `ranges/seats.ts`, `ranges/effective.ts`, `game/session.ts`, `stats/aggregate.ts` + 各 `*.test.ts`。`ranges/vsOpen.ts` は全面刷新。
**新規（lib/store/hooks）**: `lib/supabase.ts`, `store/auth.ts`, `store/persistence.ts`, `store/migrateLocal.ts`, `store/attempts.ts`, `store/bookmarks.ts`, `store/customRanges.ts`, `store/sessions.ts`, `store/remote/*.ts`, `hooks/useVersusSession.ts`。
**新規（components/pages）**: `components/AuthButton.tsx`, `components/charts/LineChart.tsx`, `pages/Stats.tsx`, `pages/Review.tsx`, `pages/Sessions.tsx`。
**新規（infra）**: `supabase/migrations/0001_init.sql`, README 追記, `.env.local`。
**変更**: `engine.ts`（startHand seatStacks）, `reviewHand.ts`（custom 注入）, `RangeTrainer.tsx`（vs-open/人数/編集）, `RangeGrid.tsx`（onCellClick）, `AppShell.tsx`（auth UI/ナビ）, `Versus.tsx`（session トグル）, 各ドリルページ（record 呼び出し）, `package.json`。
**不変**: `yokosawa.ts`, `mode.ts`, `rfi.ts`, `types.ts`, `preflop.ts`, `progress.ts`, `DESIGN.md`, `RANGES-V2.md`。
