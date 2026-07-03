import { useDisplayPrefs } from '../store/displayPrefs';
import { cn } from '../lib/cn';
import type { ChipDisplay } from '../lib/chips';

export function ChipDisplayToggle() {
  const chipDisplay = useDisplayPrefs((s) => s.chipDisplay);
  const setChipDisplay = useDisplayPrefs((s) => s.setChipDisplay);
  return (
    <>
      <span className="text-xs text-muted">表示:</span>
      {(['bb', 'chips'] as ChipDisplay[]).map((d) => (
        <button
          key={d}
          onClick={() => setChipDisplay(d)}
          className={cn(
            'rounded-lg px-3 py-1 text-xs font-medium transition',
            chipDisplay === d
              ? 'bg-accent text-[#04221a]'
              : 'border border-border text-muted hover:text-text',
          )}
        >
          {d === 'bb' ? 'bb' : 'チップ'}
        </button>
      ))}
    </>
  );
}
