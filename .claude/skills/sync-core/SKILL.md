---
name: sync-core
description: src/core/ または supabase/functions/_shared/ 直下の手書きファイルを変更した後に必ず実行する Edge Function 同期・検証・デプロイ案内のワークフロー。オンライン対戦のサーバーロジック変更時も対象。
---

# sync-core — Edge Function 同期ワークフロー

`src/core/` は Web アプリと Supabase Edge Function (`online-room`) の両方で使われる。
core を変更したのに同期を忘れると、**Web だけ直ってオンライン対戦のサーバー側が古いまま**という不具合になる（過去に複数回発生）。

## いつ実行するか

- `src/core/` 配下の `.ts` を1ファイルでも変更・追加・削除したとき
- `supabase/functions/_shared/` 直下の手書きファイル（`rooms.ts`, `roomsLogic.ts`, `engine-driver.ts`, `crypto-rng.ts`）を変更したとき
- `supabase/functions/online-room/` を変更したとき（手順3以降のみ）

## 手順

### 1. 同期スクリプトを実行

```bash
npm run sync:functions
```

`src/core/` の対象ファイル（`cards.ts`, `evaluator.ts`, `handNotation.ts`, `potOdds.ts` + `ranges/ game/ online/ ai/` ディレクトリ、テスト除く）を
`supabase/functions/_shared/core/` へコピーし、Deno 用に相対 import へ `.ts` を付与する。

新しい core ファイルを Edge Function からも使う場合は、`scripts/sync-functions.mjs` の
`SOURCE_FILES` / `SOURCE_DIRS` に含まれているか確認すること（含まれていなければ追記してから再実行）。

### 2. 同期結果を確認

```bash
git status --porcelain supabase/functions/_shared/core/
```

- 差分が出た = これまで同期漏れだった or 今回の変更が反映された。**差分ファイルもコミットに含める**
- `_shared/core/` は先頭に `// AUTO-GENERATED` ヘッダー付きの生成物。**直接編集は禁止**（必ず `src/core/` 側を直して再同期）

### 3. 手書き _shared ファイルの構文検証（該当時のみ）

`_shared` 直下の手書きファイル（`rooms.ts` 等）は src 側にミラーが無く **tsc の対象外**。変更したら esbuild で構文チェックする:

```bash
npx esbuild supabase/functions/_shared/rooms.ts --loader:.ts=ts --outfile=/dev/null
```

`roomsLogic.ts` にはテストがある: `npx vitest run supabase/functions/_shared/roomsLogic.test.ts`

### 4. ユーザーへのデプロイ案内（必須・省略禁止）

Edge Function のデプロイはこの環境からは実行できない（ユーザーの Supabase プロジェクト操作が必要）。
作業報告の最後に**必ず**以下を案内する:

```
supabase functions deploy online-room
```

さらに `supabase/migrations/` に未適用の SQL がある場合はその適用も案内する
（適用状況はユーザーしか知らないため「未適用なら適用してください」の形で伝える）。
