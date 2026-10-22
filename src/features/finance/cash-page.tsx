import { TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ColumnChart } from '@/components/charts/chart';
import { Page, PageHeader } from '@/components/layout/page';
import { Money } from '@/components/shared/money';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { Stat } from '@/components/shared/stat';
import { Card, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useCashProjection } from '@/data/dashboard';
import { useAccounts, useCashFlow } from '@/data/finance';
import { cn } from '@/lib/cn';
import { capitalize, formatDateBR, monthLabel } from '@/lib/dates';
import { toNumber } from '@/lib/money';
import { FinanceNav } from './finance-nav';

type Grain = 'day' | 'week' | 'month';

/** Fluxo de caixa realizado e projetado (US-7.10, 14.4). */
export function CashPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('visao') === 'projetado' ? 'projetado' : 'realizado';
  return (
    <Page>
      <PageHeader title="Fluxo de caixa" description="Só contas da empresa. Transferências entre contas não contam como entrada nem saída." />
      <FinanceNav />
      <Tabs
        value={view}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === 'realizado') next.delete('visao');
          else next.set('visao', v);
          setParams(next, { replace: true });
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="realizado">Realizado</TabsTrigger>
          <TabsTrigger value="projetado">Projetado</TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'realizado' ? <Realized /> : <Projected />}
    </Page>
  );
}

function bucketLabel(bucket: string, grain: Grain) {
  if (grain === 'month') return capitalize(monthLabel(bucket)).slice(0, 3);
  return formatDateBR(bucket).slice(0, 5);
}

