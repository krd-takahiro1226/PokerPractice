import { describe, it, expect } from 'vitest';
import { buildPots, distributePots } from './pots';
import type { PlayerState } from './types';

function makePlayer(
  id: number,
  committedTotal: number,
  status: PlayerState['status'] = 'active',
): PlayerState {
  return {
    id,
    isHero: id === 0,
    pos: 'UTG',
    stack: 100 - committedTotal,
    hole: null,
    committedTotal,
    committedStreet: 0,
    status,
    hasActedThisStreet: false,
  };
}

describe('buildPots', () => {
  it('単純ヘッズアップ', () => {
    const players = [makePlayer(0, 10), makePlayer(1, 10)];
    const pots = buildPots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(20);
    expect(pots[0].eligible).toEqual(expect.arrayContaining([0, 1]));
  });

  it('3者で1人all-inのサイドポット', () => {
    // P0: 50, P1: 100, P2: 100 → メイン50*3=150、サイド50*2=100
    const players = [
      makePlayer(0, 50, 'allin'),
      makePlayer(1, 100),
      makePlayer(2, 100),
    ];
    const pots = buildPots(players);
    expect(pots).toHaveLength(2);
    expect(pots[0].amount).toBe(150); // 50 * 3
    expect(pots[0].eligible).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(pots[1].amount).toBe(100); // 50 * 2
    expect(pots[1].eligible).not.toContain(0);
    expect(pots[1].eligible).toEqual(expect.arrayContaining([1, 2]));
  });

  it('folded プレイヤーの拠出はポット額に入るが eligible には入らない', () => {
    const players = [
      makePlayer(0, 5, 'folded'),
      makePlayer(1, 10),
      makePlayer(2, 10),
    ];
    const pots = buildPots(players);
    // folded の5は別層になるがeligibleは[1,2]のみ
    const totalPot = pots.reduce((s, p) => s + p.amount, 0);
    expect(totalPot).toBe(25);
    for (const pot of pots) {
      expect(pot.eligible).not.toContain(0);
    }
  });

  it('全員同額なら1つのポット', () => {
    const players = [makePlayer(0, 20), makePlayer(1, 20), makePlayer(2, 20)];
    const pots = buildPots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(60);
    expect(pots[0].eligible).toHaveLength(3);
  });
});

describe('distributePots', () => {
  it('明確な勝者が全額獲得', () => {
    const pots = [{ amount: 100, eligible: [0, 1] }];
    const rankByPlayer = new Map([[0, 200], [1, 100]]);
    const result = distributePots(pots, rankByPlayer);
    expect(result.get(0)).toBe(100);
    expect(result.get(1)).toBeUndefined();
  });

  it('引き分けで均等分割', () => {
    const pots = [{ amount: 100, eligible: [0, 1] }];
    const rankByPlayer = new Map([[0, 150], [1, 150]]);
    const result = distributePots(pots, rankByPlayer);
    expect(result.get(0)).toBe(50);
    expect(result.get(1)).toBe(50);
  });

  it('3者引き分けで均等分割', () => {
    const pots = [{ amount: 90, eligible: [0, 1, 2] }];
    const rankByPlayer = new Map([[0, 100], [1, 100], [2, 100]]);
    const result = distributePots(pots, rankByPlayer);
    expect(result.get(0)).toBe(30);
    expect(result.get(1)).toBe(30);
    expect(result.get(2)).toBe(30);
  });

  it('サイドポット: P0がメインのみ、P1がサイドも獲得', () => {
    // メインポット: P0, P1, P2 eligible
    // サイドポット: P1, P2 eligible
    const pots = [
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 100, eligible: [1, 2] },
    ];
    // P0が最強だがサイドポットに資格なし
    const rankByPlayer = new Map([[0, 300], [1, 200], [2, 100]]);
    const result = distributePots(pots, rankByPlayer);
    expect(result.get(0)).toBe(150); // メインポット
    expect(result.get(1)).toBe(100); // サイドポット
    expect(result.get(2)).toBeUndefined();
  });
});
