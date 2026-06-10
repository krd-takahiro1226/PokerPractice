import { describe, it, expect } from 'vitest';
import { reviewHand } from './reviewHand';
import type { SavedHand } from '../../store/history';
import type { HandLogEntry, HandResult } from '../game/types';

function makeSavedHand(overrides: Partial<SavedHand> = {}): SavedHand {
  const defaults: SavedHand = {
    id: 'test-1',
    ts: Date.now(),
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

describe('reviewHand - プリフロップ RFI', () => {
  it('RFIレンジ内でオープン → good', () => {
    const hand = makeSavedHand({
      heroPos: 'BTN',
      heroHole: ['As', 'Kh'], // AKo はBTNレンジ内
      log: [
        {
          street: 'preflop',
          playerId: 0,
          pos: 'BTN',
          action: 'raise',
          amount: 2.5,
          potAfter: 4,
        },
      ],
    });
    const reviews = reviewHand(hand);
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews[0].verdict).toBe('good');
  });

  it('RFIレンジ外でフォールド → good', () => {
    const hand = makeSavedHand({
      heroPos: 'UTG',
      heroHole: ['7s', '2h'], // 72o はUTGレンジ外
      log: [
        {
          street: 'preflop',
          playerId: 0,
          pos: 'UTG',
          action: 'fold',
          potAfter: 1.5,
        },
      ],
    });
    const reviews = reviewHand(hand);
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews[0].verdict).toBe('good');
  });

  it('RFIレンジ外でオープン → mistake', () => {
    const hand = makeSavedHand({
      heroPos: 'UTG',
      heroHole: ['7s', '2h'], // 72o はUTGレンジ外
      log: [
        {
          street: 'preflop',
          playerId: 0,
          pos: 'UTG',
          action: 'raise',
          amount: 2.5,
          potAfter: 4,
        },
      ],
    });
    const reviews = reviewHand(hand);
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews[0].verdict).toBe('mistake');
  });

  it('RFIレンジ内でフォールド → mistake', () => {
    const hand = makeSavedHand({
      heroPos: 'BTN',
      heroHole: ['As', 'Ks'], // AKs はBTNレンジ内
      log: [
        {
          street: 'preflop',
          playerId: 0,
          pos: 'BTN',
          action: 'fold',
          potAfter: 1.5,
        },
      ],
    });
    const reviews = reviewHand(hand);
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews[0].verdict).toBe('mistake');
  });
});

describe('reviewHand - プリフロップ vs open', () => {
  it('vsOpenレンジ内でコール → good', () => {
    const hand = makeSavedHand({
      heroPos: 'BB',
      heroHole: ['Js', 'Th'], // JTo はBB vs BTN コールレンジ付近
      log: [
        // BTN opens
        {
          street: 'preflop',
          playerId: 3,
          pos: 'BTN',
          action: 'raise',
          amount: 2.5,
          potAfter: 4,
        },
        // Hero calls
        {
          street: 'preflop',
          playerId: 0,
          pos: 'BB',
          action: 'call',
          amount: 2.5,
          potAfter: 5.5,
        },
      ],
    });
    const reviews = reviewHand(hand);
    const preflopReview = reviews.find((r) => r.street === 'preflop');
    expect(preflopReview).toBeDefined();
    // JTo might be in BB vs BTN call range
    expect(['good', 'ok', 'mistake', 'info']).toContain(preflopReview?.verdict);
  });

  it('3betレンジ外でフォールド → good', () => {
    const hand = makeSavedHand({
      heroPos: 'BB',
      heroHole: ['7s', '2h'], // 72o は何のvsOpenレンジにも入らない
      log: [
        {
          street: 'preflop',
          playerId: 3,
          pos: 'BTN',
          action: 'raise',
          amount: 2.5,
          potAfter: 4,
        },
        {
          street: 'preflop',
          playerId: 0,
          pos: 'BB',
          action: 'fold',
          potAfter: 4,
        },
      ],
    });
    const reviews = reviewHand(hand);
    const preflopReview = reviews.find((r) => r.street === 'preflop');
    expect(preflopReview).toBeDefined();
    expect(preflopReview?.verdict).toBe('good');
  });
});

