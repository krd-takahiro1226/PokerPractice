import { describe, it, expect, vi } from 'vitest';

// Node 環境なので localStorage をモックする（sessions.ts の persist ミドルウェアが書き込む）
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

vi.stubGlobal('localStorage', localStorageMock);

// モック登録後に import する必要があるため動的 import
const { useAuth } = await import('./auth');
const { useAttempts } = await import('./attempts');
const { useBookmarks } = await import('./bookmarks');
const { useCustomRanges } = await import('./customRanges');
const { useSessions } = await import('./sessions');
const { initAuthSync } = await import('./authSync');

const fakeSession = {
  id: 's1',
  format: 'cash' as const,
  mode: 'cash-noante' as const,
  difficulty: 'normal' as const,
  startingStack: 100,
  startedAt: 1,
  endedAt: null,
  result: null,
  handsPlayed: 0,
  stackCurve: [100],
};

const fakeAttempt = {
  id: 'a1',
  ts: 1,
  drillKind: 'quiz' as const,
  expected: 'raise',
  answered: 'fold',
  correct: false,
};

// authSync は「直前の userId」をモジュール内部状態として保持するため、initAuthSync() は
// このファイル内で一度だけ呼び、以降の it ブロックは実際のアプリのように useAuth の状態遷移を
// 順番に積み重ねていく（it の実行順に依存する意図的な構成）。
initAuthSync();

describe('initAuthSync', () => {
  it('起動直後に既にログイン済みだったケース（最初に観測する遷移）は sessions をクリアしない', () => {
    // migrateLocalToCloud とのレース対策: ページ再読み込み直後の最初の遷移では
    // guest データが移行される前に sessions を消してしまわないことを確認する。
    useSessions.setState({ sessions: [fakeSession], activeSession: null, loaded: true });

    useAuth.setState({ status: 'signedIn', userId: 'user-1', email: null, isAnonymous: false });

    expect(useSessions.getState().sessions).toHaveLength(1);
    expect(useSessions.getState().sessions[0].id).toBe('s1');
  });

  it('userId 遷移のたびに attempts/bookmarks/customRanges がリセットされ再読込される', () => {
    useAttempts.setState({ attempts: [fakeAttempt], loaded: true });
    useBookmarks.setState({ items: [{ problemKey: 'k1', createdAt: 1 }], loaded: true });
    useCustomRanges.setState({ ranges: { 'BTN:open': [] } as never, loaded: true });

    useAuth.setState({ status: 'signedIn', userId: 'user-2', email: null, isAnonymous: false });

    // load() は非同期だが、set() 直後の同期リセットはこの時点で既に反映されているはず。
    expect(useAttempts.getState().attempts).toEqual([]);
    expect(useAttempts.getState().loaded).toBe(false);
    expect(useBookmarks.getState().items).toEqual([]);
    expect(useBookmarks.getState().loaded).toBe(false);
    expect(useCustomRanges.getState().ranges).toEqual({});
    expect(useCustomRanges.getState().loaded).toBe(false);
  });

  it('サインアウトで sessions を空にリセットする', () => {
    useSessions.setState({
      sessions: [fakeSession],
      activeSession: { recordId: 's1', state: {} as never, savedAt: 1 },
      loaded: true,
    });

    useAuth.setState({ status: 'guest', userId: null, email: null, isAnonymous: false });

    expect(useSessions.getState().sessions).toEqual([]);
    expect(useSessions.getState().activeSession).toBeNull();
    expect(useSessions.getState().loaded).toBe(false);
  });

  it('サインアウトを挟まず別アカウントへ切り替わった場合も sessions をクリアする', () => {
    // 一旦別アカウントでログインし直してから、サインアウトを経由せず更に別アカウントへ切替える。
    useAuth.setState({ status: 'signedIn', userId: 'user-3', email: null, isAnonymous: false });
    useSessions.setState({ sessions: [fakeSession], activeSession: null, loaded: true });

    useAuth.setState({ status: 'signedIn', userId: 'user-4', email: null, isAnonymous: false });

    expect(useSessions.getState().sessions).toEqual([]);
  });
});
