import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node 環境なので localStorage をモックする
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

vi.stubGlobal('localStorage', localStorageMock);

// モック登録後に import する必要があるため動的 import
const { useAttempts } = await import('./attempts');

const STORAGE_KEY = 'poker-trainer-attempts';

describe('useAttempts.record（ゲスト/localStorage）', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    useAttempts.setState({ attempts: [], loaded: false });
  });

  it('連続呼び出しでも read-modify-write レースで欠落せず全件が保存される', () => {
    const { record } = useAttempts.getState();
    record({ drillKind: 'range', expected: 'raise', answered: 'raise', correct: true });
    record({ drillKind: 'range', expected: 'fold', answered: 'fold', correct: true });
    record({ drillKind: 'range', expected: 'call', answered: 'raise', correct: false });

    // port.load() を経由した非同期の読み直しを待たずとも、set() 直後の
    // in-memory state を保存するため同期的に localStorage へ反映されているはず。
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw!);
    expect(saved).toHaveLength(3);
    expect(useAttempts.getState().attempts).toHaveLength(3);
  });
});
