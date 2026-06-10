import { SUIT_IS_RED, SUIT_SYMBOL, type Card, type Suit } from '../core/cards';
import { cn } from '../lib/cn';

type Size = 'sm' | 'md' | 'lg';

const sizeMap: Record<Size, { box: string; rank: string; suit: string; corner: string }> = {
  sm: { box: 'w-9 h-13 rounded-md', rank: 'text-sm', suit: 'text-lg', corner: 'text-[10px]' },
  md: { box: 'w-12 h-17 rounded-lg', rank: 'text-lg', suit: 'text-2xl', corner: 'text-xs' },
  lg: { box: 'w-16 h-22 rounded-xl', rank: 'text-2xl', suit: 'text-4xl', corner: 'text-sm' },
};

type PlayingCardProps = {
  card?: Card | null;
  size?: Size;
  faceDown?: boolean;
  onClick?: () => void;
  className?: string;
  selected?: boolean;
};

export function PlayingCard({ card, size = 'md', faceDown, onClick, className, selected }: PlayingCardProps) {
  const s = sizeMap[size];
  const interactive = !!onClick;

  if (!card && !faceDown) {
    return (
      <div
        onClick={onClick}
        className={cn(
          s.box,
          'flex items-center justify-center border-2 border-dashed border-border-bright/70 bg-surface/40 text-muted',
          interactive && 'cursor-pointer hover:border-accent/70 hover:text-accent',
          className,
        )}
      >
        <span className={s.suit}>+</span>
      </div>
    );
  }

  if (faceDown || !card) {
    return (
      <div
        className={cn(
          s.box,
          'border border-accent/30 bg-gradient-to-br from-surface-2 to-bg shadow-inner',
          className,
        )}
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-accent) 18%, transparent) 0 6px, transparent 6px 12px)',
        }}
      />
    );
  }

  const suit = card[1] as Suit;
  const red = SUIT_IS_RED[suit];
  const color = red ? '#e5484d' : '#1b1b1f';

  return (
    <div
      onClick={onClick}
      className={cn(
        s.box,
        'relative flex flex-col items-center justify-center bg-white shadow-md shadow-black/40 select-none',
        interactive && 'cursor-pointer transition hover:-translate-y-0.5',
        selected && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
        className,
      )}
      style={{ color }}
    >
      <span className={cn('absolute left-1 top-0.5 font-bold leading-none', s.corner)}>
        {card[0]}
        {SUIT_SYMBOL[suit]}
      </span>
      <span className={cn('font-extrabold leading-none', s.rank)}>{card[0]}</span>
      <span className={cn('leading-none', s.suit)}>{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}
