import type { Action } from '../core/ranges/types';
import { cn } from '../lib/cn';

type Option = { action: Action; label: string };

const DEFAULT_OPTIONS: Option[] = [
  { action: 'fold', label: 'フォールド' },
  { action: 'call', label: 'コール' },
  { action: 'raise', label: 'レイズ' },
];

const styles: Record<Action, { idle: string; active: string }> = {
  raise: { idle: 'border-raise/40 hover:bg-raise/10 text-raise', active: 'bg-raise text-[#04221a] border-raise' },
  call: { idle: 'border-call/40 hover:bg-call/10 text-call', active: 'bg-call text-[#04222b] border-call' },
  fold: { idle: 'border-border-bright hover:bg-surface-2 text-muted', active: 'bg-fold text-text border-border-bright' },
};

type ActionButtonsProps = {
  options?: Option[];
  selected?: Action | null;
  disabled?: boolean;
  onSelect: (action: Action) => void;
};

// Tailwind は動的クラス生成不可のため、選択肢数ごとに固定クラス文字列を出し分ける。
export function gridColsClass(optionCount: number): string {
  return optionCount === 2 ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-3 gap-3';
}

export function ActionButtons({ options = DEFAULT_OPTIONS, selected, disabled, onSelect }: ActionButtonsProps) {
  const gridClass = gridColsClass(options.length);
  return (
    <div className={gridClass}>
      {options.map((o) => {
        const isActive = selected === o.action;
        return (
          <button
            key={o.action}
            disabled={disabled}
            onClick={() => onSelect(o.action)}
            className={cn(
              'rounded-xl border-2 py-3 text-base font-semibold transition active:scale-95 disabled:pointer-events-none',
              isActive ? styles[o.action].active : `bg-surface-2/50 ${styles[o.action].idle}`,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
