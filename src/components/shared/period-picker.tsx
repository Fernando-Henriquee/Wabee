import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBusiness } from '@/features/business/business-context';
import { cn } from '@/lib/cn';
import { describePeriod, isValidISODate, type Period, type PeriodKind, periodFor, shiftPeriod } from '@/lib/dates';

const KINDS: Array<{ value: PeriodKind; label: string }> = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'custom', label: 'Período' },
];

/** Período selecionado, guardado na URL (?periodo=mes&de=…&ate=…). */
export function usePeriod(defaultKind: Exclude<PeriodKind, 'custom'> = 'month'): [Period, (period: Period) => void] {
  const { today } = useBusiness();
  const [params, setParams] = useSearchParams();
  const kind = (params.get('periodo') as PeriodKind | null) ?? defaultKind;
  const from = params.get('de');
  const to = params.get('ate');
  let period: Period;
  if (kind === 'custom' && isValidISODate(from) && isValidISODate(to) && from <= to) period = { kind, from, to };
  else if (kind !== 'custom' && isValidISODate(from)) period = periodFor(kind, from);
  else period = periodFor(kind === 'custom' ? defaultKind : kind, today());

  const setPeriod = (next: Period) => {
    const updated = new URLSearchParams(params);
    updated.set('periodo', next.kind);
    updated.set('de', next.from);
    if (next.kind === 'custom') updated.set('ate', next.to);
    else updated.delete('ate');
    setParams(updated, { replace: true });
  };
  return [period, setPeriod];
}

export function PeriodPicker({ period, onChange, className }: { period: Period; onChange: (period: Period) => void; className?: string }) {
  const { today } = useBusiness();
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center', className)}>
      <div role="radiogroup" aria-label="Tipo de período" className="inline-flex rounded-xl border border-line bg-subtle p-1">
        {KINDS.map((kind) => (
          <button
            key={kind.value}
            type="button"
            role="radio"
            aria-checked={period.kind === kind.value}
            onClick={() => {
              if (kind.value === 'custom') {
                onChange({ kind: 'custom', from: period.from, to: period.to });
                return;
              }
              // Referência: hoje, se estiver no período exibido; senão, o início dele.
              const now = today();
              const reference = now >= period.from && now <= period.to ? now : period.from;
              onChange(periodFor(kind.value, reference));
            }}
            className={cn(
              'h-8 flex-1 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-ink',
              period.kind === kind.value && 'bg-panel text-ink shadow-sm',
            )}
          >
            {kind.label}
          </button>
        ))}
      </div>
      {period.kind === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="Data inicial" className="h-9 w-auto" value={period.from} max={period.to} onChange={(e) => isValidISODate(e.target.value) && onChange({ ...period, from: e.target.value })} />
          <span className="text-sm text-muted">a</span>
          <Input type="date" aria-label="Data final" className="h-9 w-auto" value={period.to} min={period.from} onChange={(e) => isValidISODate(e.target.value) && onChange({ ...period, to: e.target.value })} />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Período anterior" onClick={() => onChange(shiftPeriod(period, -1))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium text-ink" aria-live="polite">
            {describePeriod(period)}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Próximo período" onClick={() => onChange(shiftPeriod(period, 1))}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
