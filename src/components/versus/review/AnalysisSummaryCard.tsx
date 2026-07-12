import { Panel } from '../../Panel';
import { cn } from '../../../lib/cn';
import type { AnalysisSummary } from './logic';

const STREET_LABEL: Record<string, string> = {
  preflop: 'プリフロップ',
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
};

function scrollToDecision(logIndex: number): void {
  document
    .getElementById(`review-decision-${logIndex}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** ハンド全体の GTO 解析サマリー（docs/SOLVER-REVIEW-DESIGN.md §4.1）。 */
export function AnalysisSummaryCard({ summary }: { summary: AnalysisSummary }) {
  const { counts, totalEvLossBB, worst } = summary;

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold text-text">総合:</span>
        <span className="text-emerald-400">good {counts.good}</span>
        <span className="text-cyan-400">ok {counts.ok}</span>
        <span className="text-rose-400">mistake {counts.mistake}</span>
      </div>
      <div className="mt-1 text-xs text-muted">
        EVロス合計: <span className="font-semibold text-text">-{totalEvLossBB.toFixed(1)}bb</span>
        <span className="ml-1">（GTO解対象の判断のみ）</span>
      </div>
      {worst && (
        <button
          onClick={() => scrollToDecision(worst.logIndex)}
          className={cn(
            'mt-2 flex w-full items-center justify-between rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-left text-xs text-rose-300 transition hover:bg-rose-500/20',
          )}
        >
          <span>
            重要ミス: {STREET_LABEL[worst.street] ?? worst.street}
          </span>
          <span className="font-semibold">-{worst.evLossBB.toFixed(1)}bb</span>
        </button>
      )}
    </Panel>
  );
}
