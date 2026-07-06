import { describe, it, expect } from 'vitest';
import { estimatePlayerRange, buildBroadRange } from './villainRange';
import { getScenarioForMode } from '../ranges';
import { getVsOpen } from '../ranges/vsOpen';
import type { HandLogEntry } from '../game/types';

function rangeFromRaise(scenario: { range: Record<string, { raise?: number; call?: number }> }): Record<string, number> {
  const range: Record<string, number> = {};
  for (const [hc, action] of Object.entries(scenario.range)) {
    const freq = action.raise ?? 0;
    if (freq > 0) range[hc] = freq;
  }
  return range;
}

function rangeFromCall(scenario: { range: Record<string, { raise?: number; call?: number }> }): Record<string, number> {
  const range: Record<string, number> = {};
  for (const [hc, action] of Object.entries(scenario.range)) {
    const freq = action.call ?? 0;
    if (freq > 0) range[hc] = freq;
  }
  return range;
}

describe('estimatePlayerRange', () => {
  it('オープナー本人にはRFIレンジ(raise)を割り当てる', () => {
    const log: HandLogEntry[] = [
      { street: 'preflop', playerId: 1, pos: 'UTG', action: 'raise', amount: 2.5, potAfter: 4 },
    ];
    const result = estimatePlayerRange(log, 1, 'tournament');
    const expected = rangeFromRaise(getScenarioForMode('RFI_UTG', 'tournament')!);
    expect(result).toEqual(expected);
  });

  it('vs openをコールしたプレイヤーにはvsOpenのcallレンジを割り当てる', () => {
    const log: HandLogEntry[] = [
      { street: 'preflop', playerId: 1, pos: 'UTG', action: 'raise', amount: 2.5, potAfter: 4 },
      { street: 'preflop', playerId: 3, pos: 'BTN', action: 'call', amount: 2.5, potAfter: 6.5 },
    ];
    const result = estimatePlayerRange(log, 3, 'tournament');
    const expected = rangeFromCall(getVsOpen('BTN', 'UTG')!);
    expect(result).toEqual(expected);
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it('vs openを3betしたプレイヤーにはvsOpenのraise(3bet)レンジを割り当てる', () => {
    const log: HandLogEntry[] = [
      { street: 'preflop', playerId: 1, pos: 'UTG', action: 'raise', amount: 2.5, potAfter: 4 },
      { street: 'preflop', playerId: 3, pos: 'BTN', action: 'raise', amount: 9, potAfter: 12.5 },
    ];
    const result = estimatePlayerRange(log, 3, 'tournament');
    const expected = rangeFromRaise(getVsOpen('BTN', 'UTG')!);
    expect(result).toEqual(expected);
    expect(Object.keys(result).length).toBeGreaterThan(0);
    // 3betレンジはRFIよりずっとタイトなはず
    const rfiRange = rangeFromRaise(getScenarioForMode('RFI_BTN', 'tournament')!);
    expect(Object.keys(result).length).toBeLessThan(Object.keys(rfiRange).length);
  });

  it('プリフロップにオープンが無い(リンプ/チェックのみ)場合は広域レンジにフォールバックする', () => {
    const log: HandLogEntry[] = [
      { street: 'preflop', playerId: 1, pos: 'UTG', action: 'call', amount: 1, potAfter: 3 },
      { street: 'preflop', playerId: 5, pos: 'BB', action: 'check', potAfter: 3 },
    ];
    const result = estimatePlayerRange(log, 1, 'tournament');
    expect(result).toEqual(buildBroadRange());
  });

  it('対象プレイヤーの情報が全く無い場合も広域レンジにフォールバックする', () => {
    const result = estimatePlayerRange([], 2, 'tournament');
    expect(result).toEqual(buildBroadRange());
  });
});
