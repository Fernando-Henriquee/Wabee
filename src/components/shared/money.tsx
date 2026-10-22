import { cn } from '@/lib/cn';
import { formatBRL, formatCost, type Numeric, toNumber } from '@/lib/money';

/** Valor em reais. `estimated` marca valores estimados (14.1): sublinhado pontilhado + explicação. */
export function Money({
  value,
  className,
  signed = false,
  cost = false,
  estimated = false,
  hint,
}: {
  value: Numeric;
  className?: string;
  signed?: boolean;
  /** Custo unitário: mostra até 6 casas. */
  cost?: boolean;
  estimated?: boolean;
  hint?: string;
}) {
  const n = value === null || value === undefined || value === '' ? null : toNumber(value);
  const tone = signed && n !== null ? (n < 0 ? 'text-danger' : n > 0 ? 'text-success' : '') : '';
  return (
    <span className={cn('num whitespace-nowrap', tone, estimated && 'estimated cursor-help', className)} title={estimated ? (hint ?? 'Valor estimado') : hint}>
      {estimated ? '~' : ''}
      {signed && n !== null && n > 0 ? '+' : ''}
      {cost ? formatCost(value) : formatBRL(value)}
    </span>
  );
}
