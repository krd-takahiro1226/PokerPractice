import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedHand } from '../store/history';
import type { CustomRanges } from '../core/ranges/effective';
import type { AnalyzedDecision } from '../core/solver';
import { useAnalysisStore } from '../store/analysis';
import type { SolverRequest, SolverResponse } from '../workers/solver.worker';

export type AnalysisRunner = (
  hand: SavedHand,
  custom: CustomRanges | undefined,
  solveTurn: boolean,
  onProgress: (done: number, total: number) => void,
) => Promise<AnalyzedDecision[]>;

export type HandAnalysisState = {
  status: 'loading' | 'done' | 'cached' | 'failed';
  progress: number;
  decisions: AnalyzedDecision[] | null;
  error: string | null;
  /** キャッシュヒット時はキャッシュのフラグ、今回実行時は opts.solveTurn の値をそのまま反映 */
  turnSolved: boolean;
  retry: () => void;
};

type AnalysisSnapshot = Omit<HandAnalysisState, 'retry'>;

export type AnalysisDeps = {
  getCached: (
    handId: string,
    requireTurn: boolean,
  ) => { decisions: AnalyzedDecision[]; solvedTurn: boolean } | undefined;
  setCached: (handId: string, decisions: AnalyzedDecision[], solvedTurn: boolean) => void;
  runner: AnalysisRunner;
};

/** React 非依存の状態遷移ロジック。cache hit なら即 cached、miss なら runner を実行し
 *  loading → done/failed へ遷移する。hook 側からも単体テストからも呼べる純粋な非同期関数。
 *  solveTurn=true の要求時はキャッシュも solvedTurn=true のもののみヒットとみなす
 *  （river のみキャッシュ済み → solveTurn 要求時は再実行させるため）。 */
export async function performAnalysis(
  hand: SavedHand,
  custom: CustomRanges | undefined,
  solveTurn: boolean,
  deps: AnalysisDeps,
  onUpdate: (snapshot: AnalysisSnapshot) => void,
): Promise<void> {
  const cached = deps.getCached(hand.id, solveTurn);
  if (cached) {
    // turnSolved は要求値でなくキャッシュの実績を反映する（turn 済みキャッシュを solveTurn=false で開いた場合に true）
    onUpdate({ status: 'cached', progress: 1, decisions: cached.decisions, error: null, turnSolved: cached.solvedTurn });
    return;
  }
  onUpdate({ status: 'loading', progress: 0, decisions: null, error: null, turnSolved: solveTurn });
  try {
    const decisions = await deps.runner(hand, custom, solveTurn, (done, total) => {
      onUpdate({
        status: 'loading',
        progress: total === 0 ? 1 : done / total,
        decisions: null,
        error: null,
        turnSolved: solveTurn,
      });
    });
    deps.setCached(hand.id, decisions, solveTurn);
    onUpdate({ status: 'done', progress: 1, decisions, error: null, turnSolved: solveTurn });
  } catch (err) {
    onUpdate({
      status: 'failed',
      progress: 0,
      decisions: null,
      error: err instanceof Error ? err.message : '解析に失敗しました',
      turnSolved: solveTurn,
    });
  }
}

let requestSeq = 0;

/** solver.worker.ts を都度生成して実行する既定 runner。生成した Worker は
 *  workerRef に記録し、hook 側の unmount クリーンアップで確実に terminate できるようにする。 */
function createDefaultRunner(workerRef: { current: Worker | null }): AnalysisRunner {
  return (hand, custom, solveTurn, onProgress) =>
    new Promise<AnalyzedDecision[]>((resolve, reject) => {
      const worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const id = String(++requestSeq);
      const cleanup = () => {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };
      worker.onmessage = (e: MessageEvent<SolverResponse>) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.type === 'progress') {
          onProgress(msg.done, msg.total);
        } else if (msg.type === 'done') {
          resolve(msg.result);
          cleanup();
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
          cleanup();
        }
      };
      worker.postMessage({ id, hand, custom, solveTurn } satisfies SolverRequest);
    });
}

export function useHandAnalysis(
  hand: SavedHand,
  custom?: CustomRanges,
  opts?: { solveTurn?: boolean },
  runner?: AnalysisRunner,
): HandAnalysisState {
  const workerRef = useRef<Worker | null>(null);
  const defaultRunner = useMemo(() => createDefaultRunner(workerRef), []);
  const activeRunner = runner ?? defaultRunner;
  const solveTurn = opts?.solveTurn ?? false;

  const [snapshot, setSnapshot] = useState<AnalysisSnapshot>({
    status: 'loading',
    progress: 0,
    decisions: null,
    error: null,
    turnSolved: solveTurn,
  });
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  const start = useCallback(() => {
    const myRunId = ++runIdRef.current;
    const deps: AnalysisDeps = {
      getCached: (id, requireTurn) => useAnalysisStore.getState().getAnalysis(id, requireTurn),
      setCached: (id, decisions, solvedTurn) => useAnalysisStore.getState().setAnalysis(id, decisions, solvedTurn),
      runner: activeRunner,
    };
    void performAnalysis(hand, custom, solveTurn, deps, (next) => {
      if (mountedRef.current && runIdRef.current === myRunId) setSnapshot(next);
    });
    // hand/custom は hand.id 変化時に effect 側で拾うため、意図的に依存から絞る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand, custom, activeRunner, solveTurn]);

  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.id, opts?.solveTurn]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { ...snapshot, retry: start };
}
