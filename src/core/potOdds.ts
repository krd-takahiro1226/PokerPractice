/** Required equity to call: amount to call / (pot after call). Returns 0..1. */
export function potOdds(pot: number, toCall: number): number {
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}

/**
 * Minimum Defense Frequency.
 * The minimum fraction of a calling range that must continue to prevent
 * opponent from profiting with any two cards.
 * MDF = pot / (pot + bet). Returns 0..1.
 */
export function mdf(pot: number, bet: number): number {
  if (bet <= 0) return 1;
  return pot / (pot + bet);
}

/**
 * Exact probability of improving with `outs` cards, given cards still to come.
 * cardsToCome: 2 = on the flop (turn+river), 1 = on the turn (river only).
 */
export function equityFromOuts(outs: number, cardsToCome: 1 | 2): number {
  if (cardsToCome === 1) {
    return outs / 46;
  }
  // flop: 47 unseen, river: 46 unseen
  const missTurn = (47 - outs) / 47;
  const missRiver = (46 - outs) / 46;
  return 1 - missTurn * missRiver;
}

/** "Rule of 2 and 4" approximation, returns 0..1. */
export function ruleOfThumb(outs: number, cardsToCome: 1 | 2): number {
  return (cardsToCome === 2 ? outs * 4 : outs * 2) / 100;
}

export type DrawType = {
  id: string;
  label: string;
  outs: number;
};

/** Common draws and their out counts, for drill generation and reference. */
export const DRAW_TYPES: DrawType[] = [
  { id: 'gutshot', label: 'ガットショット (インサイドストレート)', outs: 4 },
  { id: 'two-overcards', label: 'オーバーカード2枚', outs: 6 },
  { id: 'oesd', label: 'オープンエンドストレート', outs: 8 },
  { id: 'flush', label: 'フラッシュドロー', outs: 9 },
  { id: 'fd-gutshot', label: 'フラッシュドロー + ガットショット', outs: 12 },
  { id: 'fd-oesd', label: 'フラッシュドロー + ストレートドロー', outs: 15 },
];

// ─── Required-equity drill ───────────────────────────────────────────────────

export type ReqEquityDrill = {
  pot: number;
  bet: number;
  answer: number;
  choices: number[];
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Two values are considered the same if they round to the same thousandth. */
function sameThousandth(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000);
}

function isUnique(val: number, seen: number[]): boolean {
  return seen.every((v) => !sameThousandth(v, val));
}

/** Fill `result` to 4 items with deterministic offsets from `base`. */
function fillWithOffsets(result: number[], base: number): void {
  // Try systematic offsets until we have 4 distinct values
  const steps = [5, 8, 12, 15, 20, 25, 3, 18, 30, 35];
  for (const step of steps) {
    if (result.length >= 4) break;
    for (const sign of [1, -1]) {
      if (result.length >= 4) break;
      const candidate = clamp01(base + sign * step / 100);
      if (isUnique(candidate, result)) result.push(candidate);
    }
  }
}

/**
 * Generate 4 answer choices for the required-equity drill including `answer`.
 * Distractors are based on common arithmetic mistakes.
 */
export function reqEquityChoices(pot: number, bet: number, _rng?: () => number): number[] {
  const answer = potOdds(pot, bet);

  const candidates: number[] = [
    clamp01(bet / pot),                   // bet ÷ pot (misses denominator)
    clamp01(pot / (pot + 2 * bet)),        // pot/(pot+2*bet) — pot and bet transposed
    clamp01(bet / (pot + bet * 2)),        // bet/(pot+2*bet)
  ];

  const result: number[] = [answer];
  for (const c of candidates) {
    if (result.length < 4 && isUnique(c, result)) result.push(c);
  }

  fillWithOffsets(result, answer);

  // Deterministic Fisher-Yates shuffle seeded by answer value
  // (rng param kept for API compatibility but not needed for determinism guarantee)
  const seed = Math.round(answer * 10000);
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

export function genReqEquityDrill(rng?: () => number): ReqEquityDrill {
  const r = rng ?? Math.random;

  const pot = (Math.floor(r() * 27) + 4) * 10; // 40..300

  let bet: number;
  if (r() < 0.5) {
    // Ratio-derived bet (easy, round numbers)
    const ratios = [1 / 3, 1 / 2, 2 / 3, 1, 2] as const;
    const ratio = ratios[Math.floor(r() * ratios.length)];
    bet = Math.max(10, Math.round((pot * ratio) / 10) * 10);
  } else {
    // Independent random bet (harder)
    bet = (Math.floor(r() * 20) + 1) * 10; // 10..200
  }

  const answer = potOdds(pot, bet);
  const choices = reqEquityChoices(pot, bet, r);

  return { pot, bet, answer, choices };
}

// ─── MDF drill ───────────────────────────────────────────────────────────────

export type MdfDrill = {
  pot: number;
  bet: number;
  answer: number;
  choices: number[];
};

/** Distractors for MDF. Typical mistakes: confuse MDF with pot-odds or invert. */
export function mdfChoices(pot: number, bet: number, _rng?: () => number): number[] {
  const answer = mdf(pot, bet);

  const candidates: number[] = [
    clamp01(bet / (pot + bet)),     // 1 - MDF (most common mistake: pot-odds confusion)
    clamp01(bet / pot),             // bet ÷ pot
    clamp01(pot / (pot + 2 * bet)), // pot/(pot+2*bet)
  ];

  const result: number[] = [answer];
  for (const c of candidates) {
    if (result.length < 4 && isUnique(c, result)) result.push(c);
  }

  fillWithOffsets(result, answer);

  const seed = Math.round(answer * 10000);
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/** Representative bet-size ratios for MDF drill (matches the reference table). */
const MDF_RATIOS = [1 / 3, 1 / 2, 2 / 3, 1, 2] as const;

export function genMdfDrill(rng?: () => number): MdfDrill {
  const r = rng ?? Math.random;

  const pot = (Math.floor(r() * 20) + 4) * 10; // 40..230
  const ratio = MDF_RATIOS[Math.floor(r() * MDF_RATIOS.length)];
  const bet = Math.max(10, Math.round((pot * ratio) / 10) * 10);

  const answer = mdf(pot, bet);
  const choices = mdfChoices(pot, bet, r);

  return { pot, bet, answer, choices };
}
