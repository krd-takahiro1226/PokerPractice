import { describe, it, expect } from 'vitest';
import { evaluateShowdown } from './showdown';
import type { PlayerState } from './types';
import type { Card } from '../cards';

function makePlayer(
  id: number,
  hole: [Card, Card],
  committedTotal: number,
  status: PlayerState['status'] = 'active',
): PlayerState {
  return {
    id,
    isHero: id === 0,
    pos: 'UTG',
    stack: 100 - committedTotal,
    hole,
    committedTotal,
    committedStreet: 0,
    status,
    hasActedThisStreet: false,
  };
}

describe('evaluateShowdown', () => {
  it('上位ハンドが勝つ', () => {
    // P0: AA（フルハウス）vs P1: 72o（ハイカード）
    const board: Card[] = ['As', 'Ah', 'Kd', '7c', '2s'];
    const players = [
      makePlayer(0, ['Ac', 'Ad'], 50),
      makePlayer(1, ['7h', '2d'], 50),
    ];
    const result = evaluateShowdown(players, board);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe(0);
    expect(result.winners[0].amount).toBe(100);
    expect(result.shown).toHaveLength(2);
  });

  it('同手役で引き分け分割', () => {
    // P0: AKs, P1: AKo どちらもボードの役を使う
    const board: Card[] = ['Qh', 'Jh', 'Th', '2d', '3c'];
    // Both make broadway straight QJT+AK
    const players = [
      makePlayer(0, ['As', 'Kd'], 50),
      makePlayer(1, ['Ah', 'Ks'], 50),
    ];
    const result = evaluateShowdown(players, board);
    expect(result.winners).toHaveLength(2);
    expect(result.winners.find((w) => w.playerId === 0)?.amount).toBe(50);
    expect(result.winners.find((w) => w.playerId === 1)?.amount).toBe(50);
  });

  it('folded プレイヤーは shown に含まれない', () => {
    const board: Card[] = ['As', 'Kd', 'Qh', 'Jc', 'Ts'];
    const players = [
      makePlayer(0, ['Ah', 'Kh'], 50),
      makePlayer(1, ['2s', '3s'], 10, 'folded'),
    ];
    const result = evaluateShowdown(players, board);
    expect(result.shown.find((s) => s.playerId === 1)).toBeUndefined();
    expect(result.winners[0].playerId).toBe(0);
  });

  it('handName が適切に設定される', () => {
    const board: Card[] = ['As', 'Ah', 'Ad', 'Kd', '2c'];
    const players = [
      makePlayer(0, ['Ac', 'Kh'], 50),
      makePlayer(1, ['7h', '8h'], 50),
    ];
    const result = evaluateShowdown(players, board);
    const heroShown = result.shown.find((s) => s.playerId === 0);
    expect(heroShown?.handName).toBe('フォーカード');
  });
});
