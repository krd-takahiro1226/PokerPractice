import type { CSSProperties } from 'react';
import { HAND_GRID, type HandClass } from '../core/handNotation';
import type { HandAction, Range } from '../core/ranges/types';
import { cn } from '../lib/cn';

function cellStyle(action: HandAction | undefined): CSSProperties {
  const raise = action?.raise ?? 0;
  const call = action?.call ?? 0;
  const fold = Math.max(0, 1 - raise - call);
  const segs: [string, number][] = [
    ['var(--color-raise)', raise],
    ['var(--color-call)', call],
    ['var(--color-fold)', fold],
  ];
  const stops: string[] = [];
  let acc = 0;
  for (const [color, frac] of segs) {
    if (frac <= 0) continue;
    const start = acc * 100;
    acc += frac;
    stops.push(`${color} ${start}%`, `${color} ${acc * 100}%`);
  }
  return { backgroundImage: `linear-gradient(to top, ${stops.join(', ')})` };
}

type RangeGridProps = {
  range: Range;
  highlight?: HandClass | null;
  onCellClick?: (hand: HandClass) => void;
  className?: string;
};

export function RangeGrid({ range, highlight, onCellClick, className }: RangeGridProps) {
  return (
    <div className={cn('grid grid-cols-[repeat(13,minmax(0,1fr))] gap-[2px]', className)}>
      {HAND_GRID.flat().map((hand) => {
        const action = range[hand];
        const isHi = highlight === hand;
        const played = (action?.raise ?? 0) + (action?.call ?? 0) > 0;
        return (
          <button
            key={hand}
            type="button"
            onClick={onCellClick ? () => onCellClick(hand) : undefined}
            title={hand}
            style={cellStyle(action)}
            className={cn(
              'relative flex aspect-square items-center justify-center rounded-[3px] text-[7px] font-semibold leading-none transition sm:text-[10px]',
              played ? 'text-white/95' : 'text-muted/70',
              onCellClick && 'cursor-pointer hover:z-10 hover:scale-110 hover:ring-1 hover:ring-white/40',
              isHi && 'z-20 scale-110 ring-2 ring-gold ring-offset-1 ring-offset-bg animate-pulse',
            )}
          >
            {hand}
          </button>
        );
      })}
    </div>
  );
}

export function RangeLegend({ percent }: { percent?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <LegendChip color="var(--color-raise)" label="レイズ" />
      <LegendChip color="var(--color-call)" label="コール" />
      <LegendChip color="var(--color-fold)" label="フォールド" />
      {percent !== undefined && (
        <span className="ml-auto font-mono text-text">
          プレイ率 {(percent * 100).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
