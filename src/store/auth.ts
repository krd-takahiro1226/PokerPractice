import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { migrateLocalToCloud } from './migrateLocal';

type AuthState = {
  userId: string | null;
  email: string | null;
  status: 'loading' | 'guest' | 'signedIn';
  isAnonymous: boolean;
  signInWithGoogle: () => Promise<void>;
  /** 匿名アカウントに Google ID を紐付ける（ゲストデータを引き継いだままアップグレード）。 */
  linkGoogle: () => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => Promise<void>;
  /** supabase.auth.onAuthStateChange を購読。main.tsx で一度だけ呼ぶ。 */
  init: () => void;
};

export const useAuth = create<AuthState>()((set) => ({
  userId: null,
  email: null,
  status: 'loading',
  isAnonymous: false,

  init: () => {
    if (supabase === null) {
      set({ status: 'guest', userId: null, email: null, isAnonymous: false });
      return;
    }

    // 既存セッションを確認
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (session) {
        set({
          status: 'signedIn',
          userId: session.user.id,
          email: session.user.email ?? null,
          isAnonymous: session.user.is_anonymous ?? false,
        });
      } else {
        set({ status: 'guest', userId: null, email: null, isAnonymous: false });
      }
    });

    // 以降の認証状態変化を購読
    supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        set({
          status: 'signedIn',
          userId: session.user.id,
          email: session.user.email ?? null,
          isAnonymous: session.user.is_anonymous ?? false,
        });
        // 初回ログイン時のみ localStorage → Supabase 移行を試みる
        if (event === 'SIGNED_IN') {
          migrateLocalToCloud(session.user.id).catch((e) => {
            console.warn('[auth] migrateLocalToCloud failed:', e);
          });
        }
      } else {
        set({ status: 'guest', userId: null, email: null, isAnonymous: false });
      }
    });
  },

  signInWithGoogle: async () => {
    if (supabase === null) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin },
    });
  },

  linkGoogle: async () => {
    if (supabase === null) return { ok: false, error: 'supabase not configured' };
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: location.origin },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  signOut: async () => {
    if (supabase === null) return;
    await supabase.auth.signOut();
    set({ status: 'guest', userId: null, email: null, isAnonymous: false });
  },
}));
