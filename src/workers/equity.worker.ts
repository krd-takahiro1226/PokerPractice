import { computeEquity } from '../core/equity';
import type { Card } from '../core/cards';
import type { HoleCards } from '../core/handNotation';

export type EquityRequest = {
  id: string;
  hands: string[][];
  board: string[];
  iterations: number;
};

export type EquityResponse =
  | { id: string; type: 'progress'; done: number; total: number }
  | { id: string; type: 'done'; result: ReturnType<typeof computeEquity> }
  | { id: string; type: 'error'; message: string };

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<EquityRequest>) => {
  const { id, hands, board, iterations } = e.data;
  try {
    const result = computeEquity(
      hands as HoleCards[],
      board as Card[],
      iterations,
      (done, total) => ctx.postMessage({ id, type: 'progress', done, total } satisfies EquityResponse),
    );
    ctx.postMessage({ id, type: 'done', result } satisfies EquityResponse);
  } catch (err) {
    ctx.postMessage({
      id,
      type: 'error',
      message: err instanceof Error ? err.message : '計算エラー',
    } satisfies EquityResponse);
  }
};
