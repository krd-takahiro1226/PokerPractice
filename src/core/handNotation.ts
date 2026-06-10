import { RANKS, SUITS, rankValue, type Card, type Rank } from './cards';

/** A starting-hand class such as 'AA', 'AKs', 'AKo'. 169 total. */
export type HandClass = string;

export type HoleCards = [Card, Card];

/**
 * 13x13 grid of hand classes.
 * Row index = higher rank (A at top), Col index = lower rank (A at left).
 * Diagonal = pairs, upper-right (row < col) = suited, lower-left (row > col) = offsuit.
 */
export const HAND_GRID: HandClass[][] = (() => {
  // Build from A down to 2 so AA is top-left.
  const order = [...RANKS].reverse(); // A, K, ..., 2
  const grid: HandClass[][] = [];
  for (let r = 0; r < 13; r++) {
    const row: HandClass[] = [];
    for (let c = 0; c < 13; c++) {
      const hi = order[r];
      const lo = order[c];
      if (r === c) {
        row.push(`${hi}${hi}`);
      } else if (r < c) {
        // higher rank is `hi` (smaller index in `order`), suited
        row.push(`${hi}${lo}s`);
      } else {
        // offsuit; ensure higher rank first
        row.push(`${lo}${hi}o`);
      }
    }
    grid.push(row);
  }
  return grid;
})();

export type HandShape = 'pair' | 'suited' | 'offsuit';

export function handShape(hand: HandClass): HandShape {
  if (hand.length === 2) return 'pair';
  return hand[2] === 's' ? 'suited' : 'offsuit';
}

/** Combos available before card removal: pair=6, suited=4, offsuit=12. */
export function comboCount(hand: HandClass): number {
  const shape = handShape(hand);
  if (shape === 'pair') return 6;
  return shape === 'suited' ? 4 : 12;
}

/** Normalize two concrete cards into a hand class like 'AKs'. */
export function cardsToHandClass(c1: Card, c2: Card): HandClass {
  const r1 = c1[0] as Rank;
  const r2 = c2[0] as Rank;
  const s1 = c1[1];
  const s2 = c2[1];
  if (r1 === r2) return `${r1}${r2}`;
  const [hi, lo] = rankValue(r1) > rankValue(r2) ? [r1, r2] : [r2, r1];
  return `${hi}${lo}${s1 === s2 ? 's' : 'o'}`;
}

/** Enumerate all concrete combos for a hand class. */
export function handClassToCombos(hand: HandClass): HoleCards[] {
  const shape = handShape(hand);
  const hi = hand[0] as Rank;
  const lo = hand[1] as Rank;
  const combos: HoleCards[] = [];

  if (shape === 'pair') {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        combos.push([`${hi}${SUITS[i]}`, `${hi}${SUITS[j]}`]);
      }
    }
  } else if (shape === 'suited') {
    for (const s of SUITS) {
      combos.push([`${hi}${s}`, `${lo}${s}`]);
    }
  } else {
    for (const s1 of SUITS) {
      for (const s2 of SUITS) {
        if (s1 === s2) continue;
        combos.push([`${hi}${s1}`, `${lo}${s2}`]);
      }
    }
  }
  return combos;
}

export const ALL_HAND_CLASSES: HandClass[] = HAND_GRID.flat();
