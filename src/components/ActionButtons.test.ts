import { describe, it, expect } from 'vitest';
import { gridColsClass } from './ActionButtons';

describe('gridColsClass', () => {
  it('選択肢が2件のときは grid-cols-2 を返す', () => {
    expect(gridColsClass(2)).toBe('grid grid-cols-2 gap-3');
  });

  it('選択肢が3件のときは grid-cols-3 を返す', () => {
    expect(gridColsClass(3)).toBe('grid grid-cols-3 gap-3');
  });

  it('選択肢が1件でも grid-cols-3 にフォールバックする', () => {
    expect(gridColsClass(1)).toBe('grid grid-cols-3 gap-3');
  });
});
