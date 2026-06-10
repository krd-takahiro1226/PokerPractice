import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

type StatBadgeProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: 'accent' | 'gold' | 'call' | 'danger' | 'muted';
  className?: string;
};

const accentText: Record<NonNullable<StatBadgeProps['accent']>, string> = {
  accent: 'text-accent-bright',
  gold: 'text-gold',
  call: 'text-call',
  danger: 'text-danger',
  muted: 'text-text',
};

export function StatBadge({ label, value, hint, accent = 'muted', className }: StatBadgeProps) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface-2/60 px-4 py-3', className)}>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={cn('mt-1 font-mono text-2xl font-semibold tabular-nums', accentText[accent])}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
