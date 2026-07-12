import type { SavedHand } from '../store/history';
import type { CustomRanges } from '../core/ranges/effective';
import { buildSnapshots } from '../core/review/snapshot';
import {
  ANALYZER_VERSION,
  analyzeHand,
  preloadPresolve,
  setPresolveFetcher,
  type AnalyzedDecision,
} from '../core/solver';

export type SolverRequest = { id: string; hand: SavedHand; custom?: CustomRanges; solveTurn?: boolean };
export type SolverResponse =
  | { id: string; type: 'progress'; done: number; total: number }
  | { id: string; type: 'done'; result: AnalyzedDecision[]; analyzerVersion: number }
  | { id: string; type: 'error'; message: string };

const ctx = self as unknown as Worker;

// プリソルブDBは同一オリジンの静的アセット（/presolve/…）のみ参照する。Supabase 無関係で
// ゲストモードでも常に動く。404・ネットワーク断は null → presolve 側で negative キャッシュ。
setPresolveFetcher(async (path) => {
  const res = await fetch(`/presolve/${path}`);
  if (!res.ok) return null;
  return res.json();
});

ctx.onmessage = async (e: MessageEvent<SolverRequest>) => {
  const { id, hand, custom, solveTurn } = e.data;
  try {
    // preload 用の snapshot 構築は analyzeHand 内と二重になるが軽量（会計リプレイのみ）で許容
    try {
      await preloadPresolve(buildSnapshots(hand));
    } catch {
      // プリソルブはオプショナルな付加情報。ロード失敗でも解析本体は続行する
    }
    const result = analyzeHand(hand, custom, {
      solveTurn,
      onProgress: (done, total) => ctx.postMessage({ id, type: 'progress', done, total } satisfies SolverResponse),
    });
    ctx.postMessage({ id, type: 'done', result, analyzerVersion: ANALYZER_VERSION } satisfies SolverResponse);
  } catch (err) {
    ctx.postMessage({
      id,
      type: 'error',
      message: err instanceof Error ? err.message : '解析エラー',
    } satisfies SolverResponse);
  }
};
