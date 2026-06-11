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
const { localPort } = await import('./persistence');

describe('localPort', () => {
  const KEY = 'test-persistence-key';

  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  it('存在しないキーは fallback を返す', async () => {
    const port = localPort<number[]>(KEY, []);
    const result = await port.load();
    expect(result).toEqual([]);
  });

  it('save した値を load で取得できる', async () => {
    const port = localPort<{ x: number }>(KEY, { x: 0 });
    await port.save({ x: 42 });
    const result = await port.load();
    expect(result).toEqual({ x: 42 });
  });

  it('配列を save/load できる', async () => {
    const port = localPort<string[]>(KEY, []);
    await port.save(['a', 'b', 'c']);
    const result = await port.load();
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('null fallback が機能する', async () => {
    const port = localPort<string | null>(KEY, null);
    const result = await port.load();
    expect(result).toBeNull();
  });

  it('破損した JSON は fallback を返す', async () => {
    localStorage.setItem(KEY, 'not-valid-json{{{');
    const port = localPort<number>(KEY, 99);
    const result = await port.load();
    expect(result).toBe(99);
  });

  it('上書き保存が正しく機能する', async () => {
    const port = localPort<string>(KEY, '');
    await port.save('first');
    await port.save('second');
    const result = await port.load();
    expect(result).toBe('second');
  });
});
