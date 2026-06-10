import { describe, it, expect } from 'vitest';
import { evaluate7, handCategory, CATEGORY } from './evaluator';
import type { Card } from './cards';

const h = (...cards: string[]) => evaluate7(cards as Card[]);

describe('evaluate7 categories', () => {
  it('detects each category', () => {
    expect(handCategory(h('As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3h'))).toBe(CATEGORY.STRAIGHT_FLUSH);
    expect(handCategory(h('As', 'Ad', 'Ah', 'Ac', 'Ks', '2d', '3h'))).toBe(CATEGORY.QUADS);
    expect(handCategory(h('As', 'Ad', 'Ah', 'Ks', 'Kd', '2c', '3h'))).toBe(CATEGORY.FULL_HOUSE);
    expect(handCategory(h('As', 'Js', '9s', '5s', '2s', 'Kd', '3h'))).toBe(CATEGORY.FLUSH);
    expect(handCategory(h('As', 'Kd', 'Qh', 'Jc', 'Ts', '2s', '3h'))).toBe(CATEGORY.STRAIGHT);
    expect(handCategory(h('As', 'Ad', 'Ah', 'Kd', 'Qc', '2s', '3h'))).toBe(CATEGORY.TRIPS);
    expect(handCategory(h('As', 'Ad', 'Kh', 'Kc', 'Qs', '2d', '3h'))).toBe(CATEGORY.TWO_PAIR);
    expect(handCategory(h('As', 'Ad', 'Kh', 'Qc', 'Js', '2d', '3h'))).toBe(CATEGORY.PAIR);
    expect(handCategory(h('As', 'Kd', 'Qh', 'Jc', '9s', '2d', '3h'))).toBe(CATEGORY.HIGH_CARD);
  });

  it('detects the wheel straight (A-2-3-4-5)', () => {
    expect(handCategory(h('Ah', '2d', '3c', '4s', '5h', 'Kd', '9c'))).toBe(CATEGORY.STRAIGHT);
  });

  it('orders categories correctly', () => {
    const royal = h('As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3h');
    const quads = h('As', 'Ad', 'Ah', 'Ac', 'Ks', '2d', '3h');
    const full = h('As', 'Ad', 'Ah', 'Ks', 'Kd', '2c', '3h');
    const flush = h('As', 'Js', '9s', '5s', '2s', 'Kd', '3h');
    const straight = h('As', 'Kd', 'Qh', 'Jc', 'Ts', '2s', '3h');
    const trips = h('As', 'Ad', 'Ah', 'Kd', 'Qc', '2s', '3h');
    const twoPair = h('As', 'Ad', 'Kh', 'Kc', 'Qs', '2d', '3h');
    const pair = h('As', 'Ad', 'Kh', 'Qc', 'Js', '2d', '3h');
    const high = h('As', 'Kd', 'Qh', 'Jc', '9s', '2d', '3h');
    expect(royal).toBeGreaterThan(quads);
    expect(quads).toBeGreaterThan(full);
    expect(full).toBeGreaterThan(flush);
    expect(flush).toBeGreaterThan(straight);
    expect(straight).toBeGreaterThan(trips);
    expect(trips).toBeGreaterThan(twoPair);
    expect(twoPair).toBeGreaterThan(pair);
    expect(pair).toBeGreaterThan(high);
  });
});

describe('evaluate7 tiebreaks', () => {
  it('higher straight beats the wheel', () => {
    const broadway = h('As', 'Kd', 'Qh', 'Jc', 'Ts', '2s', '3h');
    const wheel = h('Ah', '2d', '3c', '4s', '5h', 'Kd', '9c');
    expect(broadway).toBeGreaterThan(wheel);
  });

  it('compares kickers on a pair', () => {
    const aceKing = h('As', 'Ad', 'Kh', '7c', '4s', '2d', '3h');
    const aceQueen = h('As', 'Ad', 'Qh', '7c', '4s', '2d', '5h');
    expect(aceKing).toBeGreaterThan(aceQueen);
  });

  it('compares flush high cards', () => {
    const aceHigh = h('As', 'Js', '9s', '5s', '2s', 'Kd', '3h');
    const kingHigh = h('Ks', 'Js', '9s', '5s', '2s', 'Ad', '3h');
    expect(aceHigh).toBeGreaterThan(kingHigh);
  });

  it('ranks a 6-high straight flush over the wheel straight flush', () => {
    const six = h('6s', '5s', '4s', '3s', '2s', 'Ad', 'Kh');
    const wheel = h('As', '2s', '3s', '4s', '5s', 'Kd', 'Qh');
    expect(six).toBeGreaterThan(wheel);
  });

  it('picks the best five of seven for a flush', () => {
    // six spades; best flush is A-K-Q-J-9
    const v = h('As', 'Ks', 'Qs', 'Js', '9s', '2s', '3h');
    expect(handCategory(v)).toBe(CATEGORY.FLUSH);
  });
});
