import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Range } from '../core/ranges/types';

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
const { useCustomRanges } = await import('./customRanges');

const STORAGE_KEY = 'poker-trainer-custom-ranges';
const dummyRange = {} as unknown as Range;

describe('useCustomRanges（ゲスト/localStorage）', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    useCustomRanges.setState({ ranges: {}, loaded: false });
  });

  it('連続 setRange でも read-modify-write レースで欠落せず全件が保存される', () => {
    const { setRange } = useCustomRanges.getState();
    setRange('RFI_UTG', dummyRange);
    setRange('RFI_HJ', dummyRange);
    setRange('RFI_CO', dummyRange);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw!);
    expect(Object.keys(saved).sort()).toEqual(['RFI_CO', 'RFI_HJ', 'RFI_UTG']);
  });

  it('resetRange は削除後の最新状態を保存する', () => {
    const { setRange, resetRange } = useCustomRanges.getState();
    setRange('RFI_UTG', dummyRange);
    setRange('RFI_HJ', dummyRange);
    resetRange('RFI_UTG');

    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = JSON.parse(raw!);
    expect(Object.keys(saved)).toEqual(['RFI_HJ']);
  });
});
