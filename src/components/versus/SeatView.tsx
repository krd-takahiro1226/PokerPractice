import { cn } from '../../lib/cn';
import { PlayingCard } from '../PlayingCard';
import type { PlayerState } from '../../core/game/types';
import { useDisplayPrefs } from '../../store/displayPrefs';
import { formatAmount } from '../../lib/chips';

type SeatViewProps = {
  player: PlayerState;
  isToAct: boolean;
  showCards?: boolean;
  className?: string;
};

const STATUS_LABEL: Record<PlayerState['status'], string> = {
  active: '',
  folded: 'FOLD',
  allin: 'ALL-IN',
};

export function SeatView({ player, isToAct, showCards = false, className }: SeatViewProps) {
  const isFolded = player.status === 'folded';
  const isAllin = player.status === 'allin';
  const chipDisplay = useDisplayPrefs((s) => s.chipDisplay);

  const showFaceUp = showCards || player.isHero;
  const hideOnMobile = !player.isHero && !showCards;

  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-1 rounded-xl border p-1.5 text-center transition-all sm:p-2',
        isFolded
          ? 'border-border/40 bg-surface/30 opacity-50'
          : isToAct
            ? 'border-accent bg-accent/10 shadow-md shadow-accent/20 ring-1 ring-accent/40'
            : 'border-border bg-surface-2/60',
        className,
      )}
    >
      {/* Position label */}
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
        {player.pos}
        {player.isHero && <span className="ml-1 text-accent-bright">YOU</span>}
      </div>

      {/* Cards */}
      {player.hole ? (
        <div className={cn('flex gap-0.5', hideOnMobile && 'hidden sm:flex')}>
          {showFaceUp ? (
            <>
              <PlayingCard card={player.hole[0]} size="sm" />
              <PlayingCard card={player.hole[1]} size="sm" />
            </>
          ) : (
            <>
              <PlayingCard faceDown size="sm" />
              <PlayingCard faceDown size="sm" />
            </>
          )}
        </div>
      ) : (
        <div className={cn('flex gap-0.5 opacity-30', hideOnMobile && 'hidden sm:flex')}>
          <PlayingCard faceDown size="sm" />
          <PlayingCard faceDown size="sm" />
        </div>
      )}

      {/* Stack */}
      <div className="font-mono text-xs font-semibold tabular-nums">
        {isFolded ? (
          <span className="text-muted">FOLD</span>
        ) : isAllin ? (
          <span className="text-amber-400">ALL-IN</span>
        ) : (
          <span className="text-text">{formatAmount(player.stack, chipDisplay)}</span>
        )}
      </div>

      {/* Bet chip */}
      {player.committedStreet > 0 && !isFolded && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-black shadow">
            {formatAmount(player.committedStreet, chipDisplay)}
          </span>
        </div>
      )}

      {/* Acting indicator */}
      {isToAct && (
        <div className="absolute -top-1 -right-1 h-2.5 w-2.5 animate-pulse rounded-full bg-accent-bright" />
      )}
    </div>
  );
}
