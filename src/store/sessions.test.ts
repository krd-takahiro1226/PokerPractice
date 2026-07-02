import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startSession } from '../core/game/session';
import type { SessionConfig } from '../core/game/session';

// Node 環境なので localStorage をモックする（persist ミドルウェアの書き込み先）
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

vi.stubGlobal('localStorage', localStorageMock);

// localStorage モック登録後に import する必要があるため動的 import
const { useSessions } = await import('./sessions');

const LOCAL_KEY = 'poker-trainer-sessions';

const baseConfig: SessionConfig = {
  format: 'tournament',
  mode: 'tournament',
  difficulty: 'normal',
  startingStack: 100,
  blindLevels: [{ sb: 0.5, bb: 1, ante: 1 }],
  handsPerLevel: 10,
};

describe('useSessions', () => {
  beforeEach(() => {
    localStorage.removeItem(LOCAL_KEY);
    useSessions.setState({ sessions: [], activeSession: null, loaded: false });
  });

  it('saveActiveSession が activeSession と sessions[] の該当レコードを両方更新する', async () => {
    const id = await useSessions.getState().createSession({
      format: 'tournament',
      mode: 'tournament',
      difficulty: 'normal',
      startingStack: 100,
    });

    const sessionState = {
      ...startSession(baseConfig),
      handNumber: 3,
      stackCurve: [100, 90, 95, 80],
    };

    useSessions.getState().saveActiveSession(id, sessionState);

    const record = useSessions.getState().sessions.find((r) => r.id === id);
    expect(record?.handsPlayed).toBe(3);
    expect(record?.stackCurve).toEqual([100, 90, 95, 80]);
    expect(useSessions.getState().activeSession?.recordId).toBe(id);
  });

  it('discardActiveSession がレコードを quit で確定し activeSession をクリアする', async () => {
    const id = await useSessions.getState().createSession({
      format: 'tournament',
      mode: 'tournament',
      difficulty: 'normal',
      startingStack: 100,
    });

    const sessionState = {
      ...startSession(baseConfig),
      handNumber: 3,
      stackCurve: [100, 90, 95, 80],
    };

    useSessions.getState().saveActiveSession(id, sessionState);

    await useSessions.getState().discardActiveSession();

    expect(useSessions.getState().activeSession).toBeNull();

    const record = useSessions.getState().sessions.find((r) => r.id === id);
    expect(record?.result).toBe('quit');
    expect(record?.endedAt).not.toBeNull();
    expect(record?.handsPlayed).toBe(3);
    expect(record?.stackCurve).toEqual([100, 90, 95, 80]);
  });

  it('activeSession が無い場合 discardActiveSession は何もしない', async () => {
    await expect(useSessions.getState().discardActiveSession()).resolves.toBeUndefined();
    expect(useSessions.getState().activeSession).toBeNull();
  });
});
