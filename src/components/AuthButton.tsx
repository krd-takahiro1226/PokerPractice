import { isBackendEnabled } from '../lib/supabase';
import { useAuth } from '../store/auth';

/**
 * ログイン状態表示コンポーネント。
 * supabase===null（env未設定）のときはゲスト表記のみ（ログインUI非表示）。
 */
export function AuthButton() {
  const { status, email, signInWithGoogle, signOut } = useAuth();

  if (!isBackendEnabled) {
    return (
      <div className="rounded-xl border border-border bg-surface-2/50 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted">ゲスト</div>
        <div className="mt-0.5 text-xs text-muted/70">ローカル保存</div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="rounded-xl border border-border bg-surface-2/50 p-3">
        <div className="text-xs text-muted">読み込み中...</div>
      </div>
    );
  }

  if (status === 'signedIn' && email) {
    return (
      <div className="rounded-xl border border-border bg-surface-2/50 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted">ログイン中</div>
        <div className="mt-0.5 truncate text-xs text-text" title={email}>
          {email}
        </div>
        <button
          onClick={signOut}
          className="mt-2 w-full rounded-lg bg-surface-2 px-2 py-1 text-xs text-muted transition hover:bg-border hover:text-text"
        >
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">ゲスト（ローカル保存）</div>
      <button
        onClick={signInWithGoogle}
        className="mt-2 w-full rounded-lg bg-accent/20 px-2 py-1.5 text-xs font-medium text-accent-bright transition hover:bg-accent/30"
      >
        Google でログイン
      </button>
    </div>
  );
}
