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
  hero: Position;
  /** positions that are villains / already acted */
  highlightVillain?: Position[];
  className?: string;
};

export function PositionTable({ hero, highlightVillain = [], className }: PositionTableProps) {
  return (
    <div className={cn('relative mx-auto aspect-[1.6/1] w-full max-w-sm', className)}>
      {/* felt */}
      <div className="absolute inset-[12%] rounded-[50%] border border-accent/20 bg-gradient-to-b from-emerald-900/30 to-emerald-950/40 shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] uppercase tracking-[0.3em] text-muted/60">6-max</span>
      </div>
      {POSITIONS.map((pos) => {
        const isHero = pos === hero;
        const isVillain = highlightVillain.includes(pos);
        const { top, left } = SEAT_POS[pos];
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
            {pos === 'BTN' && (
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
