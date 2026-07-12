import { cardsToHandClass } from '../handNotation';
import { getEffectiveRange, rfiKey, vsOpenKey } from '../ranges/effective';
import { getSolverRange, solverRfiKey, solverVsOpenKey, squeezeKey, vs3betKey, vs4betKey } from '../ranges/solverSeries';
import type { Position, HandAction, Range } from '../ranges/types';
import type { DecisionSnapshot } from '../review/snapshot';
import {
  buildSpotQuery,
  preflopRaiseEntries,
  type ActionCandidate,
  type AnalyzeContext,
  type Confidence,
  type StrategyAdvice,
} from './types';

// プリフロップはチャート lookup のみ（§5.6）。ヒューリスティックは実装しない。
// lookup優先順: ソルバー系列（rangeOrigin='solver'）→ 既存 mode チャート（rangeOrigin='manual'）→ legacy。
// squeeze はソルバー系列ミス時のみ vsOpen チャートで近似（confidence降格 + explanationKey開示）。
// vs3bet/vs4bet はソルバー系列ミス時 legacy（データ未整備。§6）。

function candidatesFromHandAction(ha: HandAction | undefined, extraKeys: string[] = []): ActionCandidate[] {
  const raise = ha?.raise ?? 0;
  const call = ha?.call ?? 0;
  const fold = Math.max(0, 1 - raise - call);
  const out: ActionCandidate[] = [];
  if (raise > 0) out.push({ action: 'raise', frequency: raise, explanationKeys: ['preflop-chart-raise', ...extraKeys] });
  if (call > 0) out.push({ action: 'call', frequency: call, explanationKeys: ['preflop-chart-call', ...extraKeys] });
  if (fold > 1e-9) out.push({ action: 'fold', frequency: fold, explanationKeys: ['preflop-chart-fold', ...extraKeys] });
  return out.sort((a, b) => b.frequency - a.frequency);
}

/** range[handClass] から候補を作る。手が未収載/レンジ無しなら null（呼び出し側が次tierへフォールバック）。 */
function candidatesFrom(range: Range | undefined, handClass: string, extraKeys: string[] = []): ActionCandidate[] | null {
  if (!range) return null;
  const candidates = candidatesFromHandAction(range[handClass], extraKeys);
  return candidates.length > 0 ? candidates : null;
}

/** 実アクションを候補へマッチ（bet は raise と同一視、allin は raise 相当）。 */
function matchTaken(snapshot: DecisionSnapshot, candidates: ActionCandidate[]): ActionCandidate | null {
  const a = snapshot.taken.action;
  const target = a === 'bet' || a === 'allin' ? 'raise' : a;
  return candidates.find((c) => c.action === target) ?? null;
}

function legacyAdvice(snapshot: DecisionSnapshot, handClass: string, confidence: StrategyAdvice['confidence']): StrategyAdvice {
  return { spot: buildSpotQuery(snapshot, handClass), candidates: [], takenCandidate: null, confidence, source: 'legacy' };
}

function rangeTableAdvice(
  snapshot: DecisionSnapshot,
  handClass: string,
  candidates: ActionCandidate[],
  confidence: Confidence,
  rangeOrigin: 'solver' | 'manual',
): StrategyAdvice {
  return {
    spot: buildSpotQuery(snapshot, handClass),
    candidates,
    takenCandidate: matchTaken(snapshot, candidates),
    confidence,
    source: 'range-table',
    rangeOrigin,
  };
}

