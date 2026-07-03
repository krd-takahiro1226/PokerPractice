import { Crown } from 'lucide-react';
import { Panel } from '../Panel';
import { useDisplayPrefs } from '../../store/displayPrefs';
import { formatAmount } from '../../lib/chips';
import { standings } from '../../core/online/tournament';
import type { TournamentState } from '../../core/online/tournament';
import { MultiLineChart } from '../charts/MultiLineChart';

type OnlineResultsProps = {
  tournament: TournamentState;
  onLeave: () => void;
};

export function OnlineResults({ tournament, onLeave }: OnlineResultsProps) {
  const ranked = standings(tournament);
  const chipDisplay = useDisplayPrefs((s) => s.chipDisplay);

  return (
    <div className="space-y-4">
      <Panel title="結果" subtitle="トーナメント終了">
        <div className="space-y-1.5">
          {ranked.map((p) => (
            <div
              key={p.uid}
              className="flex items-center justify-between rounded-lg border border-border bg-surface-2/30 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                {p.finishRank === 1 ? (
                  <Crown size={16} className="text-amber-400" />
                ) : (
                  <span className="w-4 text-center text-xs text-muted">{p.finishRank ?? '—'}</span>
                )}
                <span className={p.finishRank === 1 ? 'font-semibold text-amber-300' : ''}>{p.displayName}</span>
              </div>
              <span className="font-mono text-xs text-muted tabular-nums">{formatAmount(p.stack, chipDisplay)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="チップ推移">
        <MultiLineChart players={ranked} />
      </Panel>

      <button
        onClick={onLeave}
        className="w-full rounded-xl border border-border-bright bg-surface-2 px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-2/80"
      >
        退出
      </button>
    </div>
  );
}
