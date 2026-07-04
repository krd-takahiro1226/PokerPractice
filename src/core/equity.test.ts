import { describe, it, expect } from 'vitest';
import { computeEquity } from './equity';
import type { Card } from './cards';

describe('computeEquity - 決定論的ケース（ボード完成済み）', () => {
  it('確定勝敗: ボード5枚完成済みなら1試行で決定論的に勝者が決まる', () => {
    const board: Card[] = ['Kd', '7c', '3h', '9s', '2d'];
    const hero: [Card, Card] = ['Ah', 'Ac']; // ペアオブエース
    const villain: [Card, Card] = ['Kh', 'Qh']; // ペアオブキング

    const result = computeEquity([hero, villain], board, 5000);

    expect(result.iterations).toBe(1); // need===0 なので試行回数は常に1
    expect(result.players[0].win).toBe(1);
    expect(result.players[0].equity).toBe(1);
    expect(result.players[1].win).toBe(0);
    expect(result.players[1].equity).toBe(0);
  });

  it('split: ボードがそのまま最強役でプレイされるなら両者ともtie', () => {
    // Th-Ah 全てハートのロイヤルフラッシュがボードに乗っている: 誰のホールカードも無関係
    const board: Card[] = ['Th', 'Jh', 'Qh', 'Kh', 'Ah'];
    const hero: [Card, Card] = ['2c', '3d'];
    const villain: [Card, Card] = ['4c', '5d'];

    const result = computeEquity([hero, villain], board, 5000);

    expect(result.iterations).toBe(1);
    expect(result.players[0].tie).toBe(1);
    expect(result.players[0].win).toBe(0);
    expect(result.players[0].equity).toBeCloseTo(0.5);
    expect(result.players[1].tie).toBe(1);
    expect(result.players[1].equity).toBeCloseTo(0.5);
  });

  it('need===0 のときは iterations に大きな値を渡しても試行回数は1に固定される', () => {
    const board: Card[] = ['Kd', '7c', '3h', '9s', '2d'];
    const hero: [Card, Card] = ['Ah', 'Ac'];
    const villain: [Card, Card] = ['Kh', 'Qh'];

    const result = computeEquity([hero, villain], board, 999999);
    expect(result.iterations).toBe(1);
  });
});

describe('computeEquity - iterations のクランプ（CORE-5）', () => {
  it('iterations<=0 でも NaN にならず、最低1回は試行する', () => {
    const board: Card[] = ['Th', 'Jh', 'Qh'];
    const hero: [Card, Card] = ['Ah', 'Kh'];
    const villain: [Card, Card] = ['2c', '3d'];

    for (const iterations of [0, -1, -100]) {
      const result = computeEquity([hero, villain], board, iterations);
      expect(result.iterations).toBe(1);
      for (const p of result.players) {
        expect(Number.isNaN(p.win)).toBe(false);
        expect(Number.isNaN(p.tie)).toBe(false);
        expect(Number.isNaN(p.equity)).toBe(false);
        expect(p.equity).toBeGreaterThanOrEqual(0);
        expect(p.equity).toBeLessThanOrEqual(1);
      }
    }
  });
});
