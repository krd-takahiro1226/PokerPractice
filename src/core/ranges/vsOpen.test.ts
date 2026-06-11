import { describe, it, expect } from 'vitest';
import { getVsOpen } from './vsOpen';

describe('getVsOpen BB vs BTN (ヨコサワ由来)', () => {
  it('value ハンドが raise', () => {
    const scenario = getVsOpen('BB', 'BTN')!;
    expect(scenario).toBeDefined();
    for (const h of ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo']) {
      expect(scenario.range[h]?.raise, `${h} should be raise`).toBe(1);
    }
  });

  it('bluff 3bet ハンドが raise', () => {
    const scenario = getVsOpen('BB', 'BTN')!;
    expect(scenario.range['A5s']?.raise).toBe(1);
    expect(scenario.range['A4s']?.raise).toBe(1);
  });

  it('コールレンジのハンドが call', () => {
    const scenario = getVsOpen('BB', 'BTN')!;
    // tier2〜7 由来（A5s, A4s 以外）
    expect(scenario.range['A3s']?.call).toBe(1);
    expect(scenario.range['T8s']?.call).toBe(1);
    // bbCall 層
    expect(scenario.range['A2o']?.call).toBe(1);
    expect(scenario.range['87o']?.call).toBe(1);
  });

  it('raise と call が同一ハンドに同時に立たない（raise 優先）', () => {
    const scenario = getVsOpen('BB', 'BTN')!;
    for (const [h, action] of Object.entries(scenario.range)) {
      const hasRaise = (action.raise ?? 0) > 0;
      const hasCall = (action.call ?? 0) > 0;
      expect(
        hasRaise && hasCall,
        `${h} は raise と call の両方が立っている`,
      ).toBe(false);
    }
  });
});
