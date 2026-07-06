import { cn } from '../../lib/cn';
import { useDisplayPrefs } from '../../store/displayPrefs';
import { formatAmount } from '../../lib/chips';
import type { Pot } from '../../core/game/pots';

type PotDisplayProps = {
  pot: number;
  streetCommits: number;
  pots?: Pot[];
  className?: string;
};

/**
 * 内訳表示の対象レイヤーを返す。末尾レイヤーが eligible 1人のみの場合、
 * それはまだ他のプレイヤーにコールされていない超過拠出分なので内訳からは除外する。
 */
export function visiblePotLayers(pots: Pot[]): Pot[] {
  if (pots.length === 0) return pots;
  const last = pots[pots.length - 1];
  return last.eligible.length === 1 ? pots.slice(0, -1) : pots;
}

export function PotDisplay({ pot, streetCommits, pots, className }: PotDisplayProps) {
  const total = pot + streetCommits;
  const chipDisplay = useDisplayPrefs((s) => s.chipDisplay);
  const layers = pots ? visiblePotLayers(pots) : [];

  return (
    <div className={cn('flex flex-col items-center gap-0.5', className)}>
      <div className="text-[10px] uppercase tracking-widest text-muted">Pot</div>
      <div className="font-mono text-base font-bold text-accent-bright tabular-nums">
        {formatAmount(total, chipDisplay)}
      </div>
      {layers.length >= 2 && (
        <div className="text-center text-[9px] leading-tight text-muted">
          {layers.map((p, i) => (
            <span key={i}>
              {i > 0 && ' ・ '}
              {i === 0 ? 'メイン' : `サイド${i}`} {formatAmount(p.amount, chipDisplay)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
