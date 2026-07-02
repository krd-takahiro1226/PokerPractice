import { cn } from '../../lib/cn';
import { useDisplayPrefs } from '../../store/displayPrefs';
import { formatAmount } from '../../lib/chips';

type PotDisplayProps = {
  pot: number;
  streetCommits: number;
  className?: string;
};

export function PotDisplay({ pot, streetCommits, className }: PotDisplayProps) {
  const total = pot + streetCommits;
  const chipDisplay = useDisplayPrefs((s) => s.chipDisplay);
  return (
    <div className={cn('flex flex-col items-center gap-0.5', className)}>
      <div className="text-[10px] uppercase tracking-widest text-muted">Pot</div>
      <div className="font-mono text-base font-bold text-accent-bright tabular-nums">
        {formatAmount(total, chipDisplay)}
      </div>
    </div>
  );
}
