---
name: delegate
description: CLAUDE.md のモデル分担ポリシーに従いサブエージェント（設計=Opus / 実装=Sonnet）へ作業を委譲する際のテンプレート。委譲プロンプトに必ず含めるべきプロジェクト制約ブロックを提供する。
---

# delegate — サブエージェント委譲テンプレート

CLAUDE.md の分担ルール（設計=Opus、実装=Sonnet、レビュー=Fable5）で委譲する際、
サブエージェントはプロジェクトの暗黙制約を知らないため、**毎回同じ制約を伝える必要がある**。
以下のテンプレートを使うこと。

## 委譲プロンプトに必ず含める制約ブロック

```
## プロジェクト制約（厳守）

- `src/core/` は React に一切依存しない純粋な TypeScript にする（Worker/Edge Function 共用のため）
- `src/core/ranges/yokosawa.ts` は手修正済みの ground truth。**絶対に変更しない**
- Supabase は任意機能: `supabase === null`（env 未設定）のとき全機能が localStorage で
  動作するゲストモードを壊さない。Supabase 呼び出しには必ず null ガードを置く
- `supabase/functions/_shared/core/` は自動生成物。直接編集禁止（`src/core/` を直す）
- コメントは「なぜ」が非自明な場合のみ。エラーハンドリングはシステム境界のみ。早すぎる抽象化を避ける
- UI言語は日本語、ポーカー用語は英語のまま（open, 3bet, RFI 等）
- テストは Vitest（`npm run test`）。実装後にテストとビルド（`npm run build`）を通すこと
```

## 委譲の型

```
設計・ドキュメント作成 → Agent(subagent_type="claude", model="opus", ...)
実装・テスト          → Agent(subagent_type="claude", model="sonnet", ...)
```

- **Opus へ**: 目的・要件・既存設計ドキュメント（`docs/DESIGN.md` 等）のパスを渡し、
  「Sonnet が単独で実装着手できる粒度（データ構造・関数シグネチャ・フェーズ分割明記）」まで落とし込ませる
- **Sonnet へ**: 設計ドキュメントのパス + 上記制約ブロック + 対象ファイルパスを渡す。
  曖昧な判断が必要な設計事項は委譲前に解決しておく

## 委譲後（Fable5 が実施）

1. 生成物をレビュー（特に: null ガード、yokosawa.ts 非変更、core の React 非依存）
2. `src/core/` が変更されていたら [sync-core](../sync-core/SKILL.md) を実行
3. コミット前に [precommit](../precommit/SKILL.md) を実行
