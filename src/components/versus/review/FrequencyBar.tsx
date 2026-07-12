import { cn } from '../../../lib/cn';
import type { ActionCandidate } from '../../../core/solver';
import type { PlayerActionType } from '../../../core/game/types';

const ACTION_LABEL: Record<PlayerActionType, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  allin: 'All-in',
};

// bet/raise/allin=アグレッシブ系（amber）、call/check=中立（cyan）、fold=控えめ（muted gray）
const ACTION_COLOR: Record<PlayerActionType, string> = {
  fold: 'bg-surface-2 text-muted',
  check: 'bg-cyan-500/25 text-cyan-100',
  call: 'bg-cyan-500/40 text-cyan-50',
  bet: 'bg-amber-500/50 text-amber-50',
  raise: 'bg-amber-500/70 text-amber-50',
  allin: 'bg-amber-600/80 text-amber-50',
};

const MIN_WIDTH_PCT_FOR_LABEL = 12;

/** 均衡頻度の積み上げバー。candidates は frequency 比率で横幅を分割する。
 *  実際に取ったアクションと一致するセグメントには ▼ マークを付ける。
 *  同一 action で複数サイズが候補になる（bet33/bet75 等）ため sizeTo まで含めて照合する。 */
export function FrequencyBar({
  candidates,
  taken,
}: {
  candidates: ActionCandidate[];
  taken?: Pick<ActionCandidate, 'action' | 'sizeTo'> | null;
}) {
  const total = candidates.reduce((s, c) => s + c.frequency, 0);
  if (total <= 0 || candidates.length === 0) return null;

  return (
    <div className="w-full">
      <div className="flex h-6 w-full overflow-hidden rounded-md border border-border/40">
        {candidates.map((c, i) => {
          const pct = (c.frequency / total) * 100;
          return (
            <div
              key={`${c.action}-${c.sizeTo ?? ''}-${i}`}
              title={`${ACTION_LABEL[c.action]}${c.sizeTo !== undefined ? ` ${c.sizeTo.toFixed(1)}bb` : ''}: ${(pct).toFixed(0)}%`}
              className={cn(
                'flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-semibold transition-all',
                ACTION_COLOR[c.action],
                i > 0 && 'border-l border-black/20',
              )}
              style={{ width: `${pct}%` }}
            >
              {pct >= MIN_WIDTH_PCT_FOR_LABEL && (
                <span className="px-1">
                  {ACTION_LABEL[c.action]} {pct.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* 実際に取ったアクションの位置に ▼ マーク */}
      <div className="flex h-3 w-full">
        {candidates.map((c, i) => {
          const pct = (c.frequency / total) * 100;
          const isTaken = !!taken && c.action === taken.action && c.sizeTo === taken.sizeTo;
          return (
            <div key={`marker-${i}`} style={{ width: `${pct}%` }} className="flex justify-center">
              {isTaken && <span className="text-[10px] leading-none text-text">▼</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
