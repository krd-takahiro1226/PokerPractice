import { POSITIONS, type Position } from '../core/ranges/types';
import { cn } from '../lib/cn';

const SEAT_POS: Record<Position, { top: string; left: string }> = {
  UTG: { top: '8%', left: '32%' },
  HJ: { top: '8%', left: '68%' },
  CO: { top: '50%', left: '90%' },
  BTN: { top: '88%', left: '68%' },
  SB: { top: '88%', left: '32%' },
  BB: { top: '50%', left: '10%' },
};

type PositionTableProps = {
  hero: string;
  seats?: string[];
  highlightVillain?: string[];
  className?: string;
};

function computeEllipsePos(seats: string[]): Record<string, { top: string; left: string }> {
  const n = seats.length;
  // Place seat 0 (first to act, e.g. UTG) at top-left area.
  // startOffset chosen so BTN (seats[n-3]) lands at bottom-right.
  const startOffset = -Math.PI * 0.7;
  const result: Record<string, { top: string; left: string }> = {};
  for (let i = 0; i < n; i++) {
    const theta = startOffset + i * (2 * Math.PI / n);
    const top = 50 - 42 * Math.cos(theta);
    const left = 50 + 42 * Math.sin(theta);
    result[seats[i]] = {
      top: `${top.toFixed(1)}%`,
      left: `${left.toFixed(1)}%`,
    };
  }
  return result;
}

const DEFAULT_SEATS = [...POSITIONS];

export function PositionTable({ hero, seats, highlightVillain = [], className }: PositionTableProps) {
  const useDefault = !seats || seats.every((s, i) => POSITIONS[i] === s && seats.length === POSITIONS.length);
  const displaySeats = seats ?? DEFAULT_SEATS;
  const n = displaySeats.length;
  const btnSeat = n === 2 ? 'SB' : displaySeats[n - 3] ?? 'BTN'; // HU では SB がボタン

  const posMap: Record<string, { top: string; left: string }> = useDefault
    ? (SEAT_POS as Record<string, { top: string; left: string }>)
    : computeEllipsePos(displaySeats);

  return (
    <div className={cn('relative mx-auto aspect-[1.6/1] w-full max-w-sm', className)}>
      {/* felt */}
      <div className="absolute inset-[12%] rounded-[50%] border border-accent/20 bg-gradient-to-b from-emerald-900/30 to-emerald-950/40 shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] uppercase tracking-[0.3em] text-muted/60">{n}-max</span>
      </div>
      {displaySeats.map((pos) => {
        const isHero = pos === hero;
        const isVillain = highlightVillain.includes(pos);
        const { top, left } = posMap[pos] ?? { top: '50%', left: '50%' };
        return (
          <div
            key={pos}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ top, left }}
          >
            <div
              className={cn(
                'flex h-11 w-11 flex-col items-center justify-center rounded-full border text-[11px] font-bold transition',
                isHero
                  ? 'border-accent bg-accent text-[#04221a] shadow-lg shadow-accent/40'
                  : isVillain
                    ? 'border-danger/50 bg-danger/15 text-danger'
                    : 'border-border-bright bg-surface-2 text-muted',
              )}
            >
              <span>{pos}</span>
              {isHero && <span className="text-[8px] font-semibold tracking-wide">YOU</span>}
            </div>
            {pos === btnSeat && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[8px] font-bold text-black">
                D
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
