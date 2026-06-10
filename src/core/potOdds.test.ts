import { describe, expect, it } from 'vitest';
import {
  genMdfDrill,
  genReqEquityDrill,
  mdf,
  mdfChoices,
  potOdds,
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
