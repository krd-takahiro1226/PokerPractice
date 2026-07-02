import { describe, expect, it } from 'vitest';
import {
  equityFromOuts,
  genImpliedDrill,
  genMdfDrill,
  genReqEquityDrill,
  mdf,
  mdfChoices,
  potOdds,
  requiredImpliedAmount,
  reqEquityChoices,
} from './potOdds';

describe('potOdds', () => {
  it('potOdds(100, 50) === 1/3', () => {
    expect(potOdds(100, 50)).toBeCloseTo(1 / 3, 10);
  });

  it('returns 0 when toCall <= 0', () => {
    expect(potOdds(100, 0)).toBe(0);
    expect(potOdds(100, -5)).toBe(0);
  });
});

describe('mdf', () => {
  it('mdf(100, 100) === 0.5', () => {
    expect(mdf(100, 100)).toBe(0.5);
  });

  it('mdf(100, 50) ≈ 0.6667 (1/2 pot → 67%)', () => {
    expect(mdf(100, 50)).toBeCloseTo(2 / 3, 10);
  });

  it('mdf(100, 200) ≈ 0.3333 (2x pot → 33%)', () => {
    expect(mdf(100, 200)).toBeCloseTo(1 / 3, 10);
  });

  it('1/3 pot → ~75%', () => {
    // pot=90, bet=30 → mdf=90/120=0.75
    expect(mdf(90, 30)).toBeCloseTo(0.75, 10);
  });

  it('returns 1 when bet <= 0 (guard)', () => {
    expect(mdf(100, 0)).toBe(1);
  });
});

describe('reqEquityChoices', () => {
  it('contains the correct answer', () => {
    const answer = potOdds(80, 40);
    const choices = reqEquityChoices(80, 40);
    expect(choices.some((c) => Math.abs(c - answer) < 0.001)).toBe(true);
  });

  it('returns exactly 4 choices', () => {
    for (let i = 0; i < 20; i++) {
      expect(reqEquityChoices(80, 40).length).toBe(4);
      expect(reqEquityChoices(100, 100).length).toBe(4);
    }
  });

  it('all choices are in [0, 1]', () => {
    for (let i = 0; i < 20; i++) {
      reqEquityChoices(80, 40).forEach((c) => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      });
    }
  });

  it('reqEquityChoices(80, 40) contains ~0.333 (40/120)', () => {
    const choices = reqEquityChoices(80, 40);
    expect(choices.some((c) => Math.abs(c - 1 / 3) < 0.001)).toBe(true);
  });
});

describe('genReqEquityDrill', () => {
  const RUNS = 200;

  it('choices.length === 4 across many samples', () => {
    for (let i = 0; i < RUNS; i++) {
      const d = genReqEquityDrill();
      expect(d.choices.length).toBe(4);
    }
  });

  it('choices always contains the answer', () => {
    for (let i = 0; i < RUNS; i++) {
      const d = genReqEquityDrill();
      expect(d.choices.some((c) => Math.abs(c - d.answer) < 0.001)).toBe(true);
    }
  });

  it('all choices are in [0, 1]', () => {
    for (let i = 0; i < RUNS; i++) {
      const d = genReqEquityDrill();
      d.choices.forEach((c) => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      });
    }
  });

  it('no duplicate choices (rounded to 3 decimal places)', () => {
    for (let i = 0; i < RUNS; i++) {
      const d = genReqEquityDrill();
      const rounded = d.choices.map((c) => Math.round(c * 1000));
      const unique = new Set(rounded);
      expect(unique.size).toBe(4);
    }
  });
});

describe('genMdfDrill', () => {
  const RUNS = 200;

  it('choices.length === 4 across many samples', () => {
    for (let i = 0; i < RUNS; i++) {
      const d = genMdfDrill();
      expect(d.choices.length).toBe(4);
    }
  });

  it('choices always contains the answer', () => {
    for (let i = 0; i < RUNS; i++) {
      const d = genMdfDrill();
      expect(d.choices.some((c) => Math.abs(c - d.answer) < 0.001)).toBe(true);
    }
  });

  it('all choices are in [0, 1]', () => {
    for (let i = 0; i < RUNS; i++) {
      const d = genMdfDrill();
      d.choices.forEach((c) => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      });
    }
  });

  it('no duplicate choices', () => {
    for (let i = 0; i < RUNS; i++) {
      const d = genMdfDrill();
      const rounded = d.choices.map((c) => Math.round(c * 1000));
      const unique = new Set(rounded);
      expect(unique.size).toBe(4);
    }
  });
});

