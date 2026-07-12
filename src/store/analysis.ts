import { create } from 'zustand';
import { ANALYZER_VERSION, type AnalyzedDecision } from '../core/solver';

type CacheEntry = { analyzerVersion: number; decisions: AnalyzedDecision[]; solvedTurn: boolean };

const MAX_ENTRIES = 50;

type AnalysisState = {
  /** 挿入順を保持する配列。Object.keys の順序保証（ES2015 以降の仕様）に依存しない。 */
  order: string[];
  results: Record<string, CacheEntry>;
  /** requireTurn=true の場合、solvedTurn も true のエントリのみ返す（未解析なら再実行させるため） */
  getAnalysis: (
    handId: string,
    requireTurn?: boolean,
  ) => { decisions: AnalyzedDecision[]; solvedTurn: boolean } | undefined;
  setAnalysis: (handId: string, decisions: AnalyzedDecision[], solvedTurn: boolean) => void;
};

export const useAnalysisStore = create<AnalysisState>()((set, get) => ({
  order: [],
  results: {},
  getAnalysis: (handId, requireTurn = false) => {
    const entry = get().results[handId];
    if (!entry || entry.analyzerVersion !== ANALYZER_VERSION) return undefined;
    if (requireTurn && !entry.solvedTurn) return undefined;
    return { decisions: entry.decisions, solvedTurn: entry.solvedTurn };
  },
  setAnalysis: (handId, decisions, solvedTurn) => {
    set((s) => {
      const isNewKey = !(handId in s.results);
      const results = { ...s.results, [handId]: { analyzerVersion: ANALYZER_VERSION, decisions, solvedTurn } };
      const order = isNewKey ? [...s.order, handId] : s.order;
      if (order.length <= MAX_ENTRIES) {
        return { results, order };
      }
      const evictCount = order.length - MAX_ENTRIES;
      const toEvict = order.slice(0, evictCount);
      const nextOrder = order.slice(evictCount);
      const nextResults = { ...results };
      for (const key of toEvict) delete nextResults[key];
      return { results: nextResults, order: nextOrder };
    });
  },
}));
