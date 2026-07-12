import { cardsToHandClass } from '../handNotation';
import { buildSnapshots, type DecisionSnapshot } from '../review/snapshot';
import type { SavedHand } from '../../store/history';
import type { CustomRanges } from '../ranges/effective';
import { analyzePreflop } from './preflop';
import { solveRiverSnapshot } from './cfr/river';
import { solveTurnSnapshot } from './cfr/turn';
import { lookupPresolve } from './presolve';
import { buildSpotQuery, type AnalyzeContext, type StrategyAdvice } from './types';

export * from './types';
export { preloadPresolve, setPresolveFetcher, type PresolveFetcher } from './presolve';

/** 解析結果キャッシュ（store/analysis.ts）の世代キー。ロジック変更時に上げる。 */
export const ANALYZER_VERSION = 1;

/** ポストフロップ・マルチウェイ等、GTO解析がまだ差し込まれていないスポットの既定応答。
 *  表示層は source='legacy' を見て既存 reviewHand（凍結ロジック）で参考表示する（§6）。 */
function legacyAdvice(snapshot: DecisionSnapshot, handClass: string): StrategyAdvice {
  return {
    spot: buildSpotQuery(snapshot, handClass),
    candidates: [],
    takenCandidate: null,
    confidence: 'low',
    source: 'legacy',
  };
}

export type AnalyzeOptions = {
  /** false で river CFR を回さない（UI の同期経路用。Worker 経由の解析は既定の true） */
  solveRiver?: boolean;
  /** true で HU turn の CFR（turn+river サブゲーム）を回す。既定 false（重いため明示オプトイン） */
  solveTurn?: boolean;
  onProgress?: (done: number, total: number) => void;
};

/** 1判断の解析。スポットを source へ振り分ける（§5.1）。
 *  preflop → チャート / HU river → CFR 厳密解（L1）/
 *  HU turn → cfr（Phase 5, solveTurn オプトイン時）/
 *  HU flop → presolve（Phase 7。preloadPresolve 済みキャッシュのみ参照、ミスは legacy）/
 *  multiway → legacy（GTO非対応・参考表示）。 */
export function analyzeSnapshot(
  snapshot: DecisionSnapshot,
  ctx: AnalyzeContext,
  options: AnalyzeOptions = {},
  onIteration?: (iteration: number, maxIterations: number) => void,
): StrategyAdvice {
  if (snapshot.street === 'preflop') {
    return analyzePreflop(snapshot, ctx);
  }
  if (options.solveTurn && snapshot.street === 'turn' && !snapshot.context.isMultiway) {
    // 収束失敗・レンジ仮定破綻・想定外の状態は「GTO解」を出さず legacy へ（§5.2, §6）
    try {
      const advice = solveTurnSnapshot(snapshot, ctx, onIteration);
      if (advice) return advice;
    } catch {
      // 解析は表示のための付加情報であり、ハンドレビュー全体を落とさない
    }
  }
  if (options.solveRiver !== false && snapshot.street === 'river' && !snapshot.context.isMultiway) {
    // 収束失敗・レンジ仮定破綻・想定外の状態は「GTO解」を出さず legacy へ（§5.2, §6）
    try {
      const advice = solveRiverSnapshot(snapshot, ctx);
      if (advice) return advice;
    } catch {
      // 解析は表示のための付加情報であり、ハンドレビュー全体を落とさない
    }
  }
  if (snapshot.street === 'flop' && !snapshot.context.isMultiway) {
    try {
      const advice = lookupPresolve(snapshot, ctx);
      if (advice) return advice;
    } catch {
      // DB データ不整合等でもレビュー全体を落とさない（legacy へ）
    }
  }
  const handClass = cardsToHandClass(ctx.heroHole[0], ctx.heroHole[1]);
  return legacyAdvice(snapshot, handClass);
}

export type AnalyzedDecision = {
  snapshot: DecisionSnapshot;
  advice: StrategyAdvice;
};

/** SavedHand の全ヒーロー判断を解析する。復元（buildSnapshots）＋各判断の source 振り分け。 */
export function analyzeHand(
  hand: SavedHand,
  custom?: CustomRanges,
  options: AnalyzeOptions = {},
): AnalyzedDecision[] {
  const ctx: AnalyzeContext = {
    heroHole: hand.heroHole,
    mode: hand.mode ?? 'tournament',
    custom,
  };
  const snapshots = buildSnapshots(hand);
  const total = snapshots.length;
  const result: AnalyzedDecision[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const advice = analyzeSnapshot(snapshot, ctx, options, (it, max) => options.onProgress?.(i + it / max, total));
    result.push({ snapshot, advice });
    options.onProgress?.(i + 1, total);
  }
  return result;
}
