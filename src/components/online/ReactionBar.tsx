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
    <div className={cn('absolute bottom-2 right-2 flex flex-col items-end gap-2', className)}>
      {/* Floating received reactions (corner-based float, simpler than per-seat coordinates) */}
      <div className="pointer-events-none relative h-20 w-10">
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
      animate={{ opacity: 1, y: -72, scale: 1.2 }}
      exit={{ opacity: 0 }}
      transition={{ duration: FLOAT_DURATION_MS / 1000, ease: 'easeOut' }}
      className="absolute bottom-0 right-1 text-2xl"
    >
      {reaction.emoji}
    </motion.div>
  );
}
