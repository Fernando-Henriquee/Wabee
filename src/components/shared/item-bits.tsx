import { cn } from '@/lib/cn';
import { formatQty, type Numeric } from '@/lib/money';

/** Bolinha de cor do filamento (hex do cadastro) usada em todas as listas (US-1.2). */
export function ColorDot({ hex, className, label }: { hex: string | null | undefined; className?: string; label?: string }) {
  if (!hex) return null;
  return (
    <span
      className={cn('inline-block size-3.5 shrink-0 rounded-full ring-1 ring-inset ring-ink/15', className)}
      style={{ background: hex }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function Qty({ value, unit, className }: { value: Numeric; unit?: string | null; className?: string }) {
  return <span className={cn('num whitespace-nowrap', className)}>{formatQty(value, unit)}</span>;
}

/** Barra do quanto resta no carretel. */
export function RemainingBar({ pct, className }: { pct: number | null | undefined; className?: string }) {
  const value = Math.max(0, Math.min(1, Number(pct ?? 0)));
  return (
    <span className={cn('block h-2 w-full overflow-hidden rounded-full bg-subtle', className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label="Restante no carretel">
      <span className={cn('block h-full rounded-full', value < 0.15 ? 'bg-danger' : value < 0.35 ? 'bg-accent' : 'bg-ink')} style={{ width: `${value * 100}%` }} />
    </span>
  );
}
