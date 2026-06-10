import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

type PanelProps = {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
};

export function Panel({ children, className, title, subtitle }: PanelProps) {
  return (
    <section className={cn('panel p-5 sm:p-6', className)}>
      {(title || subtitle) && (
        <header className="mb-4">
          {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}
