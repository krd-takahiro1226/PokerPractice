import { describe, it, expect } from 'vitest';
import { visiblePotLayers } from './PotDisplay';
import type { Pot } from '../../core/game/pots';

describe('visiblePotLayers', () => {
  it('レイヤーが1つのときはそのまま返す', () => {
    const pots: Pot[] = [{ amount: 10, eligible: [0, 1, 2] }];
    expect(visiblePotLayers(pots)).toEqual(pots);
  });

  it('末尾レイヤーが eligible 1人のみ（未コールの超過分）なら除外する', () => {
    const pots: Pot[] = [
      { amount: 10, eligible: [0, 1, 2] },
      { amount: 5, eligible: [1] },
    ];
    expect(visiblePotLayers(pots)).toEqual([{ amount: 10, eligible: [0, 1, 2] }]);
  });

  it('末尾レイヤーも複数人 eligible なら全レイヤーを返す（サイドポット確定）', () => {
    const pots: Pot[] = [
      { amount: 10, eligible: [0, 1, 2] },
      { amount: 5, eligible: [1, 2] },
    ];
    expect(visiblePotLayers(pots)).toEqual(pots);
  });

  it('空配列はそのまま返す', () => {
    expect(visiblePotLayers([])).toEqual([]);
  });
});
