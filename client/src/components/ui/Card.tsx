import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5', className)}>
      {(title !== undefined || action !== undefined) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