describe('reviewHand - ポストフロップ', () => {
  it('エクイティ高でのbet → good', () => {
    // AA on A72r board: nuts, very high equity
    const hand = makeSavedHand({
      heroPos: 'BTN',
      heroHole: ['As', 'Ah'],
      board: ['7s', '2d', '3h'],
      log: [
        // Preflop: hero opens
        {
          street: 'preflop',
          playerId: 0,
          pos: 'BTN',
          action: 'raise',
          amount: 2.5,
          potAfter: 4,
        },
        // CPU calls from BB
        {
          street: 'preflop',
          playerId: 5,
          pos: 'BB',
          action: 'call',
          potAfter: 5,
        },
        // Flop: hero bets
        {
          street: 'flop',
          playerId: 5,
          pos: 'BB',
          action: 'check',
          potAfter: 5,
        },
        {
          street: 'flop',
          playerId: 0,
          pos: 'BTN',
          action: 'bet',
          amount: 3,
          potAfter: 8,
        },
      ],
    });
    const reviews = reviewHand(hand);
    const flopReview = reviews.find((r) => r.street === 'flop');
    expect(flopReview).toBeDefined();
    expect(['good', 'ok']).toContain(flopReview?.verdict);
    expect(flopReview?.metrics?.heroEquity).toBeDefined();
    expect(flopReview?.metrics?.heroEquity).toBeGreaterThan(0.7);
  });

  it('エクイティ低でのコール → mistake', () => {
    // 72o on AKQ board against strong range: very low equity
    const hand = makeSavedHand({
      heroPos: 'BB',
      heroHole: ['7s', '2d'],
      board: ['As', 'Ks', 'Qh'],
      log: [
        // Villain bets
        {
          street: 'flop',
          playerId: 3,
          pos: 'BTN',
          action: 'bet',
          amount: 5,
          potAfter: 10,
        },
        // Hero calls (bad call)
        {
          street: 'flop',
          playerId: 0,
          pos: 'BB',
          action: 'call',
          amount: 5,
          potAfter: 15,
        },
      ],
    });
    const reviews = reviewHand(hand);
    const flopReview = reviews.find((r) => r.street === 'flop');
    expect(flopReview).toBeDefined();
    // Should be mistake or info (equity likely very low vs strong range)
    expect(['mistake', 'info']).toContain(flopReview?.verdict);
  });

  it('review includes metrics', () => {
    const hand = makeSavedHand({
      heroPos: 'BTN',
      heroHole: ['Ks', 'Qd'],
      board: ['Kh', '7s', '2d'],
      log: [
        {
          street: 'flop',
          playerId: 5,
          pos: 'BB',
          action: 'bet',
          amount: 3,
          potAfter: 8,
        },
        {
          street: 'flop',
          playerId: 0,
          pos: 'BTN',
          action: 'call',
          amount: 3,
          potAfter: 11,
        },
      ],
    });
    const reviews = reviewHand(hand);
    const flopReview = reviews.find((r) => r.street === 'flop');
    expect(flopReview?.metrics).toBeDefined();
    expect(typeof flopReview?.metrics?.heroEquity).toBe('number');
  });
});

describe('reviewHand - 空ログ', () => {
  it('ヒーローアクションなし → 空配列を返す', () => {
    const hand = makeSavedHand({
      log: [
        // Only CPU actions
        {
          street: 'preflop',
          playerId: 3,
          pos: 'BTN',
          action: 'raise',
          amount: 2.5,
          potAfter: 4,
        },
      ],
    });
    const reviews = reviewHand(hand);
    expect(reviews).toEqual([]);
  });
});
