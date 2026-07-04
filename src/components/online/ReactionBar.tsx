import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../lib/cn';
import type { ReactionEvent } from '../../store/online';

const EMOJIS = ['👍', '🔥', '😂', '😱', '💪'];

// Local float duration is intentionally shorter than the hook's 3s server-side trim
// (docs/ONLINE-VERSUS.md §12.1) — the hook's timer is just a safety net for reactions
// this component never got a chance to render (e.g. tab was backgrounded).
const FLOAT_DURATION_MS = 1500;

type ReactionBarProps = {
  onSend: (emoji: string) => void;
  reactions: ReactionEvent[];
  onExpire: (id: string) => void;
  className?: string;
};

export function ReactionBar({ onSend, reactions, onExpire, className }: ReactionBarProps) {
  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      {/* Floating received reactions — these are the ones we couldn't anchor to a seat
          (sender isn't in the current hand), so show displayName for attribution. */}
      <div className="pointer-events-none relative h-10 w-16 overflow-hidden">
        <AnimatePresence>
          {reactions.map((r) => (
            <FloatingReaction key={r.id} reaction={r} onExpire={onExpire} />
          ))}
        </AnimatePresence>
      </div>

      <div className="pointer-events-auto flex gap-1 rounded-full border border-border bg-surface/80 p-1 backdrop-blur">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSend(emoji)}
            className="rounded-full px-1.5 py-1 text-lg leading-none transition hover:scale-110 active:scale-95"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

function FloatingReaction({
  reaction,
  onExpire,
}: {
  reaction: ReactionEvent;
  onExpire: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onExpire(reaction.id), FLOAT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [reaction.id, onExpire]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 0, scale: 0.6 }}
      animate={{ opacity: 1, y: -28, scale: 1.2 }}
      exit={{ opacity: 0 }}
      transition={{ duration: FLOAT_DURATION_MS / 1000, ease: 'easeOut' }}
      className="absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center"
    >
      <span className="text-2xl leading-none">{reaction.emoji}</span>
      <span className="whitespace-nowrap text-[9px] text-muted">{reaction.displayName}</span>
    </motion.div>
  );
}
