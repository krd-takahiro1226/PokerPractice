import { PlayingCard } from '../PlayingCard';
import type { Card } from '../../core/cards';

type BoardViewProps = {
  board: Card[];
  className?: string;
};

export function BoardView({ board, className }: BoardViewProps) {
  const slots: (Card | null)[] = [
    board[0] ?? null,
    board[1] ?? null,
    board[2] ?? null,
    board[3] ?? null,
    board[4] ?? null,
  ];

  return (
    <div className={`flex gap-1.5 ${className ?? ''}`}>
      {slots.map((card, i) => (
        <PlayingCard key={i} card={card} size="sm" />
      ))}
    </div>
  );
}
