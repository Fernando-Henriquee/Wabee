import { ChevronRight, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { describeRange, PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type IncomeStatementLine, matchesCodes, type ResultEntry, useIncomeStatement, useResultEntries } from '@/data/finance';
import { cn } from '@/lib/cn';
import { sumMoney } from '@/lib/calc';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatBRL, formatPercent, toNumber } from '@/lib/money';
import { FinanceNav } from './finance-nav';

function sourceHref(e: ResultEntry): string | null {
  switch (e.source_type) {
    case 'purchase':
      return `/compras/${e.source_id}`;
    case 'sales_order':
      return `/vendas/${e.source_id}`;
    default:
      return null;
  }
}

/** DRE gerencial (US-7.11, estrutura 13.2) por competência, com % da receita líquida, período anterior e detalhamento. */
export function IncomeStatementPage() {
  const [range, setRange] = useDateRange('mes');
  const statement = useIncomeStatement(range.from, range.to);
  const [drill, setDrill] = useState<IncomeStatementLine | null>(null);
  const data = statement.data;

  const exportColumns: ExportColumn<IncomeStatementLine>[] = [
    { header: 'Linha', value: (l) => l.label },
    { header: 'Valor', value: (l) => l.amount, kind: 'money' },
    { header: '% da receita líquida', value: (l) => (l.pct === null ? null : Number(l.pct) * 100), kind: 'number' },
    { header: 'Período anterior', value: (l) => l.previous, kind: 'money' },
  ];

  return (
    <Page>
      <PageHeader title="DRE gerencial" description="Resultado por competência: receita e CMV na entrega, despesas na data a que se referem — não no dia em que o dinheiro entra ou sai." />
      <FinanceNav />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPresets range={range} onChange={setRange} />
        {data ? <ExportMenu rows={data.lines} columns={exportColumns} fileName={`dre-${range.from}-${range.to}`} /> : null}
      </div>
      {statement.isError ? (
        <ErrorState error={statement.error} onRetry={() => void statement.refetch()} />
      ) : !data ? (
        <LoadingBlock rows={8} />
      ) : (
        <>
          {data.warnings.energy_not_reconciled || data.warnings.labor_not_valued ? (
            <div className="mb-4 space-y-1 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
              {data.warnings.energy_not_reconciled ? (
                <p className="flex gap-2">
                  <Info className="mt-0.5 size-4 shrink-0" /> Impressões do período usaram a taxa combinada (energia + depreciação estimadas). A conta de luz real só aparece no caixa até você conciliar a energia.
                </p>
              ) : null}
              {data.warnings.labor_not_valued ? (
                <p className="flex gap-2">
                  <Info className="mt-0.5 size-4 shrink-0" /> O trabalho não está valorizado (sem taxa de mão de obra): o resultado não desconta as horas do dono.
                </p>
              ) : null}
            </div>
          ) : null}
          <Card>
            <table className="w-full text-sm">
              <caption className="sr-only">DRE de {describeRange(range)}</caption>
              <thead className="bg-subtle text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{describeRange(range)}</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">% RL</th>
                  <th className="hidden px-4 py-2 text-right font-medium md:table-cell" title={`${formatDateBR(data.compare_from)} a ${formatDateBR(data.compare_to)}`}>
                    Anterior
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.lines.map((l) => {
                  const total = l.kind === 'total';
                  const final = l.key === 'resultado';
                  const empty = !total && toNumber(l.amount) === 0 && toNumber(l.previous) === 0;
                  return (
                    <tr key={l.key} className={cn(total && 'bg-subtle/60', final && 'bg-accent-soft')}>
                      <th scope="row" className={cn('px-4 py-2.5 text-left', total ? 'font-semibold' : 'font-normal text-ink-soft', empty && 'text-muted')}>
                        {!total && !empty ? (
                          <button type="button" className="inline-flex items-center gap-1 text-left hover:underline" onClick={() => setDrill(l)}>
                            {l.label} <ChevronRight className="size-3.5 text-muted" aria-hidden />
                          </button>
                        ) : (
                          l.label
                        )}
                      </th>
                      <td className={cn('px-3 py-2.5 text-right', total && 'font-semibold')}>
                        <Money value={l.amount} signed={final} className={cn(!final && toNumber(l.amount) < 0 && 'text-ink-soft')} />
                      </td>
                      <td className="num hidden px-3 py-2.5 text-right text-muted sm:table-cell">{l.pct === null ? '—' : formatPercent(l.pct)}</td>
                      <td className="hidden px-4 py-2.5 text-right text-muted md:table-cell">
                        <Money value={l.previous} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="mt-2 text-xs text-muted">Valores negativos são custos e despesas. Toque numa linha para ver os lançamentos que a compõem.</p>
        </>
      )}
      {drill ? <DrillDown line={drill} range={range} onOpenChange={(o) => !o && setDrill(null)} /> : null}
    </Page>
  );
}

function DrillDown({ line, range, onOpenChange }: { line: IncomeStatementLine; range: { from: string; to: string }; onOpenChange: (open: boolean) => void }) {
  const entries = useResultEntries({ from: range.from, to: range.to });
  const rows = useMemo(() => (entries.data ?? []).filter((e) => matchesCodes(e.category_code, line.codes)), [entries.data, line.codes]);
  const exportColumns: ExportColumn<ResultEntry>[] = [
    { header: 'Data', value: (e) => formatDateBR(e.occurred_on) },
    { header: 'Categoria', value: (e) => `${e.category_code} ${e.category_name}` },
    { header: 'Descrição', value: (e) => e.description ?? '' },
    { header: 'Documento', value: (e) => e.source_ref ?? '' },
    { header: 'Valor', value: (e) => e.amount, kind: 'money' },
  ];
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent title={line.label.replace(/^\([^)]*\)\s*/, '')} description={`${describeRange({ preset: 'custom', ...range })} · ${rows.length} lançamento(s) · total ${formatBRL(sumMoney(rows.map((r) => r.amount)))}`} size="lg">
        {!entries.data ? (
          <LoadingBlock rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState title="Sem lançamentos" />
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <ExportMenu rows={rows} columns={exportColumns} fileName={`dre-${line.key}`} />
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {rows.map((e) => {
                const href = sourceHref(e);
                return (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="num w-20 shrink-0 text-xs text-muted">{formatDateBR(e.occurred_on)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.description ?? e.category_name}</span>
                      <span className="block text-xs text-muted">
                        {e.category_code} {e.category_name}
                        {e.source_ref ? (
                          <>
                            {' · '}
                            {href ? (
                              <Link to={href} className="underline decoration-accent decoration-2 underline-offset-2">
                                {e.source_ref}
                              </Link>
                            ) : (
                              e.source_ref
                            )}
                          </>
                        ) : null}
                      </span>
                    </span>
                    <Money value={e.amount} signed className="font-medium" />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
