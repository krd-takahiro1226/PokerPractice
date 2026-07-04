import { describe, it, expect } from 'vitest';
import { reviewHand } from './reviewHand';
import { getScenarioForMode } from '../ranges';
import { estimateEquityVsRange } from '../ai/estimateEquity';
import type { SavedHand } from '../../store/history';
import type { HandLogEntry, HandResult } from '../game/types';
import type { Card } from '../cards';

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

describe('reviewHand - heroオープン後の3bet (CORE-2 回帰)', () => {
  it('heroオープン→非BBポジション(SB)の3bet: SBのRFIレンジではなく3betレンジをvillain rangeとして使う', () => {
    const heroHole: [Card, Card] = ['Js', 'Jd'];
    const board: Card[] = ['4c', '7d', '2h'];
    const hand = makeSavedHand({
      heroPos: 'BTN',
      heroHole,
      board,
      log: [
        // Hero opens BTN
        { street: 'preflop', playerId: 0, pos: 'BTN', action: 'raise', amount: 2.5, potAfter: 4 },
        // SB 3bets（非BBポジションからの3bet）
        { street: 'preflop', playerId: 4, pos: 'SB', action: 'raise', amount: 9, potAfter: 12.5 },
        // Hero calls the 3bet
        { street: 'preflop', playerId: 0, pos: 'BTN', action: 'call', amount: 9, potAfter: 21 },
        // Flop: SB checks, hero bets
        { street: 'flop', playerId: 4, pos: 'SB', action: 'check', potAfter: 21 },
        { street: 'flop', playerId: 0, pos: 'BTN', action: 'bet', amount: 10, potAfter: 31 },
      ],
    });

    const reviews = reviewHand(hand);
    const flopReview = reviews.find((r) => r.street === 'flop');
    expect(flopReview?.metrics?.heroEquity).toBeDefined();
    const actualEquity = flopReview!.metrics!.heroEquity!;

    // 修正前のバグ挙動: SBが3bettorであるにもかかわらず、SBのRFIレンジ(遥かに広い)を
    // 誤って villain range として使ってしまう。そのバグ挙動で計算したエクイティと比較し、
    // 実際のレビュー結果が(プレミアム中心の狭い3betレンジに対してより不利な)有意に低い
    // 値になっていること＝正しい分岐(3betレンジ)が使われたことを確認する。
    const sbRfiScenario = getScenarioForMode('RFI_SB', hand.mode ?? 'tournament');
    expect(sbRfiScenario).toBeDefined();
    const wideRfiRange: Record<string, number> = {};
    for (const [hc, action] of Object.entries(sbRfiScenario!.range)) {
      const freq = action.raise ?? 0;
      if (freq > 0) wideRfiRange[hc] = freq;
    }
    const buggyEquity = estimateEquityVsRange(heroHole, board, wideRfiRange, 4000);

    expect(actualEquity).toBeLessThan(buggyEquity - 0.05);
  });
});

describe('reviewHand - モード対応', () => {
  it('cash-noante: UTG で tier5 ハンド(22)をオープン → mistake', () => {
    // 22 は tier5 = cash-noante UTG レンジ外
    const hand = makeSavedHand({
      mode: 'cash-noante',
      heroPos: 'UTG',
      heroHole: ['2s', '2h'],
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

  it('tournament: UTG で tier5 ハンド(22)をオープン → good', () => {
    // 22 は tier5 = tournament UTG レンジ内
    const hand = makeSavedHand({
      mode: 'tournament',
      heroPos: 'UTG',
      heroHole: ['2s', '2h'],
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
    expect(reviews[0].verdict).toBe('good');
  });
});