function Realized() {
  const [range, setRange] = useDateRange('ano');
  const [params, setParams] = useSearchParams();
  const grain = (params.get('grao') as Grain | null) ?? 'month';
  const accountId = params.get('conta') ? Number(params.get('conta')) : null;
  const accounts = useAccounts();
  const flow = useCashFlow(range.from, range.to, grain, accountId);
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const data = flow.data;
  const ins = data ? data.buckets.reduce((s, b) => s + toNumber(b.inflows), 0) : 0;
  const outs = data ? data.buckets.reduce((s, b) => s + toNumber(b.outflows), 0) : 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodPresets range={range} onChange={setRange} />
        <Select aria-label="Agrupar por" className="h-9 w-auto" value={grain} onChange={(e) => set('grao', e.target.value === 'month' ? null : e.target.value)}>
          <option value="day">Por dia</option>
          <option value="week">Por semana</option>
          <option value="month">Por mês</option>
        </Select>
        <Select aria-label="Conta" className="h-9 w-auto" value={accountId ?? ''} onChange={(e) => set('conta', e.target.value || null)}>
          <option value="">Todas as contas da empresa</option>
          {(accounts.data ?? [])
            .filter((a) => a.owner === 'EMPRESA' && a.kind !== 'CARTAO_CREDITO')
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
      </div>
      {flow.isError ? (
        <ErrorState error={flow.error} onRetry={() => void flow.refetch()} />
      ) : !data ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Saldo no início" value={data.opening} hint={toNumber(data.opened_in_period) > 0 ? <span>+ <Money value={data.opened_in_period} /> de contas abertas no período</span> : undefined} />
            <Stat label="Entradas" value={ins} />
            <Stat label="Saídas" value={outs} />
            <Stat label="Saldo no fim" value={data.closing} hint={<span>Variação <Money value={ins - outs} signed /></span>} />
          </div>
          <Card className="p-4">
            <ColumnChart
              ariaLabel="Entradas e saídas de caixa no período"
              stacked={false}
              data={data.buckets.map((b) => ({
                label: bucketLabel(b.bucket, grain),
                fullLabel: grain === 'month' ? capitalize(monthLabel(b.bucket)) : formatDateBR(b.bucket),
                values: { inflows: toNumber(b.inflows), outflows: toNumber(b.outflows), net: toNumber(b.net) },
              }))}
              series={[
                { key: 'inflows', label: 'Entradas', color: 'var(--color-layer-material)' },
                { key: 'outflows', label: 'Saídas', color: 'var(--color-layer-energy)' },
                { key: 'net', label: 'Saldo do período', color: 'var(--color-ink)', kind: 'line' },
              ]}
              emptyText="Sem lançamentos de caixa no período."
            />
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(['IN', 'OUT'] as const).map((direction) => {
              const cats = data.categories.filter((c) => c.direction === direction);
              const total = cats.reduce((s, c) => s + toNumber(c.amount), 0);
              return (
                <Card key={direction}>
                  <CardHeader title={direction === 'IN' ? 'Entradas por categoria' : 'Saídas por categoria'} />
                  {cats.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">Nada no período.</p>
                  ) : (
                    <ul className="divide-y divide-line text-sm">
                      {cats.map((c) => (
                        <li key={c.code} className="px-4 py-2">
                          <div className="flex justify-between gap-2">
                            <span>
                              <span className="num mr-2 text-muted">{c.code}</span>
                              {c.name}
                            </span>
                            <Money value={c.amount} className="font-medium" />
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                            <div className="h-full rounded-full" style={{ width: `${total > 0 ? (toNumber(c.amount) / total) * 100 : 0}%`, background: direction === 'IN' ? 'var(--color-layer-material)' : 'var(--color-layer-energy)' }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function Projected() {
  const projection = useCashProjection(12);
  if (projection.isError) return <ErrorState error={projection.error} onRetry={() => void projection.refetch()} />;
  if (!projection.data) return <LoadingBlock />;
  const p = projection.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Saldo hoje" value={p.current_balance} />
        <Stat label="Saldo previsto em 12 meses" value={p.months.at(-1)?.closing ?? 0} signed estimated estimatedHint="Só o que já está lançado: parcelas a receber e a pagar" />
        {p.first_negative_month ? (
          <Stat label="Primeiro mês negativo" value={0} format={() => capitalize(monthLabel(p.first_negative_month!))} tone="negative" hint="Antecipe recebimentos ou adie compras" />
        ) : (
          <Stat label="Primeiro mês negativo" value={0} format={() => 'nenhum'} tone="positive" />
        )}
      </div>
      {p.first_negative_month ? (
        <p className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0" /> O caixa da empresa fica negativo em {monthLabel(p.first_negative_month)} com o que já está lançado.
        </p>
      ) : null}
      <Card className="p-4">
        <ColumnChart
          ariaLabel="Saldo previsto da empresa nos próximos 12 meses"
          data={p.months.map((m) => ({ label: capitalize(monthLabel(m.month)).slice(0, 3), fullLabel: capitalize(monthLabel(m.month)), values: { closing: toNumber(m.closing), owner: toNumber(m.owner_paid) } }))}
          series={[
            { key: 'closing', label: 'Saldo previsto da empresa', color: 'var(--color-layer-material)', kind: 'line', dashed: true },
            { key: 'owner', label: 'Parcelas pagas pelo dono', color: 'var(--color-layer-energy)', kind: 'line' },
          ]}
        />
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-subtle text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Mês</th>
                <th className="px-3 py-2 text-right font-medium">Saldo inicial</th>
                <th className="px-3 py-2 text-right font-medium">A receber</th>
                <th className="px-3 py-2 text-right font-medium">A pagar (empresa)</th>
                <th className="px-3 py-2 text-right font-medium">Saldo final</th>
                <th className="px-4 py-2 text-right font-medium">Pago pelo dono</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.months.map((m) => (
                <tr key={m.month} className={cn(toNumber(m.closing) < 0 && 'bg-danger-soft/50')}>
                  <td className="px-4 py-2">{capitalize(monthLabel(m.month))}</td>
                  <td className="px-3 py-2 text-right">
                    <Money value={m.opening} />
                  </td>
                  <td className="px-3 py-2 text-right text-success">
                    <Money value={m.inflows} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Money value={m.outflows} />
                  </td>
                  <td className={cn('px-3 py-2 text-right font-semibold', toNumber(m.closing) < 0 && 'text-danger')}>
                    <Money value={m.closing} />
                  </td>
                  <td className="px-4 py-2 text-right text-muted">
                    <Money value={m.owner_paid} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">Vencidos entram no mês atual. Parcelas no cartão do dono não saem do caixa da empresa e ficam na última coluna.</p>
      </Card>
    </div>
  );
}
