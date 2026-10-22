import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import type { InstallmentRow } from '@/data/finance';
import { cn } from '@/lib/cn';
import { sumMoney } from '@/lib/calc';
import { addDays, addMonths, capitalize, endOfMonth, endOfWeek, formatDateBR, monthLabel, startOfMonth, startOfWeek } from '@/lib/dates';
import { formatBRL, toNumber } from '@/lib/money';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function shortMoney(value: number) {
  if (value >= 1000) return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 1000)} mil`;
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

/** Vencimentos por dia do mês com total diário (US-7.3); tocar num dia lista as parcelas dele. */
export function InstallmentCalendar({ rows, today, renderList }: { rows: InstallmentRow[]; today: string; renderList: (rows: InstallmentRow[]) => ReactNode }) {
  const [month, setMonth] = useState(startOfMonth(today));
  const [day, setDay] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const map = new Map<string, InstallmentRow[]>();
    for (const r of rows) {
      if (!map.has(r.due_date)) map.set(r.due_date, []);
      map.get(r.due_date)!.push(r);
    }
    return map;
  }, [rows]);

  const first = startOfWeek(month);
  const last = endOfWeek(endOfMonth(month));
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const monthRows = rows.filter((r) => r.due_date.startsWith(month.slice(0, 7)));
  const dayRows = day ? (byDay.get(day) ?? []) : [];

  const go = (delta: number) => {
    setMonth(addMonths(month, delta));
    setDay(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Mês anterior" onClick={() => go(-1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-40 text-center font-semibold" aria-live="polite">
            {capitalize(monthLabel(month))}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Próximo mês" onClick={() => go(1)}>
            <ChevronRight />
          </Button>
        </div>
        <span className="text-sm text-muted">
          {monthRows.length} parcela(s) · <Money value={sumMoney(monthRows.map((r) => r.amount))} className="font-semibold text-ink" />
        </span>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
        <div className="grid grid-cols-7 border-b border-line bg-subtle text-center text-xs font-medium text-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7" role="grid" aria-label={`Vencimentos de ${monthLabel(month)}`}>
          {days.map((d) => {
            const items = byDay.get(d) ?? [];
            const total = items.reduce((s, r) => s + toNumber(r.amount), 0);
            const inMonth = d.startsWith(month.slice(0, 7));
            const overdue = items.length > 0 && d < today;
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                disabled={items.length === 0}
                aria-selected={day === d}
                aria-label={`${formatDateBR(d)}: ${items.length ? `${items.length} parcela(s), ${formatBRL(total)}` : 'sem vencimentos'}`}
                onClick={() => setDay(day === d ? null : d)}
                className={cn(
                  'flex min-h-16 flex-col items-stretch gap-1 border-b border-r border-line p-1.5 text-left transition-colors sm:min-h-20 sm:p-2 [&:nth-child(7n)]:border-r-0',
                  !inMonth && 'bg-subtle/50 text-muted',
                  items.length > 0 && 'hover:bg-accent-soft',
                  day === d && 'bg-accent-soft ring-2 ring-inset ring-accent',
                )}
              >
                <span className={cn('num text-xs', d === today && 'inline-flex size-5 items-center justify-center self-start rounded-full bg-ink font-semibold text-brand-fg')}>{Number(d.slice(8))}</span>
                {items.length > 0 ? (
                  <span className={cn('num mt-auto rounded px-1 py-0.5 text-[11px] font-semibold leading-tight sm:text-xs', overdue ? 'bg-danger-soft text-danger' : 'bg-subtle text-ink')}>
                    <span className="hidden sm:inline">{formatBRL(total)}</span>
                    <span className="sm:hidden">{shortMoney(total)}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {day ? (
        <section aria-label={`Vencimentos de ${formatDateBR(day)}`}>
          <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
            <h2 className="font-sans text-sm font-semibold">Vencimentos de {formatDateBR(day)}</h2>
            <Money value={sumMoney(dayRows.map((r) => r.amount))} className="text-sm font-semibold" />
          </div>
          {renderList(dayRows)}
        </section>
      ) : (
        <p className="text-center text-sm text-muted">Toque num dia com valor para ver as parcelas.</p>
      )}
    </div>
  );
}
