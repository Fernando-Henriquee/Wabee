import { ArrowDown, ArrowUp, CalendarClock, Newspaper, Wallet } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { type DateRange, describeRange } from '@/components/shared/period-presets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { type PeriodMetrics, useDeliveryStats, useOrderBacklog, useOwnerWithdrawal, usePeriodCompare, useProductMix, useWeeklySummary } from '@/data/dashboard';
import { cn } from '@/lib/cn';
import { addDays, addMonths, diffInDays, formatDateBR, isValidISODate } from '@/lib/dates';
import { formatBRL, formatNumber, formatPercent, toNumber } from '@/lib/money';

/** Blocos de análise da Visão geral (resumo, mix, entregas, carteira, retirada e comparação). */

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function change(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-muted">novo</span>;
  if (Math.abs(value) < 0.005) return <span className="text-muted">=</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={cn('num inline-flex items-center gap-0.5', good ? 'text-success' : 'text-danger')}>
      {value > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      {formatPercent(Math.abs(value))}
    </span>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ key: T; label: string }>;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex max-w-full overflow-x-auto rounded-xl border border-line bg-subtle p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'h-7 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium text-muted hover:text-ink',
            value === o.key && 'bg-panel text-ink shadow-sm',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
      <div
        className={cn('h-full rounded-full bg-accent', className)}
        style={{
          width: `${max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0}%`,
        }}
      />
    </div>
  );
}

