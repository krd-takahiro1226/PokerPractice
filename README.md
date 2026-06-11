# PokerPractice

NLH 6-max 100bb キャッシュゲーム向けの初心者〜中級者用 GTO 風ポーカー練習アプリ。

## 開発コマンド

```bash
npm install
npm run dev        # 開発サーバー起動
npm run build      # プロダクションビルド
npm run test       # テスト実行（Vitest）
npm run test:watch # テストウォッチモード
npm run preview    # ビルド成果物のプレビュー
```

## クラウド同期（任意）

env を設定しなければ従来どおりゲスト（localStorage）動作のまま。以下は複数端末での進捗同期を使いたい場合のみ設定する。

1. **Supabase プロジェクト作成**: supabase.com でプロジェクトを作成。Settings → API から `Project URL` と `anon public` キーを控える。
2. **マイグレーション適用**: Supabase Dashboard → SQL Editor に `supabase/migrations/0001_init.sql` を貼り付けて実行。
3. **Google OAuth 設定**: Authentication → Providers → Google を有効化。Google Cloud Console で OAuth クライアントを作成し、承認済みリダイレクト URI に `https://<project-ref>.supabase.co/auth/v1/callback` を登録。Client ID / Secret を Supabase に貼る。Authentication → URL Configuration の Site URL に本番 URL（Vercel ドメイン）と `http://localhost:5173` を追加。
4. **Vercel env 設定**: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定して再デプロイ。
5. env を設定しなければ従来どおりゲスト（localStorage）動作のまま。
