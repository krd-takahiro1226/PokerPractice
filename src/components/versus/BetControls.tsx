import { useState } from 'react';
import { cn } from '../../lib/cn';
import type { LegalActions } from '../../core/game/engine';
import type { PlayerAction } from '../../core/game/types';

type BetControlsProps = {
  legal: LegalActions;
  potForSizing: number;
  onAction: (action: PlayerAction) => void;
};

const SIZE_PRESETS = [
  { label: '1/3', ratio: 1 / 3 },
  { label: '1/2', ratio: 1 / 2 },
  { label: '2/3', ratio: 2 / 3 },
  { label: 'Pot', ratio: 1 },
  { label: 'All-in', ratio: Infinity },
] as const;

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function BetControls({ legal, potForSizing, onAction }: BetControlsProps) {
  const canBetOrRaise = legal.canBet || legal.canRaise;
  const betActionType = legal.canBet ? 'bet' : 'raise';

  // Default bet size: 2/3 pot
  const defaultBetTo = clamp(
    Math.round(potForSizing * (2 / 3) * 2) / 2, // round to 0.5
    legal.minBetTo,
    legal.maxBetTo,
  );
  const [betTo, setBetTo] = useState(defaultBetTo);

  const computePresetSize = (ratio: number): number => {
    if (ratio === Infinity) return legal.maxBetTo;
    const sizingBase = potForSizing + (legal.canCall ? legal.callAmount : 0);
    const raw = (legal.canCall ? legal.callAmount : 0) + ratio * sizingBase;
    // This is total-commit target
    const target = legal.canBet
      ? raw
      : legal.callAmount + ratio * potForSizing;
    return clamp(Math.round(target * 2) / 2, legal.minBetTo, legal.maxBetTo);
  };

  const handleFold = () => onAction({ type: 'fold' });
  const handleCheck = () => onAction({ type: 'check' });
  const handleCall = () => onAction({ type: 'call' });
  const handleBetRaise = () => {
    const clamped = clamp(betTo, legal.minBetTo, legal.maxBetTo);
    onAction({ type: betActionType, amount: clamped });
  };

  const baseButtonClass =
    'flex-1 rounded-xl border py-2.5 text-sm font-semibold transition active:scale-95';

  return (
    <div className="flex flex-col gap-3">
      {/* Main action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleFold}
          className={cn(
            baseButtonClass,
            'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
          )}
        >
          Fold
        </button>

        {legal.canCheck ? (
          <button
            onClick={handleCheck}
            className={cn(
              baseButtonClass,
              'border-border-bright bg-surface-2 text-text hover:bg-surface-2/80',
            )}
          >
            Check
          </button>
        ) : legal.canCall ? (
          <button
            onClick={handleCall}
            className={cn(
              baseButtonClass,
              'border-accent/40 bg-accent/10 text-accent-bright hover:bg-accent/20',
            )}
          >
            Call {legal.callAmount.toFixed(1)}bb
          </button>
        ) : null}

        {canBetOrRaise && (
          <button
            onClick={handleBetRaise}
            className={cn(
              baseButtonClass,
              'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
            )}
          >
            {legal.canBet ? 'Bet' : 'Raise'} {clamp(betTo, legal.minBetTo, legal.maxBetTo).toFixed(1)}bb
          </button>
        )}
      </div>

      {/* Bet sizing controls */}
      {canBetOrRaise && (
        <div className="flex flex-col gap-2">
          {/* Presets */}
          <div className="flex gap-1.5">
            {SIZE_PRESETS.map((preset) => {
              const size = computePresetSize(preset.ratio);
              return (
                <button
                  key={preset.label}
                  onClick={() => setBetTo(size)}
                  className={cn(
                    'flex-1 rounded-lg border border-border py-1 text-xs font-medium transition',
                    betTo === size
                      ? 'border-accent/50 bg-accent/15 text-accent-bright'
                      : 'bg-surface-2/50 text-muted hover:bg-surface-2 hover:text-text',
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Slider */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={legal.minBetTo}
              max={legal.maxBetTo}
              step={0.5}
              value={betTo}
              onChange={(e) => setBetTo(parseFloat(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-accent-bright"
            />
            <span className="w-16 text-right font-mono text-sm text-accent-bright tabular-nums">
              {clamp(betTo, legal.minBetTo, legal.maxBetTo).toFixed(1)}bb
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
