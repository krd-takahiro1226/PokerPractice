# PokerPractice — Claude Code 作業ガイド

## プロジェクト概要

NLH 6-max 100bb キャッシュゲーム向けの初心者〜中級者用GTO風ポーカー練習アプリ。  
詳細設計は `docs/DESIGN.md` を参照。

- 静的SPA（Vercel無料枠）、サーバー/DBなし
- 進捗保存: localStorage
- UI言語: 日本語（ポーカー用語は英語のまま: open, 3bet, RFI 等）

## 技術スタック

| 項目         | 採用                      |
| ------------ | ------------------------- |
| ビルド       | Vite + React + TypeScript |
| スタイリング | Tailwind CSS v4           |
| ルーティング | React Router v7           |
| 状態管理     | Zustand v5                |
| 重い計算     | Web Worker                |
| テスト       | Vitest                    |
| デプロイ     | Vercel (無料)             |

## ディレクトリ構成

```
src/
  core/       # ポーカーロジック（React非依存の純粋TS）
  components/ # 共通UIコンポーネント
  pages/      # 各機能ページ
  hooks/      # カスタムフック
  store/      # Zustandストア
  data/       # 事前計算データ（レンジ等）
  workers/    # Web Worker
  lib/        # ユーティリティ
docs/
  DESIGN.md   # フェーズ分割・データ構造・starter ranges
```

## 重要な設計原則

- `src/core/` は React に一切依存しない純粋な TypeScript にする（テスト容易性・Worker利用のため）
- 本物のCFRソルバーは持たない。事前計算データ + 軽量ブラウザ内計算 + ドリルで構成
- サーバー機能・課金は「複数端末での進捗同期」等が本当に必要になるまで追加しない

## モデル分担ポリシー — トークン効率のための役割分担

**Fable5（Claude Code）は設計・監査・レビューに専念する。**  
実装作業はサブエージェントに委譲してトークンを節約すること。

### 分担ルール

| 作業                                         | 担当                                       | 備考                                                       |
| -------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| 設計・アーキテクチャ判断・方針決定           | Fable5 または Opus サブエージェント        | `subagent_type` 省略時は `claude-code` 相当                |
| ドキュメント作成・更新（`docs/`）            | Opusサブエージェント (`model: "opus"`)     | 設計ドキュメントはSonnetが単独実装着手できる粒度まで具体化 |
| 実装コード（ページ・コンポーネント・core等） | Sonnetサブエージェント (`model: "sonnet"`) | 設計ドキュメントを渡して委譲                               |
| テスト実装                                   | Sonnetサブエージェント                     | Vitestを使用                                               |
| コードレビュー・監査                         | Fable5                                     | 生成物を確認してフィードバック                             |
| 実装難易度が特に高い箇所                     | Fable5（直接実装可）                       | 例: evaluator.ts の7枚ハンド評価器など                     |

### サブエージェント委譲の指針

```
設計面の作業  →  Agent(subagent_type="claude", model="opus", ...)
実装面の作業  →  Agent(subagent_type="claude", model="sonnet", ...)
Fable5 →  設計承認・コードレビュー・難易度の高い実装のみ
```

- Opus には「設計・必要なドキュメント作成まで」を担わせる。実装コードの一括執筆はSonnetへ
- Sonnet へ渡す際は、データ構造・関数シグネチャ・フェーズ分割が明記されたドキュメントを添付する
- Sonnet が単独で実装着手できる粒度に設計を落とし込んでから委譲すること

## 開発コマンド

```bash
npm run dev        # 開発サーバー起動
npm run build      # プロダクションビルド
npm run test       # テスト実行（Vitest）
npm run test:watch # テストウォッチモード
npm run preview    # ビルド成果物のプレビュー
npm run sync:functions # src/core → Edge Function 共有コードの同期
```

## プロジェクトSKILL

定型作業は `.claude/skills/` に SKILL 化済み（詳細: `.claude/skills/README.md`）。該当タイミングで必ず使うこと:

- `sync-core` — `src/core/` または `supabase/functions/_shared/` の手書きファイルを変更した直後
- `precommit` — コミット前・まとまった変更の完了報告前
- `delegate` — サブエージェントへ設計・実装を委譲するとき（制約ブロックのテンプレート）

## コーディング規約

- コメントは「なぜ」が非自明な場合のみ書く（何をするかは変数名・関数名で表現）
- エラーハンドリングはシステム境界（ユーザー入力・外部API）のみ
- 不要な抽象化を避ける。3行の重複より早期の抽象化を嫌う
- UIコンポーネントは `src/components/` に、ページは `src/pages/` に配置
