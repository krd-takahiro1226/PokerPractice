import { RANKS, type Rank } from '../cards';
import { ALL_HAND_CLASSES, comboCount, type HandClass } from '../handNotation';
import type { Range } from './types';

function rv(rank: string): number {
  return RANKS.indexOf(rank as Rank);
}

/** Expand a single token (e.g. '22+', 'ATs+', 'A5s-A4s', 'T9s') into hand classes. */
export function expandToken(token: string): HandClass[] {
  const t = token.trim();

  if (t.includes('-')) {
    const [a, b] = t.split('-');
    return expandDashRange(a, b);
  }

  if (t.endsWith('+')) {
    return expandPlus(t.slice(0, -1));
  }

  return [t];
}

function isPair(token: string): boolean {
  return token.length === 2 && token[0] === token[1];
}

function expandPlus(base: string): HandClass[] {
  if (isPair(base)) {
    const start = rv(base[0]);
    const out: HandClass[] = [];
    for (let r = start; r <= 12; r++) {
      out.push(`${RANKS[r]}${RANKS[r]}`);
    }
    return out;
  }
  // suited/offsuit: fix high card, vary kicker upward up to (high - 1)
  const hi = base[0];
  const lo = base[1];
  const suffix = base[2]; // 's' | 'o'
  const hiVal = rv(hi);
  const out: HandClass[] = [];
  for (let k = rv(lo); k < hiVal; k++) {
    out.push(`${hi}${RANKS[k]}${suffix}`);
  }
  return out;
}

function expandDashRange(a: string, b: string): HandClass[] {
  if (isPair(a) && isPair(b)) {
    const lo = Math.min(rv(a[0]), rv(b[0]));
    const hi = Math.max(rv(a[0]), rv(b[0]));
    const out: HandClass[] = [];
    for (let r = lo; r <= hi; r++) out.push(`${RANKS[r]}${RANKS[r]}`);
    return out;
  }
  // suited/offsuit range, e.g. A5s-A2s: same high card + suffix, kicker range
  const hi = a[0];
  const suffix = a[2];
  const k1 = rv(a[1]);
  const k2 = rv(b[1]);
  const lo = Math.min(k1, k2);
  const high = Math.max(k1, k2);
  const out: HandClass[] = [];
  for (let k = lo; k <= high; k++) out.push(`${hi}${RANKS[k]}${suffix}`);
  return out;
}

/** Build a pure-raise Range from human-readable tokens. */
export function tokensToRange(tokens: string[]): Range {
  const range: Range = {};
  for (const token of tokens) {
    for (const hand of expandToken(token)) {
      range[hand] = { raise: 1 };
    }
  }
  return range;
}

/**
 * call/raiseを分けてRangeを構築する。重複時はraise優先。
 * callトークンは {call:1}、raiseトークンは {raise:1} として設定。
 */
export function tokensToRangeWithActions(spec: { call?: string[]; raise?: string[] }): Range {
  const range: Range = {};
  for (const token of spec.call ?? []) {
    for (const hand of expandToken(token)) {
      if (!range[hand]) range[hand] = { call: 1 };
    }
  }
  // raiseは上書き（raise優先）
  for (const token of spec.raise ?? []) {
    for (const hand of expandToken(token)) {
      range[hand] = { raise: 1 };
    }
  }
  return range;
}

/** Fraction (0..1) of all 1326 combos that take a non-fold action. */
export function openPercent(range: Range): number {
  let played = 0;
  for (const hand of ALL_HAND_CLASSES) {
    const a = range[hand];
    if (!a) continue;
    const freq = (a.raise ?? 0) + (a.call ?? 0);
    if (freq > 0) played += comboCount(hand) * Math.min(1, freq);
  }
  return played / 1326;
}
