import { useAuth } from './auth';

export type DataPort<T> = {
  load: () => Promise<T>;
  save: (value: T) => Promise<void>;
};

/** ログイン中の uid を返す（ゲストなら null）。 */
export function currentUserId(): string | null {
  return useAuth.getState().userId;
}

/** localStorage 実装（JSON）。key が存在しなければ fallback を返す。 */
export function localPort<T>(key: string, fallback: T): DataPort<T> {
  return {
    load: async (): Promise<T> => {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    save: async (value: T): Promise<void> => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        // QuotaExceededError 等は握りつぶす（呼び出し元で対処する場合はそちらで）
        if (e instanceof Error && e.name !== 'QuotaExceededError') throw e;
      }
    },
  };
}

// Supabase port はデータ種ごとに src/store/remote/*.ts に個別実装する。
// 汎用化しない（テーブル/カラム形式が種ごとに異なるため）。
