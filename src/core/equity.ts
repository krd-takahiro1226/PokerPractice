import { makeDeck, removeCards, type Card } from './cards';
import { evaluate7 } from './evaluator';
import type { HoleCards } from './handNotation';

export type PlayerEquity = {
  /** fraction of trials won outright */
  win: number;
  /** fraction of trials that were a split pot involving this player */
  tie: number;
  /** total equity share (win + split portions), 0..1 */
  equity: number;
};

export type EquityResult = {
  players: PlayerEquity[];
  iterations: number;
};

export type EquityProgress = (done: number, total: number) => void;

export function computeEquity(
  hands: HoleCards[],
  board: Card[],
  iterations: number,
  onProgress?: EquityProgress,
): EquityResult {
  const known: Card[] = [...hands.flat(), ...board];
  if (new Set(known).size !== known.length) {
    throw new Error('カードが重複しています');
  }

  const need = 5 - board.length;
  const working = removeCards(makeDeck(), known);
  const n = hands.length;

  const winShare = new Array(n).fill(0) as number[];
  const winCount = new Array(n).fill(0) as number[];
  const tieCount = new Array(n).fill(0) as number[];

  // Board already complete -> deterministic single evaluation.
  const trials = need === 0 ? 1 : iterations;
  const len = working.length;
  const progressStep = Math.max(1, Math.floor(trials / 20));

  for (let iter = 0; iter < trials; iter++) {
    // partial Fisher-Yates to sample `need` distinct cards
    for (let k = 0; k < need; k++) {
      const j = k + Math.floor(Math.random() * (len - k));
      const tmp = working[k];
      working[k] = working[j];
      working[j] = tmp;
    }

    let bestValue = -1;
    let winners: number[] = [];
    for (let i = 0; i < n; i++) {
      const seven: Card[] = [hands[i][0], hands[i][1], ...board];
      for (let k = 0; k < need; k++) seven.push(working[k]);
      const value = evaluate7(seven);
      if (value > bestValue) {
        bestValue = value;
        winners = [i];
      } else if (value === bestValue) {
        winners.push(i);
      }
    }

    const share = 1 / winners.length;
    for (const w of winners) winShare[w] += share;
    if (winners.length === 1) {
      winCount[winners[0]]++;
    } else {
      for (const w of winners) tieCount[w]++;
    }

    if (onProgress && iter % progressStep === 0) onProgress(iter, trials);
  }

  if (onProgress) onProgress(trials, trials);

  return {
    iterations: trials,
    players: winShare.map((share, i) => ({
      win: winCount[i] / trials,
      tie: tieCount[i] / trials,
      equity: share / trials,
    })),
  };
}
