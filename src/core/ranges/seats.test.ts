import { describe, it, expect } from 'vitest';
import { seatLabels, maxTierForSeats, maxTierForSeatsMode, playersBehind } from './seats';

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
