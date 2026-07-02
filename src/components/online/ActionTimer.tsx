import { cn } from '../../lib/cn';

type ActionTimerProps = {
  /** ms remaining until action_deadline. null = no active deadline (hide). */
  deadlineMs: number | null;
  className?: string;
};

// Server allots a 30s window per action (docs/ONLINE-VERSUS.md §13.2).
const TOTAL_WINDOW_MS = 30_000;
const DANGER_THRESHOLD_MS = 10_000;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function ActionTimer({ deadlineMs, className }: ActionTimerProps) {
  if (deadlineMs === null) return null;

  const fraction = clamp01(deadlineMs / TOTAL_WINDOW_MS);
  const danger = deadlineMs < DANGER_THRESHOLD_MS;

  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-200 ease-linear',
          danger ? 'bg-danger' : 'bg-accent-bright',
        )}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}
