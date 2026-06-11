import { describe, it, expect } from 'vitest';
import { getRfiRange, getRfiScenarios } from './rfi';

describe('getRfiRange - cash-noante', () => {
  it('cash-noante UTG: tier5 のハンドを含まない', () => {
    const range = getRfiRange('cash-noante', 'UTG');
    // tier5 のハンド
    expect(range['A9o']).toBeUndefined();
    expect(range['22']).toBeUndefined();
    expect(range['JTo']).toBeUndefined();
  });

  it('cash-noante UTG: tier4 のハンドを含む', () => {
    const range = getRfiRange('cash-noante', 'UTG');
    expect(range['A2s']).toBeDefined();
    expect(range['ATo']).toBeDefined();
    expect(range['T9s']).toBeDefined();
  });

  it('cash-noante BTN: tier7 のハンドを含まない', () => {
    const range = getRfiRange('cash-noante', 'BTN');
    expect(range['54s']).toBeUndefined();
    expect(range['A6o']).toBeUndefined();
    expect(range['98o']).toBeUndefined();
  });

  it('cash-noante BTN: tier6 のハンドを含む', () => {
    const range = getRfiRange('cash-noante', 'BTN');
    expect(range['K2s']).toBeDefined();
    expect(range['KTo']).toBeDefined();
  });
});

describe('getRfiRange - 包含関係', () => {
  it('tournament BTN ⊇ cash-noante BTN', () => {
    const tRange = getRfiRange('tournament', 'BTN');
    const cRange = getRfiRange('cash-noante', 'BTN');
    for (const hand of Object.keys(cRange)) {
      expect(tRange[hand], `${hand} が tournament BTN に含まれない`).toBeDefined();
    }
  });

  it('tournament UTG ⊇ cash-noante UTG', () => {
    const tRange = getRfiRange('tournament', 'UTG');
    const cRange = getRfiRange('cash-noante', 'UTG');
    for (const hand of Object.keys(cRange)) {
      expect(tRange[hand], `${hand} が tournament UTG に含まれない`).toBeDefined();
    }
  });
});

describe('getRfiScenarios', () => {
  it('5件返す', () => {
    for (const mode of ['tournament', 'cash-ante', 'cash-noante'] as const) {
      const scenarios = getRfiScenarios(mode);
      expect(scenarios).toHaveLength(5);
    }
  });

  it('id が RFI_<pos> 形式で heroPos と一致する', () => {
    const scenarios = getRfiScenarios('tournament');
    for (const s of scenarios) {
      expect(s.id).toBe(`RFI_${s.heroPos}`);
    }
  });
});
