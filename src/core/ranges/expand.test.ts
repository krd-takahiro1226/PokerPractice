import { describe, it, expect } from 'vitest';
import { expandToken, tokensToRange, openPercent } from './expand';

describe('expandToken', () => {
  it('expands pair plus', () => {
    expect(expandToken('22+')).toHaveLength(13);
    expect(expandToken('TT+')).toEqual(['TT', 'JJ', 'QQ', 'KK', 'AA']);
  });

  it('expands suited/offsuit plus', () => {
    expect(expandToken('ATs+')).toEqual(['ATs', 'AJs', 'AQs', 'AKs']);
    expect(expandToken('K9s+')).toEqual(['K9s', 'KTs', 'KJs', 'KQs']);
    expect(expandToken('A2o+')).toHaveLength(12);
  });

  it('expands dash ranges', () => {
    expect(expandToken('A5s-A4s')).toEqual(['A4s', 'A5s']);
  });

  it('passes through singles', () => {
    expect(expandToken('JTs')).toEqual(['JTs']);
  });
});

describe('range helpers', () => {
  it('builds a pure-raise range', () => {
    const r = tokensToRange(['AA', 'KK']);
    expect(r['AA']).toEqual({ raise: 1 });
    expect(r['KK']).toEqual({ raise: 1 });
  });

  it('computes open percentage by combos', () => {
    // AA = 6 combos out of 1326
    expect(openPercent(tokensToRange(['AA']))).toBeCloseTo(6 / 1326, 6);
  });
});
