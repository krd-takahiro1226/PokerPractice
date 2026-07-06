import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { RANKS, SUITS, SUIT_IS_RED, SUIT_SYMBOL, type Card, type Suit } from '../core/cards';
import { cn } from '../lib/cn';

type CardPickerProps = {
  used: Card[];
  title?: string;
  onPick: (card: Card) => void;
  onClose: () => void;
};

export function CardPicker({ used, title = 'カードを選択', onPick, onClose }: CardPickerProps) {
  const usedSet = new Set(used);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="panel relative z-10 w-full max-w-lg p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold tracking-tight">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-text">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-1.5">
          {(SUITS as readonly Suit[]).map((suit) => (
            <div key={suit} className="flex items-start gap-1.5 sm:items-center">
              <span
                className="w-5 text-center text-lg"
                style={{ color: SUIT_IS_RED[suit] ? '#e5484d' : '#cbd5e1' }}
              >
                {SUIT_SYMBOL[suit]}
              </span>
              <div className="grid flex-1 grid-cols-7 gap-1 sm:grid-cols-[repeat(13,minmax(0,1fr))]">
                {RANKS.map((rank) => {
                  const card = `${rank}${suit}` as Card;
                  const disabled = usedSet.has(card);
                  return (
                    <button
                      key={card}
                      disabled={disabled}
                      onClick={() => onPick(card)}
                      className={cn(
                        'flex aspect-[3/4] items-center justify-center rounded-md text-xs font-bold transition',
                        disabled
                          ? 'cursor-not-allowed bg-surface/40 text-muted/30'
                          : 'bg-white hover:-translate-y-0.5 hover:ring-2 hover:ring-accent',
                      )}
                      style={{ color: disabled ? undefined : SUIT_IS_RED[suit] ? '#e5484d' : '#1b1b1f' }}
                    >
                      {rank}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
