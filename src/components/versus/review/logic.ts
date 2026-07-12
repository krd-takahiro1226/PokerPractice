import type { AnalyzedDecision, StrategyAdvice } from '../../../core/solver';
import type { DecisionVerdict } from '../../../core/review/reviewHand';
import type { Street } from '../../../core/game/types';

export type { DecisionVerdict };

// verdict 閾値（docs/SOLVER-REVIEW-DESIGN.md §3.5）
const GOOD_FREQUENCY_MIN = 0.6;
const OK_FREQUENCY_MIN = 0.2;
const GOOD_EV_LOSS_MAX = 0.15;
const OK_EV_LOSS_MAX = 0.75;

function verdictFromFreqAndEvLoss(frequency: number, evLossBB?: number): DecisionVerdict {
  const goodByFreq = frequency >= GOOD_FREQUENCY_MIN;
  const goodByEv = evLossBB !== undefined && evLossBB <= GOOD_EV_LOSS_MAX;
  if (goodByFreq || goodByEv) return 'good';

  const okByFreq = frequency >= OK_FREQUENCY_MIN;
  const okByEv = evLossBB !== undefined && evLossBB <= OK_EV_LOSS_MAX;
  if (okByFreq || okByEv) return 'ok';

  // frequency < 0.2 かつ (evLossBB > 0.75 または未定義)
  return 'mistake';
}

/** takenCandidate が候補外(null)の場合: frequency が無いので evLossBB のみで判定。
 *  evLossBB も無ければ不確実なため誤ってミス表示しないよう 'ok' を返す。 */
function verdictForNullTaken(evLossBB?: number): DecisionVerdict {
  if (evLossBB === undefined) return 'ok';
  if (evLossBB <= GOOD_EV_LOSS_MAX) return 'good';
  if (evLossBB <= OK_EV_LOSS_MAX) return 'ok';
  return 'mistake';
}

export function verdictOfAdvice(advice: StrategyAdvice): DecisionVerdict {
  if (advice.source === 'legacy' || advice.candidates.length === 0) return 'info';
  if (advice.takenCandidate === null) return verdictForNullTaken(advice.evLossBB);
  return verdictFromFreqAndEvLoss(advice.takenCandidate.frequency, advice.evLossBB);
}

export type AnalysisSummary = {
  counts: Record<DecisionVerdict, number>;
  totalEvLossBB: number;
  worst: { logIndex: number; street: Street; evLossBB: number } | null;
};

/** source='legacy' の判断は集計対象外（GTO非対応スポットのため）。 */
export function summarizeAnalysis(decisions: AnalyzedDecision[]): AnalysisSummary {
  const counts: Record<DecisionVerdict, number> = { good: 0, ok: 0, mistake: 0, info: 0 };
  let totalEvLossBB = 0;
  let worst: AnalysisSummary['worst'] = null;

  for (const { snapshot, advice } of decisions) {
    if (advice.source === 'legacy') continue;
    const verdict = verdictOfAdvice(advice);
    counts[verdict] += 1;
    if (advice.evLossBB !== undefined) {
      totalEvLossBB += advice.evLossBB;
      if (verdict === 'mistake' && (!worst || advice.evLossBB > worst.evLossBB)) {
        worst = { logIndex: snapshot.logIndex, street: snapshot.street, evLossBB: advice.evLossBB };
      }
    }
  }

  return { counts, totalEvLossBB, worst };
}

const SOURCE_CHIP_LABEL: Record<StrategyAdvice['source'], string> = {
  'cfr-exact': 'GTO解',
  'range-table': 'レンジ表', // rangeOrigin==='solver' のときは下で上書き
  presolve: 'GTOプリソルブ',
  legacy: '参考',
};

export function sourceChipLabel(advice: StrategyAdvice): string {
  if (advice.source === 'range-table' && advice.rangeOrigin === 'solver') return 'GTOレンジ';
  return SOURCE_CHIP_LABEL[advice.source];
}
