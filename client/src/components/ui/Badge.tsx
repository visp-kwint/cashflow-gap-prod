import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'gray' | 'green' | 'red' | 'blue' | 'amber' | 'violet';

const TONES: Record<Tone, string> = {
  gray: 'bg-slate-800 text-slate-300',
  green: 'bg-emerald-500/15 text-emerald-400',
  red: 'bg-rose-500/15 text-rose-400',
  blue: 'bg-slate-700/40 text-slate-300',
  amber: 'bg-slate-700/40 text-slate-300',
  violet: 'bg-emerald-500/15 text-emerald-400',
};

export function Badge({
  tone = 'gray',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>
      {children}
    </span>
  );
}
