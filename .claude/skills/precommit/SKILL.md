---
name: precommit
description: コミット前の検証一式。テスト・ビルド・Edge Function 同期漏れ検知・ゲスト動作回帰・yokosawa.ts 保護をまとめてチェックする。コミット依頼や「動作確認して」の際に実行。
---

# precommit — コミット前チェックリスト

コミット前（またはまとまった変更の完了報告前）に以下を上から順に実行する。
失敗した項目はコミットせず、修正してから再実行する。

## 1. テストとビルド

```bash
npm run test
npm run build   # tsc -b を含むため型エラーもここで検出
```

## 2. Edge Function 同期漏れの検知

`src/core/` に差分がある場合（`git diff --stat HEAD -- src/core/` で確認）:

```bash
npm run sync:functions
git status --porcelain supabase/functions/_shared/core/
```

差分が出たら同期漏れだったということ。差分をコミットに含め、[sync-core](../sync-core/SKILL.md) の手順4（デプロイ案内）も実施する。

## 3. 変更禁止ファイルの確認

```bash
git diff --stat HEAD -- src/core/ranges/yokosawa.ts
```

`yokosawa.ts` は手修正済みの ground truth。**差分があってはならない**。
意図せず変更されていたら revert し、意図的な変更依頼だった場合はコミット前にユーザーへ確認する。

## 4. ゲスト動作（env 無し）の回帰確認

最重要の回帰条件: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 未設定時は
`supabase === null` となり、全機能が localStorage で動作しなければならない。

Supabase を使う新規コードを追加した場合は、`supabase === null` のガード（または呼び出し元での分岐）が
あることをコードリーディングで確認する。UI 側なら env 無しで `npm run dev` を起動し、該当画面が
白画面・エラーにならないことを確認する。

## 5. コミット内容の最終確認

- `git status` に生成物・一時ファイルが混ざっていないか（`dist/`, `node_modules/` は .gitignore 済みだが念のため)
- Edge Function 再デプロイや migration 適用が必要な変更なら、コミットメッセージまたは報告にその旨を明記する