describe('mdfChoices', () => {
  it('contains the correct answer', () => {
    const answer = mdf(100, 100);
    const choices = mdfChoices(100, 100);
    expect(choices.some((c) => Math.abs(c - answer) < 0.001)).toBe(true);
  });

  it('returns 4 choices', () => {
    expect(mdfChoices(100, 100).length).toBe(4);
  });
});

describe('requiredImpliedAmount', () => {
  it('returns 0 when equity is exactly potOdds(pot, toCall)', () => {
    const pot = 100;
    const toCall = 50;
    const equity = potOdds(pot, toCall); // 1/3
    expect(requiredImpliedAmount(pot, toCall, equity)).toBeCloseTo(0, 10);
  });

  it('matches hand-calculated value', () => {
    // pot=100, toCall=100, equity=0.2 → X = 100/0.2 - 200 = 300
    expect(requiredImpliedAmount(100, 100, 0.2)).toBeCloseTo(300, 10);
  });

  it('another hand-calculated value', () => {
    // pot=60, toCall=40, equity=0.25 → X = 40/0.25 - 100 = 60
    expect(requiredImpliedAmount(60, 40, 0.25)).toBeCloseTo(60, 10);
  });

  it('never returns negative (equity comfortably above potOdds)', () => {
    // pot=100, toCall=20, potOdds ≈ 0.1667, equity=0.5 way above required
    const result = requiredImpliedAmount(100, 20, 0.5);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('genImpliedDrill', () => {
  function makeRng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0x100000000;
    };
  }

  const RUNS = 200;

  it('pot/toCall/behindStack are within spec ranges', () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const d = genImpliedDrill(makeRng(seed + 1));
      expect(d.pot).toBeGreaterThanOrEqual(40);
      expect(d.pot).toBeLessThanOrEqual(300);
      expect(d.pot % 10).toBe(0);

      expect(d.toCall).toBeGreaterThanOrEqual(20);
      expect(d.toCall % 10).toBe(0);

      expect(d.behindStack).toBeGreaterThanOrEqual(100);
      expect(d.behindStack).toBeLessThanOrEqual(600);
      expect(d.behindStack % 10).toBe(0);
    }
  });

  it('requiredExtra matches requiredImpliedAmount(pot, toCall, equity)', () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const d = genImpliedDrill(makeRng(seed + 1));
      const cardsToCome = d.street === 'flop' ? 2 : 1;
      const equity = equityFromOuts(d.outs, cardsToCome);
      const expected = requiredImpliedAmount(d.pot, d.toCall, equity);
      expect(d.requiredExtra).toBeCloseTo(expected, 6);
    }
  });

  it('answer is consistent with requiredExtra <= collectFactor * behindStack', () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const d = genImpliedDrill(makeRng(seed + 1));
      const expectedAnswer = d.requiredExtra <= d.collectFactor * d.behindStack ? 'call' : 'fold';
      expect(d.answer).toBe(expectedAnswer);
    }
  });

  it('collectFactor matches drawId category', () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const d = genImpliedDrill(makeRng(seed + 1));
      if (['flush', 'fd-gutshot', 'fd-oesd'].includes(d.drawId)) {
        expect(d.collectFactor).toBe(0.3);
      } else if (['gutshot', 'oesd'].includes(d.drawId)) {
        expect(d.collectFactor).toBe(0.5);
      } else {
        expect(d.collectFactor).toBe(0.2);
      }
    }
  });

  it('street is flop or turn', () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const d = genImpliedDrill(makeRng(seed + 1));
      expect(['flop', 'turn']).toContain(d.street);
    }
  });
});
