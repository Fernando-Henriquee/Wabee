import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatBRL, formatPercent, type Numeric, toNumber } from '@/lib/money';

interface StatProps {
  label: string;
  value: Numeric;
  /** Valor do período anterior equivalente: mostra a variação (14.1.5). */
  previous?: Numeric;
  hint?: ReactNode;
  badge?: ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  signed?: boolean;
  /** Valor estimado (energia, depreciação, potencial…): marca "~" e explica (14.1.1). */
  estimated?: boolean;
  estimatedHint?: string;
  format?: (value: Numeric) => string;
  className?: string;
  href?: string;
}

const toneClass = { default: 'text-ink', positive: 'text-success', negative: 'text-danger', warning: 'text-warning' };

export function Stat({ label, value, previous, hint, badge, tone = 'default', signed = false, estimated, estimatedHint, format = formatBRL, className }: StatProps) {
  const n = toNumber(value);
  const effective = signed ? (n < 0 ? 'negative' : n > 0 ? 'positive' : 'default') : tone;
  const prev = previous === undefined || previous === null || previous === '' ? null : toNumber(previous);
  const delta = prev === null ? null : prev === 0 ? (n === 0 ? 0 : null) : (n - prev) / Math.abs(prev);
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-panel px-3.5 py-3 shadow-[var(--shadow-card)]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-xs font-medium leading-tight text-muted">{label}</p>
        {badge}
      </div>
      <p
        className={cn('num text-lg font-semibold leading-tight sm:text-xl', toneClass[effective], estimated && 'estimated cursor-help')}
        title={estimated ? (estimatedHint ?? 'Valor estimado') : undefined}
      >
        {estimated ? '~' : signed && n > 0 ? '+' : ''}
        {format(value)}
      </p>
      {delta !== null && prev !== null ? (
        <p className={cn('num text-xs', delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-muted')}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {formatPercent(Math.abs(delta))} <span className="text-muted">vs. período anterior</span>
        </p>
      ) : null}
      {hint ? <div className="text-xs leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
