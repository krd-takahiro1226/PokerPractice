import { describe, it, expect } from 'vitest';
import { reviewHand } from './reviewHand';
import type { SavedHand } from '../../store/history';

function makeSavedHand(overrides: Partial<SavedHand> = {}): SavedHand {
  const defaults: SavedHand = {
    id: 'test-1',
    ts: Date.now(),
    mode: 'tournament',
    difficulty: 'normal',
    heroPos: 'BTN',
    heroHole: ['As', 'Kh'],
    board: [],
    log: [],
    result: {
      winners: [{ playerId: 0, amount: 5 }],
      shown: [],
      board: [],
      endedAtStreet: 'preflop',
    },
    heroNet: 2.5,
    ...overrides,
  };
  return defaults;
}

describe('reviewHand - advice アダプタ (Phase 2)', () => {
  it('プリフロップ RFI レンジ内オープンに advice(source=range-table) が添付される', () => {
    const hand = makeSavedHand({
      heroPos: 'BTN',
      heroHole: ['As', 'Kh'], // AKo は BTN レンジ内
      log: [
        { street: 'preflop', playerId: 0, pos: 'BTN', action: 'raise', amount: 2.5, potAfter: 4 },
      ],
    });

    const reviews = reviewHand(hand);
    expect(reviews.length).toBeGreaterThan(0);

    const review = reviews[0];
    // 既存の verdict/headline/detail は advice の有無に関わらず従来通り出力される
    expect(review.verdict).toBe('good');
    expect(review.headline).toBe('オープン妥当');
    expect(review.detail.length).toBeGreaterThan(0);

    expect(review.advice).toBeDefined();
    expect(review.advice?.source).toBe('range-table');
    expect(review.advice?.candidates.length).toBeGreaterThan(0);
  });

  it('advice が付いても既存の verdict 生成ロジックには影響しない（RFIレンジ外フォールド）', () => {
    const hand = makeSavedHand({
      heroPos: 'UTG',
      heroHole: ['7s', '2h'], // 72o は UTG レンジ外
      log: [
        { street: 'preflop', playerId: 0, pos: 'UTG', action: 'fold', potAfter: 1.5 },
      ],
    });

    const reviews = reviewHand(hand);
    expect(reviews.length).toBeGreaterThan(0);

    const review = reviews[0];
    expect(review.verdict).toBe('good');
    expect(review.headline).toBe('フォールド妥当');
  });
});