function Loading({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return <div className="p-4">{error ? <ErrorState error={error} onRetry={onRetry} /> : <Skeleton className="h-32" />}</div>;
}

// --- Resumo da semana -------------------------------------------------------

export function WeeklySummaryBlock() {
  const query = useWeeklySummary();
  const w = query.data;
  if (!w) return query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <Skeleton className="h-24" />;
  const cur = w.current;
  const prev = w.previous;
  const revenue = toNumber(cur.net_revenue);
  const delta = change(revenue, toNumber(prev.net_revenue));
  const mood = revenue === 0 ? 'Semana sem vendas' : delta === null || delta > 0.1 ? 'Semana boa' : delta < -0.1 ? 'Semana mais fraca' : 'Semana estável';
  const sentences: ReactNode[] = [];
  if (revenue > 0) {
    sentences.push(
      <>
        Vendeu <strong>{formatBRL(revenue)}</strong> em {cur.orders} pedido(s){' '}
        {delta === null ? (
          '(nos 7 dias anteriores não houve vendas)'
        ) : (
          <>
            (<Delta value={delta} /> sobre os 7 dias anteriores)
          </>
        )}
        , com margem de <strong>{formatBRL(cur.margin_operational)}</strong>
        {cur.margin_operational_pct !== null ? ` (${formatPercent(cur.margin_operational_pct)})` : ''}.
      </>,
    );
  } else {
    sentences.push(
      <>
        Nenhuma entrega nos últimos 7 dias
        {toNumber(prev.net_revenue) > 0 ? `; na semana anterior foram ${formatBRL(prev.net_revenue)}` : ''}.
      </>,
    );
  }
  if (w.best_product)
    sentences.push(
      <>
        Destaque: <strong>{w.best_product.name}</strong> ({formatNumber(w.best_product.units, 0)} un.).
      </>,
    );
  if (w.best_channel)
    sentences.push(
      <>
        Canal que mais vendeu: <strong>{w.best_channel.name}</strong>.
      </>,
    );
  if (toNumber(cur.pieces_produced) > 0 || cur.failed_jobs > 0) {
    sentences.push(
      <>
        Produziu {formatNumber(cur.pieces_produced, 0)} peça(s) em {formatNumber(cur.machine_hours, 1)} h de máquina
        {cur.failed_jobs > 0 ? `, com ${cur.failed_jobs} falha(s)` : ''}.
      </>,
    );
  }
  if (cur.new_customers > 0) sentences.push(<>{cur.new_customers} cliente(s) novo(s).</>);
  return (
    <Card>
      <div className="flex gap-3 p-4">
        <Newspaper className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 text-sm leading-relaxed">
          <p className="font-semibold">{mood}</p>
          <p className="text-ink-soft">
            {sentences.map((s, i) => (
              <span key={i}>{s} </span>
            ))}
          </p>
        </div>
      </div>
    </Card>
  );
}

// --- Simulador de preço (dentro da meta) --------------------------------------

/**
 * Subir o preço em x% mantendo as quantidades: os custos que não dependem do preço
 * ficam iguais, então a nova margem ≈ 1 − (1 − margem) ÷ (1 + x).
 */
export function PriceSimulator({ marginPct, needed }: { marginPct: number; needed: number }) {
  const [pct, setPct] = useState(10);
  const x = pct / 100;
  const newMargin = 1 + x > 0 ? 1 - (1 - marginPct) / (1 + x) : 0;
  const newTarget = newMargin > 0 ? needed / newMargin : null;
  const oldTarget = needed / marginPct;
  return (
    <div className="rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="sim-preco" className="font-medium">
          Simular preço {pct > 0 ? '+' : ''}
          {pct}%
        </label>
        <input
          id="sim-preco"
          type="range"
          min={-20}
          max={40}
          step={5}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="w-48 accent-[var(--color-accent)]"
        />
      </div>
      <p className="mt-1 text-muted">
        {newTarget === null ? (
          'Com esse desconto a margem fica zerada: nenhum faturamento paga as despesas.'
        ) : (
          <>
            Margem passaria de {formatPercent(marginPct)} para <strong className="text-ink">{formatPercent(newMargin)}</strong> e a meta de{' '}
            {formatBRL(oldTarget)} para <strong className="text-ink">{formatBRL(newTarget)}</strong> ({newTarget < oldTarget ? '−' : '+'}
            {formatBRL(Math.abs(newTarget - oldTarget))}). Supõe as mesmas quantidades vendidas.
          </>
        )}
      </p>
    </div>
  );
}

// --- Mix de produtos: ABC, pontuais × catálogo e cores -----------------------

type MixTab = 'abc' | 'split' | 'colors';

const ABC_TONE = { A: 'success', B: 'info', C: 'neutral' } as const;

export function ProductMixBlock({ from, to }: { from: string; to: string }) {
  const query = useProductMix(from, to);
  const [tab, setTab] = useState<MixTab>('abc');
  const mix = query.data;
  return (
    <Card>
      <CardHeader
        title="Produtos"
        description="Margem depois do custo, das taxas do canal e da embalagem, no período"
        actions={
          <Segmented
            label="Visão dos produtos"
            value={tab}
            onChange={setTab}
            options={[
              { key: 'abc', label: 'Curva ABC' },
              { key: 'split', label: 'Pontuais × catálogo' },
              { key: 'colors', label: 'Cores' },
            ]}
          />
        }
      />
      {!mix ? (
        <Loading error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="p-4">
          {tab === 'abc' ? <AbcView products={mix.products} /> : null}
          {tab === 'split' ? <SplitView split={mix.split} /> : null}
          {tab === 'colors' ? <ColorsView colors={mix.colors} /> : null}
        </div>
      )}
    </Card>
  );
}

function AbcView({ products }: { products: NonNullable<ReturnType<typeof useProductMix>['data']>['products'] }) {
  if (products.length === 0) return <p className="text-sm text-muted">Nenhuma venda entregue no período.</p>;
  const groups = (['A', 'B', 'C'] as const).map((abc) => {
    const list = products.filter((p) => p.abc === abc);
    return {
      abc,
      count: list.length,
      share: list.reduce((s, p) => s + toNumber(p.share), 0),
    };
  });
  const max = Math.max(...products.map((p) => toNumber(p.margin)), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-xs">
        {groups.map((g) => (
          <div key={g.abc} className="rounded-lg border border-line p-2">
            <Badge tone={ABC_TONE[g.abc]}>{g.abc}</Badge>
            <p className="mt-1 font-medium">{g.count} produto(s)</p>
            <p className="text-muted">{formatPercent(g.share)} da margem</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">A: os que trazem 80% da margem (cuide do estoque deles). B: os próximos 15%. C: o resto, ou com prejuízo.</p>
      <ol className="divide-y divide-line">
        {products.slice(0, 10).map((p) => (
          <li key={p.variant_id} className="flex items-center gap-3 py-2">
            <Badge tone={ABC_TONE[p.abc]}>{p.abc}</Badge>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                {p.name}
                {p.is_custom ? <Badge tone="accent">pontual</Badge> : null}
              </span>
              <Bar value={toNumber(p.margin)} max={max} className={toNumber(p.margin) < 0 ? 'bg-danger' : undefined} />
            </span>
            <span className="text-right text-xs text-muted">
              <span className={cn('num block text-sm font-semibold', toNumber(p.margin) < 0 ? 'text-danger' : 'text-ink')}>{formatBRL(p.margin)}</span>
              {formatNumber(p.units, 0)} un · {formatBRL(p.revenue)}
            </span>
          </li>
        ))}
      </ol>
      {products.length > 10 ? <p className="text-xs text-muted">e mais {products.length - 10} produto(s).</p> : null}
    </div>
  );
}

function SplitView({ split }: { split: NonNullable<ReturnType<typeof useProductMix>['data']>['split'] }) {
  const total = toNumber(split.custom.revenue) + toNumber(split.catalog.revenue);
  if (total === 0) return <p className="text-sm text-muted">Nenhuma venda entregue no período.</p>;
  const customShare = toNumber(split.custom.revenue) / total;
  const col = (label: string, s: typeof split.custom, tone: string) => {
    const pct = toNumber(s.revenue) > 0 ? toNumber(s.margin) / toNumber(s.revenue) : null;
    return (
      <div className="rounded-lg border border-line p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-muted">
          <span className={cn('inline-block size-2.5 rounded-full', tone)} /> {label}
        </p>
        <p className="num mt-1 text-xl font-semibold">{formatBRL(s.revenue)}</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-2 text-xs text-muted">
          <dt>Margem</dt>
          <dd className="num text-right text-ink">
            {formatBRL(s.margin)}
            {pct !== null ? ` (${formatPercent(pct)})` : ''}
          </dd>
          <dt>Peças</dt>
          <dd className="num text-right text-ink">{formatNumber(s.units, 0)}</dd>
          <dt>Pedidos</dt>
          <dd className="num text-right text-ink">{s.orders}</dd>
        </dl>
      </div>
    );
  };
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-subtle" aria-hidden>
        <div className="h-full bg-accent" style={{ width: `${customShare * 100}%` }} />
        <div className="h-full bg-layer-material" style={{ width: `${(1 - customShare) * 100}%` }} />
      </div>
      <p className="text-sm text-muted">
        <strong className="text-ink">{formatPercent(customShare)}</strong> do faturamento veio de encomendas pontuais e {formatPercent(1 - customShare)} do
        catálogo de revenda.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {col('Pontuais (sob medida)', split.custom, 'bg-accent')}
        {col('Catálogo (revenda)', split.catalog, 'bg-layer-material')}
      </div>
    </div>
  );
}

function ColorsView({ colors }: { colors: NonNullable<ReturnType<typeof useProductMix>['data']>['colors'] }) {
  if (colors.length === 0) return <p className="text-sm text-muted">Sem vendas de produtos com ficha técnica no período.</p>;
  const max = Math.max(...colors.map((c) => toNumber(c.grams)));
  const total = colors.reduce((s, c) => s + toNumber(c.grams), 0);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Gramas de filamento das peças vendidas, pela ficha técnica. Ajuda a decidir qual cor comprar.</p>
      <ul className="space-y-2">
        {colors.slice(0, 12).map((c) => (
          <li key={c.color_name} className="flex items-center gap-3">
            <span className="size-5 shrink-0 rounded-full border border-line-strong" style={{ background: c.color_hex }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex justify-between gap-2 text-sm">
                <span className="truncate font-medium">
                  {c.color_name} <span className="text-xs font-normal text-muted">{c.material}</span>
                </span>
                <span className="num text-xs text-muted">
                  {formatNumber(toNumber(c.grams) / 1000, 2)} kg · {formatPercent(total > 0 ? toNumber(c.grams) / total : 0)}
                </span>
              </span>
              <Bar value={toNumber(c.grams)} max={max} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Tempo de entrega ---------------------------------------------------------

export function DeliveryBlock({ from, to }: { from: string; to: string }) {
  const query = useDeliveryStats(from, to);
  const s = query.data;
  const kinds = [
    { key: 'PRONTA_ENTREGA' as const, label: 'Pronta entrega' },
    { key: 'ENCOMENDA' as const, label: 'Encomendas' },
  ];
  return (
    <Card>
      <CardHeader title="Tempo de entrega" description="Do pedido até a entrega, nos pedidos entregues no período" />
      {!s ? (
        <Loading error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            {kinds.map((k) => {
              const d = s.kinds[k.key];
              return (
                <div key={k.key} className="rounded-lg border border-line p-3">
                  <p className="text-xs font-medium text-muted">{k.label}</p>
                  <p className="num mt-1 text-xl font-semibold">
                    {d?.avg_days === null || d?.avg_days === undefined ? '—' : `${formatNumber(d.avg_days, 1)} dias`}
                  </p>
                  <p className="text-xs text-muted">{d ? `${d.orders} pedido(s)` : 'Nenhum no período'}</p>
                  {d && d.with_due > 0 ? (
                    <p className={cn('mt-1 text-xs font-medium', d.on_time / d.with_due >= 0.9 ? 'text-success' : 'text-warning')}>
                      {formatPercent(d.on_time / d.with_due)} no prazo ({d.on_time} de {d.with_due})
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {s.late.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Entregues com atraso</p>
              <ul className="divide-y divide-line text-sm">
                {s.late.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2 py-1.5">
                    <Link to={`/vendas/${l.id}`} className="truncate hover:underline">
                      {l.number}
                      {l.customer ? ` · ${l.customer}` : ''}
                    </Link>
                    <span className="num text-danger">+{l.days_late} dia(s)</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// --- Carteira de encomendas e capacidade --------------------------------------

export function BacklogBlock() {
  const query = useOrderBacklog(14);
  const b = query.data;
  return (
    <Card>
      <CardHeader
        title="Carteira e capacidade"
        description="Pedidos abertos e horas de máquina nas próximas 2 semanas"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/vendas?aba=abertos">
              <CalendarClock /> Pedidos
            </Link>
          </Button>
        }
      />
      {!b ? <Loading error={query.error} onRetry={() => void query.refetch()} /> : <BacklogBody b={b} />}
    </Card>
  );
}

function BacklogBody({ b }: { b: NonNullable<ReturnType<typeof useOrderBacklog>['data']> }) {
  const capacity = toNumber(b.capacity_hours);
  const demand = toNumber(b.demand_hours);
  const free = capacity - demand;
  const usage = capacity > 0 ? demand / capacity : null;
  return (
    <div className="space-y-4 p-4">
      {b.printers === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma impressora ativa cadastrada. Cadastre em{' '}
          <Link to="/producao/equipamentos" className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
            Produção → Equipamentos
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">Ocupação das impressoras</span>
            <span
              className={cn('num font-semibold', usage !== null && usage > 1 ? 'text-danger' : usage !== null && usage > 0.8 ? 'text-warning' : 'text-ink')}
            >
              {usage === null ? '—' : formatPercent(usage)}
            </span>
          </div>
          <Bar value={demand} max={capacity} className={usage !== null && usage > 1 ? 'bg-danger' : usage !== null && usage > 0.8 ? 'bg-warning' : undefined} />
          <p className="text-xs text-muted">
            {formatNumber(demand, 1)} h de trabalho para {formatNumber(capacity, 0)} h disponíveis ({b.printers} impressora(s) ×{' '}
            {formatNumber(b.hours_per_day, 1)} h/dia × {b.days} dias)
            {toNumber(b.stock_job_hours) > 0 ? `; ${formatNumber(b.stock_job_hours, 1)} h são impressões para estoque` : ''}.
          </p>
          <p className={cn('text-sm font-medium', free >= 0 ? 'text-success' : 'text-danger')}>
            {free >= 0
              ? `Cabem mais ~${formatNumber(free, 0)} h de pedidos novos nas próximas 2 semanas.`
              : `Faltam ~${formatNumber(-free, 0)} h de máquina: há mais trabalho do que impressora nas próximas 2 semanas.`}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">Pedidos abertos</p>
          <p className="num font-semibold">{b.summary.orders}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Valor da carteira</p>
          <p className="num font-semibold">{formatBRL(b.summary.value)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Sinal recebido</p>
          <p className="num font-semibold">{formatBRL(b.summary.received)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Falta receber</p>
          <p className="num font-semibold">{formatBRL(b.summary.to_receive)}</p>
        </div>
      </div>
      {b.list.length > 0 ? (
        <ul className="divide-y divide-line">
          {b.list.slice(0, 8).map((o) => (
            <li key={o.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <Link to={`/vendas/${o.id}`} className="block truncate font-medium hover:underline">
                  {o.number}
                  {o.customer ? ` · ${o.customer}` : ''}
                </Link>
                <span className="text-xs text-muted">
                  {o.due_date ? `prazo ${formatDateBR(o.due_date)}` : 'sem prazo'} · {formatNumber(o.hours, 1)} h de máquina
                  {toNumber(o.received) > 0 ? ` · sinal ${formatBRL(o.received)}` : ''}
                </span>
              </span>
              {o.at_risk ? <Badge tone="danger">não dá tempo</Badge> : null}
              <span className="num text-right text-xs text-muted">
                <span className="block text-sm font-semibold text-ink">{formatBRL(o.to_receive)}</span>a receber
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhum pedido aberto.</p>
      )}
      {b.summary.at_risk > 0 ? (
        <p className="text-xs text-danger">
          “Não dá tempo”: somando as horas dos pedidos com prazo até essa data, passa da capacidade das impressoras até o prazo.
        </p>
      ) : null}
    </div>
  );
}

// --- Quanto o dono pode retirar ------------------------------------------------

export function WithdrawalBlock() {
  const query = useOwnerWithdrawal();
  const w = query.data;
  return (
    <Card>
      <CardHeader
        title="Quanto você pode retirar"
        description="Sem apertar o caixa da empresa"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/financeiro/dono">
              <Wallet /> Dono
            </Link>
          </Button>
        }
      />
      {!w ? (
        <Loading error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-3 p-4 text-sm">
          <div>
            <p className="text-xs font-medium text-muted">Sugestão de retirada agora</p>
            <p className={cn('num text-2xl font-semibold', toNumber(w.suggested) > 0 ? 'text-success' : 'text-ink')}>{formatBRL(w.suggested)}</p>
            <p className="text-xs text-muted">
              {toNumber(w.previous_result) > 0
                ? 'O menor entre o que sobra no caixa e o lucro do mês passado.'
                : 'O mês passado não deu lucro: o recomendado é não retirar além do pró-labore.'}
            </p>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-line pt-3">
            <dt className="text-muted">Caixa da empresa</dt>
            <dd className="num text-right">{formatBRL(w.cash)}</dd>
            <dt className="text-muted">− Contas a pagar em 30 dias</dt>
            <dd className="num text-right">{formatBRL(w.payables_30d)}</dd>
            <dt className="text-muted">
              − Reserva ({formatNumber(w.reserve_months, 1)} {toNumber(w.reserve_months) === 1 ? 'mês' : 'meses'} das contas do mês)
            </dt>
            <dd className="num text-right">{formatBRL(w.reserve)}</dd>
            <dt className="font-medium">= Sobra no caixa</dt>
            <dd className="num text-right font-semibold">{formatBRL(w.cash_room)}</dd>
            <dt className="mt-2 text-muted">Lucro de {MONTH_NAMES[Number(w.previous_month.slice(5, 7)) - 1]}</dt>
            <dd className={cn('num mt-2 text-right', toNumber(w.previous_result) < 0 && 'text-danger')}>{formatBRL(w.previous_result)}</dd>
            <dt className="text-muted">Resultado deste mês até agora</dt>
            <dd className={cn('num text-right', toNumber(w.month_result) < 0 && 'text-danger')}>{formatBRL(w.month_result)}</dd>
          </dl>
          <p className="text-xs text-muted">
            Lucro = margem operacional das vendas − contas que venceram no mês. A reserva é ajustável em Configurações → Empresa e regras.
          </p>
        </div>
      )}
    </Card>
  );
}

// --- Comparar dois períodos ----------------------------------------------------

type CompareMode = 'anterior' | 'ano' | 'custom';

const ROWS: Array<{
  key: keyof PeriodMetrics;
  label: string;
  kind: 'money' | 'int' | 'num' | 'pct';
  invert?: boolean;
}> = [
  { key: 'net_revenue', label: 'Receita líquida', kind: 'money' },
  { key: 'margin_operational', label: 'Margem operacional', kind: 'money' },
  { key: 'margin_operational_pct', label: 'Margem %', kind: 'pct' },
  {
    key: 'fixed_expenses',
    label: 'Contas do período',
    kind: 'money',
    invert: true,
  },
  { key: 'result', label: 'Resultado', kind: 'money' },
  { key: 'orders', label: 'Pedidos entregues', kind: 'int' },
  { key: 'avg_ticket', label: 'Ticket médio', kind: 'money' },
  { key: 'units', label: 'Peças vendidas', kind: 'int' },
  { key: 'custom_revenue', label: 'Receita de pontuais', kind: 'money' },
  { key: 'new_customers', label: 'Clientes novos', kind: 'int' },
  { key: 'pieces_produced', label: 'Peças produzidas', kind: 'int' },
  { key: 'machine_hours', label: 'Horas de máquina', kind: 'num' },
  {
    key: 'failed_jobs',
    label: 'Impressões com falha',
    kind: 'int',
    invert: true,
  },
];

function fmt(value: unknown, kind: (typeof ROWS)[number]['kind']) {
  if (value === null || value === undefined) return '—';
  const n = toNumber(value as number);
  if (kind === 'money') return formatBRL(n);
  if (kind === 'pct') return formatPercent(n);
  return formatNumber(n, kind === 'int' ? 0 : 1);
}

export function CompareBlock({ range }: { range: DateRange }) {
  const [mode, setMode] = useState<CompareMode>('anterior');
  const len = diffInDays(range.to, range.from) + 1;
  const [custom, setCustom] = useState({
    from: addMonths(range.from, -1),
    to: addMonths(range.to, -1),
  });
  const b =
    mode === 'anterior'
      ? { from: addDays(range.from, -len), to: addDays(range.from, -1) }
      : mode === 'ano'
        ? { from: addMonths(range.from, -12), to: addMonths(range.to, -12) }
        : custom;
  const query = usePeriodCompare({ from: range.from, to: range.to }, b);
  const data = query.data;
  return (
    <Card>
      <CardHeader
        title="Comparar períodos"
        description={`${describeRange(range)} × ${formatDateBR(b.from)} a ${formatDateBR(b.to)}`}
        actions={
          <Segmented
            label="Comparar com"
            value={mode}
            onChange={setMode}
            options={[
              { key: 'anterior', label: 'Período anterior' },
              { key: 'ano', label: 'Ano passado' },
              { key: 'custom', label: 'Escolher' },
            ]}
          />
        }
      />
      {mode === 'custom' ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
          <Input
            type="date"
            aria-label="Início da comparação"
            className="h-9 w-auto"
            value={custom.from}
            max={custom.to}
            onChange={(e) => isValidISODate(e.target.value) && setCustom((c) => ({ ...c, from: e.target.value }))}
          />
          <span className="text-sm text-muted">a</span>
          <Input
            type="date"
            aria-label="Fim da comparação"
            className="h-9 w-auto"
            value={custom.to}
            min={custom.from}
            onChange={(e) => isValidISODate(e.target.value) && setCustom((c) => ({ ...c, to: e.target.value }))}
          />
        </div>
      ) : null}
      {!data ? (
        <Loading error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 text-left font-medium" />
                <th className="py-1.5 text-right font-medium">Este período</th>
                <th className="py-1.5 text-right font-medium">Comparado</th>
                <th className="py-1.5 text-right font-medium">Variação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROWS.map((r) => {
                const a = data.a[r.key];
                const bv = data.b[r.key];
                const delta = a === null || bv === null ? undefined : change(toNumber(a as number), toNumber(bv as number));
                return (
                  <tr key={r.key}>
                    <td className="py-1.5 text-muted">{r.label}</td>
                    <td className="num py-1.5 text-right font-medium">{fmt(a, r.kind)}</td>
                    <td className="num py-1.5 text-right text-muted">{fmt(bv, r.kind)}</td>
                    <td className="py-1.5 text-right text-xs">{delta === undefined ? '—' : <Delta value={delta} invert={r.invert} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
