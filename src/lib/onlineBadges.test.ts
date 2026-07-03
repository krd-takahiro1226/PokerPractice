import { describe, it, expect } from 'vitest';
import { seatActionBadges } from './onlineBadges';
import type { PublicGameState } from '../core/online/types';
import type { HandLogEntry } from '../core/game/types';

function makeState(street: PublicGameState['street'], log: HandLogEntry[], n = 3): PublicGameState {
  return {
    street,
    log,
    players: Array.from({ length: n }, () => ({})),
  } as unknown as PublicGameState;
}

describe('seatActionBadges', () => {
  it('同一ストリートで複数回アクションした場合は最後のものを返す', () => {
    const log: HandLogEntry[] = [
      { street: 'flop', playerId: 0, pos: 'BTN', action: 'bet', amount: 3, potAfter: 5 },
      { street: 'flop', playerId: 0, pos: 'BTN', action: 'raise', amount: 9, potAfter: 14 },
    ];
    const state = makeState('flop', log);
    const badges = seatActionBadges(state);
    expect(badges[0]).toEqual({ action: 'raise', amount: 9 });
  });

  it('ストリートが変わったらfold以外は消える', () => {
    const log: HandLogEntry[] = [
      { street: 'flop', playerId: 0, pos: 'BTN', action: 'bet', amount: 3, potAfter: 5 },
      { street: 'flop', playerId: 1, pos: 'SB', action: 'call', potAfter: 8 },
    ];
    const state = makeState('turn', log);
    const badges = seatActionBadges(state);
    expect(badges[0]).toBeNull();
    expect(badges[1]).toBeNull();
  });

  it('一度foldしたら以後のストリートでもfoldのまま', () => {
    const log: HandLogEntry[] = [
      { street: 'preflop', playerId: 2, pos: 'BB', action: 'fold', potAfter: 3 },
      { street: 'flop', playerId: 0, pos: 'BTN', action: 'check', potAfter: 3 },
    ];
    const state = makeState('turn', log);
    const badges = seatActionBadges(state);
    expect(badges[2]).toEqual({ action: 'fold' });
  });

  it('該当するlogエントリが無ければnullを返す', () => {
    const state = makeState('preflop', []);
    const badges = seatActionBadges(state);
    expect(badges).toEqual([null, null, null]);
  });
});