/** プリフロップ判断をチャートから解析する。データ外のラインは source='legacy'。 */
export function analyzePreflop(snapshot: DecisionSnapshot, ctx: AnalyzeContext): StrategyAdvice {
  const handClass = cardsToHandClass(ctx.heroHole[0], ctx.heroHole[1]);
  const heroPos = snapshot.actor.pos as Position;
  const heroId = snapshot.actor.playerId;
  // amount ベースで数える（オープンシュートは action='allin' でログされるため）
  const priorRaises = preflopRaiseEntries(snapshot);
  const baseConfidence: Confidence = snapshot.reliability === 'approx' ? 'medium' : 'high';

  // RFI: ヒーロー以前に誰もオープンしていない
  if (priorRaises.length === 0) {
    const solver = candidatesFrom(getSolverRange(solverRfiKey(heroPos))?.range, handClass, ['preflop-solver-chart']);
    if (solver) return rangeTableAdvice(snapshot, handClass, solver, baseConfidence, 'solver');
    const manual = candidatesFrom(getEffectiveRange(rfiKey(heroPos), ctx.mode, ctx.custom), handClass);
    if (manual) return rangeTableAdvice(snapshot, handClass, manual, baseConfidence, 'manual');
    return legacyAdvice(snapshot, handClass, 'low');
  }

  // 他者の単一オープンに直面（オープンシュートは通常サイズ前提のチャートが適用できないため除外）
  const facingSingleOpen =
    priorRaises.length === 1 && priorRaises[0].playerId !== heroId && priorRaises[0].action !== 'allin';

  if (facingSingleOpen) {
    const openerEntry = priorRaises[0];
    const openerPos = snapshot.context.openerPos ?? openerEntry.pos;
    const openerIdx = snapshot.actionHistory.indexOf(openerEntry);
    // squeeze: オープン以降ヒーローの判断までに、オープナー以外のプレイヤー（ヒーロー自身も除く）の call がある
    const squeezeCallers = snapshot.actionHistory.filter(
      (e, i) =>
        i > openerIdx &&
        e.street === 'preflop' &&
        e.action === 'call' &&
        e.playerId !== openerEntry.playerId &&
        e.playerId !== heroId,
    );

    if (squeezeCallers.length > 0) {
      const solver = candidatesFrom(getSolverRange(squeezeKey(openerPos, heroPos))?.range, handClass, ['preflop-solver-chart']);
      if (solver) return rangeTableAdvice(snapshot, handClass, solver, baseConfidence, 'solver');
      // 系列未整備: vsOpen チャートで近似（confidence は medium 上限、explanationKey で開示）
      const approx = candidatesFrom(getEffectiveRange(vsOpenKey(openerPos, heroPos), ctx.mode, ctx.custom), handClass, [
        'preflop-squeeze-approx',
      ]);
      if (approx) {
        const capped: Confidence = baseConfidence === 'high' ? 'medium' : baseConfidence;
        return rangeTableAdvice(snapshot, handClass, approx, capped, 'manual');
      }
      return legacyAdvice(snapshot, handClass, 'low');
    }

    // 通常の vsOpen
    const solver = candidatesFrom(getSolverRange(solverVsOpenKey(openerPos, heroPos))?.range, handClass, ['preflop-solver-chart']);
    if (solver) return rangeTableAdvice(snapshot, handClass, solver, baseConfidence, 'solver');
    const manual = candidatesFrom(getEffectiveRange(vsOpenKey(openerPos, heroPos), ctx.mode, ctx.custom), handClass);
    if (manual) return rangeTableAdvice(snapshot, handClass, manual, baseConfidence, 'manual');
    return legacyAdvice(snapshot, handClass, 'low');
  }

  // vs3bet: ヒーローが開いたポットに他者が3betしている（allinの3betは除外）
  const isVs3bet =
    priorRaises.length === 2 &&
    priorRaises[0].playerId === heroId &&
    priorRaises[1].playerId !== heroId &&
    priorRaises[1].action !== 'allin';
  if (isVs3bet) {
    const threebettorPos = priorRaises[1].pos;
    const solver = candidatesFrom(getSolverRange(vs3betKey(heroPos, threebettorPos))?.range, handClass, ['preflop-solver-chart']);
    if (solver) return rangeTableAdvice(snapshot, handClass, solver, baseConfidence, 'solver');
    return legacyAdvice(snapshot, handClass, 'low');
  }

  // vs4bet: ヒーローが3betしたポットに他者が4betしている（allinの4betは除外）
  const isVs4bet =
    priorRaises.length === 3 &&
    priorRaises[1].playerId === heroId &&
    priorRaises[2].playerId !== heroId &&
    priorRaises[2].action !== 'allin';
  if (isVs4bet) {
    const fourbettorPos = priorRaises[2].pos;
    const solver = candidatesFrom(getSolverRange(vs4betKey(heroPos, fourbettorPos))?.range, handClass, ['preflop-solver-chart']);
    if (solver) return rangeTableAdvice(snapshot, handClass, solver, baseConfidence, 'solver');
    return legacyAdvice(snapshot, handClass, 'low');
  }

  // それ以外の複雑ライン・limp等: データ未整備 → legacy（§5.6, §6）
  return legacyAdvice(snapshot, handClass, 'low');
}
