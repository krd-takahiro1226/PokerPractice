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
const { useBookmarks } = await import('./bookmarks');

const STORAGE_KEY = 'poker-trainer-bookmarks';

describe('useBookmarks.toggle（ゲスト/localStorage）', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    useBookmarks.setState({ items: [], loaded: false });
  });

  it('連続追加でも read-modify-write レースで欠落せず全件が保存される', () => {
    const { toggle } = useBookmarks.getState();
    toggle('problem-1');
    toggle('problem-2');
    toggle('problem-3');

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw!) as { problemKey: string }[];
    expect(saved.map((i) => i.problemKey).sort()).toEqual(['problem-1', 'problem-2', 'problem-3']);
    expect(useBookmarks.getState().items).toHaveLength(3);
  });

  it('追加直後の解除も最新状態を保存する', () => {
    const { toggle } = useBookmarks.getState();
    toggle('problem-1');
    toggle('problem-2');
    toggle('problem-1'); // problem-1 を解除

    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = JSON.parse(raw!) as { problemKey: string }[];
    expect(saved.map((i) => i.problemKey)).toEqual(['problem-2']);
  });
});
