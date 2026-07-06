# プロジェクトSKILL一覧

このディレクトリには PokerPractice の定型作業を SKILL 化したものが入っている。
Claude Code はセッション中に各 SKILL の description を認識し、該当する状況で自動的に参照する。
ユーザーが明示的に呼び出すこともできる（例: プロンプトで `/precommit` と入力）。

## 一覧

| SKILL | いつ使うか | 内容 |
| --- | --- | --- |
| [sync-core](sync-core/SKILL.md) | `src/core/` や `supabase/functions/_shared/` の手書きファイルを変更した直後 | `npm run sync:functions` → 同期結果確認 → 手書きファイルの esbuild 構文検証 → Edge Function デプロイ案内（必須） |
| [precommit](precommit/SKILL.md) | コミット前・まとまった変更の完了報告前 | テスト・ビルド → 同期漏れ検知 → yokosawa.ts 非変更確認 → env 無しゲスト動作の回帰確認 |
| [delegate](delegate/SKILL.md) | サブエージェント（Opus/Sonnet）へ設計・実装を委譲するとき | 委譲プロンプトに毎回含めるべきプロジェクト制約ブロックと委譲の型 |

## 背景（なぜこの3つか）

開発履歴で繰り返し発生した事故・手戻りに対応している:

1. **sync:functions 忘れ** — `src/core/` は Web と Edge Function (`online-room`) で共用。
   同期を忘れると Web だけ直ってサーバー側が古いままになる不具合が複数回発生した。
   さらにデプロイ (`supabase functions deploy online-room`) はユーザーにしか実行できないため、
   案内漏れ＝修正が本番に届かない、となる。
2. **回帰しやすい不変条件** — 「env 未設定でも localStorage で全機能動作（ゲストモード）」
   「`yokosawa.ts` は手修正済み ground truth で変更禁止」は、コードを見ただけでは
   気づきにくく、コミット前チェックとして明文化した。
3. **委譲時の制約伝達漏れ** — CLAUDE.md の分担ポリシーでサブエージェントに実装を任せるが、
   サブエージェントは上記の暗黙制約を知らない。毎回書いていた制約ブロックをテンプレート化した。

## メンテナンス

- 手順が変わったら（例: sync 対象ディレクトリの追加、新しい変更禁止ファイル）対応する SKILL.md を更新する
- 新しい定型作業が3回以上繰り返されたら SKILL 化を検討する
- SKILL の description（frontmatter）は自動発動のトリガー条件なので、変更時は「いつ使うか」が明確に伝わる文面を保つこと
