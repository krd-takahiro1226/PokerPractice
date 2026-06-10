import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../lib/cn';

type FeedbackBannerProps = {
  correct: boolean;
  title: string;
  children?: ReactNode;
};

export function FeedbackBanner({ correct, title, children }: FeedbackBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn(
        'rounded-xl border p-4',
        correct ? 'border-accent/40 bg-accent/10' : 'border-danger/40 bg-danger/10',
      )}
    >
      <div className={cn('flex items-center gap-2 font-semibold', correct ? 'text-accent-bright' : 'text-danger')}>
        {correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
        {title}
      </div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </motion.div>
  );
}
