import { describe, it, expect } from 'vitest';
import { seatLabels, maxTierForSeats, maxTierForSeatsMode, playersBehind, getRfiScenariosForSeats } from './seats';
import { getRfiScenarios } from './rfi';
import { TIERS } from './yokosawa';

describe('seatLabels', () => {
  it('seatLabels(6) = UTG,HJ,CO,BTN,SB,BB', () => {
    expect(seatLabels(6)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  });

  it('seatLabels(10) の長さ=10、末尾2つが SB,BB、先頭が UTG', () => {
    const labels = seatLabels(10);
    expect(labels).toHaveLength(10);
    expect(labels[labels.length - 2]).toBe('SB');
    expect(labels[labels.length - 1]).toBe('BB');
    expect(labels[0]).toBe('UTG');
  });

  it('seatLabels(2) = SB,BB', () => {
    expect(seatLabels(2)).toEqual(['SB', 'BB']);
  });

  it('seatLabels(7) = UTG,LJ,HJ,CO,BTN,SB,BB', () => {
    expect(seatLabels(7)).toEqual(['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  });
});

describe('maxTierForSeats', () => {
  it('b=8→3, b=7→4, b=5→5, b=3→6, b=2→7, b=1→7', () => {
    expect(maxTierForSeats(8)).toBe(3);
    expect(maxTierForSeats(7)).toBe(4);
    expect(maxTierForSeats(5)).toBe(5);
    expect(maxTierForSeats(3)).toBe(6);
    expect(maxTierForSeats(2)).toBe(7);
    expect(maxTierForSeats(1)).toBe(7);
  });
});

describe('6max 整合: maxTierForSeats が BASE_MAX_TIER と一致', () => {
  it('UTG(b=5)→5, HJ(b=4)→5, CO(b=3)→6, BTN(b=2)→7, SB(b=1)→7', () => {
    const labels = seatLabels(6);
    // UTG は index 0, 後ろ5人
    expect(maxTierForSeats(playersBehind(6, 0))).toBe(5); // UTG: b=5
    expect(maxTierForSeats(playersBehind(6, 1))).toBe(5); // HJ: b=4
    expect(maxTierForSeats(playersBehind(6, 2))).toBe(6); // CO: b=3
    expect(maxTierForSeats(playersBehind(6, 3))).toBe(7); // BTN: b=2
    expect(maxTierForSeats(playersBehind(6, 4))).toBe(7); // SB: b=1
  });
});

describe('maxTierForSeatsMode', () => {
  it('cash-noante は 1 tier タイト化', () => {
    expect(maxTierForSeatsMode(5, 'cash-noante')).toBe(4);
    expect(maxTierForSeatsMode(3, 'tournament')).toBe(6);
    expect(maxTierForSeatsMode(3, 'cash-ante')).toBe(6);
    expect(maxTierForSeatsMode(3, 'cash-noante')).toBe(5);
  });
});

describe('getRfiScenariosForSeats', () => {
  it('n=9: BB が含まれず SB は含まれる、席数が 8', () => {
    const scenarios = getRfiScenariosForSeats(9, 'tournament');
    expect(scenarios.every(s => s.heroPos !== 'BB')).toBe(true);
    const sb = scenarios.find(s => s.heroPos === 'SB')!;
    expect(sb.sizeBB).toBe(3.0);
    expect(sb.maxTier).toBe(7); // 後ろ1人
    expect(scenarios).toHaveLength(8); // 9 seats minus BB
  });

  it('n=6: 既存 getRfiScenarios とポジション・id・レンジが一致する', () => {
    const generated = getRfiScenariosForSeats(6, 'tournament');
    const baseline = getRfiScenarios('tournament');
    expect(generated.map(s => s.heroPos)).toEqual(baseline.map(s => s.heroPos));
    expect(generated.map(s => s.id)).toEqual(baseline.map(s => s.id));
    expect(generated.map(s => s.sizeBB)).toEqual(baseline.map(s => s.sizeBB));
    for (let i = 0; i < baseline.length; i++) {
      expect(generated[i].range).toEqual(baseline[i].range);
    }
  });

  it('n=2 (HU): SB のみがオープナー、maxTier = 7', () => {
    const scenarios = getRfiScenariosForSeats(2, 'tournament');
    expect(scenarios.map(s => s.heroPos)).toEqual(['SB']);
    expect(scenarios[0].maxTier).toBe(7);
  });

  it('n=9: UTG の maxTier = 3 (tournament)', () => {
    const scenarios = getRfiScenariosForSeats(9, 'tournament');
    const utg = scenarios.find(s => s.heroPos === 'UTG')!;
    expect(utg.maxTier).toBe(3);
  });

  it('n=9: UTG の maxTier = 2 (cash-noante)', () => {
    const scenarios = getRfiScenariosForSeats(9, 'cash-noante');
    const utg = scenarios.find(s => s.heroPos === 'UTG')!;
    expect(utg.maxTier).toBe(2);
  });

  it('n=9: range のハンド数が TIERS.slice(0, maxTier).flat().length と一致', () => {
    const scenarios = getRfiScenariosForSeats(9, 'tournament');
    for (const s of scenarios) {
      const expected = TIERS.slice(0, s.maxTier).flat().length;
      expect(Object.keys(s.range)).toHaveLength(expected);
    }
  });
});
