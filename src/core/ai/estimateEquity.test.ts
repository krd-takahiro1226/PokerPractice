import { describe, it, expect } from 'vitest';
import { estimateEquityVsRange, estimateEquityVsRanges } from './estimateEquity';
import { buildBroadRange } from './villainRange';
import type { Card } from '../cards';

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

describe('estimateEquityVsRanges', () => {
  it('villainRanges が空なら 0.5 を返す', () => {
    const hole: [Card, Card] = ['As', 'Ah'];
    expect(estimateEquityVsRanges(hole, [], [], 100, makeRng(1))).toBe(0.5);
  });

  it('相手1人の場合はestimateEquityVsRangeと同一結果になる（内部委譲の確認）', () => {
    const hole: [Card, Card] = ['As', 'Ah'];
    const range = buildBroadRange();
    const single = estimateEquityVsRange(hole, [], range, 500, makeRng(7));
    const viaMulti = estimateEquityVsRanges(hole, [], [range], 500, makeRng(7));
    expect(viaMulti).toBe(single);
  });

  it('AA: 相手2人(広域レンジ)のエクイティは相手1人より低い', () => {
    const hole: [Card, Card] = ['As', 'Ah'];
    const range = buildBroadRange();
    const vsOne = estimateEquityVsRanges(hole, [], [range], 1500, makeRng(42));
    const vsTwo = estimateEquityVsRanges(hole, [], [range, range], 1500, makeRng(42));
    expect(vsTwo).toBeLessThan(vsOne);
  });
});
