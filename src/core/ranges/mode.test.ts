import { describe, it, expect } from 'vitest';
import { maxTierFor } from './mode';

describe('maxTierFor', () => {
  it('tournament/cash-ante: UTG=5, HJ=5, CO=6, BTN=7, SB=7, BB=0', () => {
    for (const mode of ['tournament', 'cash-ante'] as const) {
      expect(maxTierFor(mode, 'UTG')).toBe(5);
      expect(maxTierFor(mode, 'HJ')).toBe(5);
      expect(maxTierFor(mode, 'CO')).toBe(6);
      expect(maxTierFor(mode, 'BTN')).toBe(7);
      expect(maxTierFor(mode, 'SB')).toBe(7);
      expect(maxTierFor(mode, 'BB')).toBe(0);
    }
  });

  it('cash-noante: UTG=4, HJ=4, CO=5, BTN=6, SB=6, BB=0', () => {
    expect(maxTierFor('cash-noante', 'UTG')).toBe(4);
    expect(maxTierFor('cash-noante', 'HJ')).toBe(4);
    expect(maxTierFor('cash-noante', 'CO')).toBe(5);
    expect(maxTierFor('cash-noante', 'BTN')).toBe(6);
    expect(maxTierFor('cash-noante', 'SB')).toBe(6);
    expect(maxTierFor('cash-noante', 'BB')).toBe(0);
  });
});
