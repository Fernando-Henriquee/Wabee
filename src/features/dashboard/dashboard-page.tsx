import { AlertTriangle, ArrowRight, CircleAlert, Info, Printer, Settings2, Sparkles, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ColumnChart, COST_LAYERS } from '@/components/charts/chart';
import { Page, PageHeader } from '@/components/layout/page';
import { Money } from '@/components/shared/money';
import { CostLayerSelector, type CostLayerView, PeriodPresets, useCostLayer, useDateRange } from '@/components/shared/period-presets';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/states';
import {
  type DashboardAlert,
  type GoalExpenseSource,
  type MarginBlock,
  type MonthlyGoal,
  type Overview,
  useAlerts,
  useInsights,
  useCashProjection,
  useMonthlyGoal,
  useNowPrinting,
  useOverview,
  useStockValue,
  useSalesSeries,
  useTopProducts,
  useValuePath,
  type ValueStage,
} from '@/data/dashboard';
import { type ItemKind, KIND_LABELS } from '@/data/inventory';
import { useQuoteSummary } from '@/data/quotes';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { diffInDays, formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { formatBRL, formatMinutes, formatNumber, formatPercent, toNumber } from '@/lib/money';
import { pendingStepsFromState } from '@/features/onboarding/onboarding-logic';
import { BacklogBlock, CompareBlock, DeliveryBlock, PriceSimulator, ProductMixBlock, QuotesBlock, WeeklySummaryBlock, WithdrawalBlock } from './insights';
import { CustomizeDialog } from './layout';
import { BLOCKS, type BlockId, useLayoutPrefs, visibleBlocks } from './layout-prefs';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function bucketLabel(iso: string, grain: 'day' | 'week' | 'month') {
  const [y, m, d] = iso.split('-');
  if (grain === 'month') return `${MONTHS[Number(m) - 1]}/${y!.slice(2)}`;
  return `${d}/${m}`;
}

function marginOf(block: MarginBlock | undefined, layer: CostLayerView) {
  if (!block) return { value: 0, pct: null as number | null };
  return { value: toNumber(block[layer]), pct: block[`${layer}_pct`] };
}

const SEVERITY: Record<DashboardAlert['severity'], { icon: ReactNode; className: string }> = {
  danger: { icon: <CircleAlert className="size-4" aria-hidden />, className: 'border-danger/30 bg-danger-soft text-danger' },
  warning: { icon: <AlertTriangle className="size-4" aria-hidden />, className: 'border-warning/30 bg-warning-soft text-warning' },
  info: { icon: <Info className="size-4" aria-hidden />, className: 'border-info/25 bg-info-soft text-info' },
};

function Alerts({ finance }: { finance: boolean }) {
  const base = useAlerts();
  const insights = useInsights(finance);
  const quotes = useQuoteSummary(finance);
  const q = quotes.data;
  const quoteAlerts: DashboardAlert[] = !q
    ? []
    : q.due > 0
      ? [{
          kind: 'quote_follow_up',
          severity: q.overdue > 0 ? 'warning' : 'info',
          title: 'Orçamentos para retomar',
          detail: `${q.due} ${q.due === 1 ? 'pessoa para procurar' : 'pessoas para procurar'} hoje${q.overdue > 0 ? ` (${q.overdue} com retorno atrasado)` : ''}${toNumber(q.open_value) > 0 ? `; ${formatBRL(q.open_value)} em propostas abertas` : ''}.`,
          href: '/orcamentos',
        }]
      : q.to_analyze > 0
        ? [{ kind: 'quote_to_analyze', severity: 'info', title: 'Orçamentos para analisar', detail: `${q.to_analyze} ${q.to_analyze === 1 ? 'pedido anotado espera' : 'pedidos anotados esperam'} ficha e preço.`, href: '/orcamentos' }]
        : [];
  const all = [...(base.data ?? []), ...(insights.data ?? []), ...quoteAlerts];
  const order = { danger: 0, warning: 1, info: 2 };
  const alerts = { data: all.sort((a, b) => order[a.severity] - order[b.severity]) };
  if (alerts.data.length === 0) return null;
  return (
    <section aria-label="Alertas" className="mb-5 space-y-2">
      {alerts.data.slice(0, 8).map((alert, index) => {
        const style = SEVERITY[alert.severity];
        const content = (
          <>
            {style.icon}
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{alert.title}:</span> <span className="text-ink-soft">{alert.detail}</span>
            </span>
            {alert.href ? <ArrowRight className="size-4 shrink-0 opacity-60" aria-hidden /> : null}
          </>
        );
        const className = cn('flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm', style.className);
        return alert.href ? (
          <Link key={`${alert.kind}-${index}`} to={alert.href} className={cn(className, 'hover:brightness-[0.98]')}>
            {content}
          </Link>
        ) : (
          <div key={`${alert.kind}-${index}`} className={className}>
            {content}
          </div>
        );
      })}
      {alerts.data.length > 8 ? <p className="text-xs text-muted">e mais {alerts.data.length - 8} alerta(s).</p> : null}
    </section>
  );
}

function OnboardingCallout() {
  const { settings, can } = useMember();
  const state = settings.onboarding_state;
  const pending = pendingStepsFromState(state);
  if (!can('settings') || (state?.done && pending.length === 0)) return null;
  const started = Boolean(state?.done || state?.step);
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div aria-hidden className="hidden size-14 shrink-0 rounded-2xl honey-stripes sm:block" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base">{started ? 'Configuração inicial pendente' : 'Vamos configurar a Wabee'}</h2>
          {started ? (
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Passos pendentes">
              {pending.map((step) => (
                <li key={step.key}>
                  <Link to={`/inicio/assistente?passo=${step.key}`} className="inline-flex rounded-full border border-line-strong bg-panel px-2.5 py-1 text-xs font-medium hover:bg-subtle">
                    {step.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Um passo a passo curto: contas, impressora, taxa operacional, filamentos e componentes que você já tem, compras já feitas e canais de venda.
            </p>
          )}
        </div>
        <Button asChild variant="accent">
          <Link to="/inicio/assistente">
            <Sparkles /> {started ? 'Continuar' : 'Começar'}
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function Indicators({ from, to, layer, compact = false }: { from: string; to: string; layer: CostLayerView; compact?: boolean }) {
  const overview = useOverview(from, to);
  // Margem dos últimos 90 dias, para quando o período escolhido ainda não tem vendas.
  const recent = useMonthlyGoal(layer).data;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  if (!o) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: compact ? 4 : 8 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  const margin = marginOf(o.margin, layer);
  const marginPrev = marginOf(o.margin_previous, layer);
  const estimatedOp = layer !== 'direct' && (o.flags.combined_rate_period || o.flags.missing_rates);
  return (
    <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Caixa disponível" value={o.cash_available} tone={toNumber(o.cash_available) < 0 ? 'negative' : 'default'} hint="Contas da empresa" />
      {compact ? null : (
        <Stat
          label="A pagar em 30 dias"
          value={toNumber(o.payable_30d.company) + toNumber(o.payable_30d.owner)}
          hint={
            <>
              Empresa <Money value={o.payable_30d.company} /> · Dono <Money value={o.payable_30d.owner} />
            </>
          }
          tone={toNumber(o.payable_30d.overdue) > 0 ? 'warning' : 'default'}
        />
      )}
      <Stat
        label="A receber"
        value={o.receivable.open}
        hint={toNumber(o.receivable.overdue) > 0 ? <span className="font-medium text-danger">Atrasado: {formatBRL(o.receivable.overdue)}</span> : `${o.receivable.count} parcela(s)`}
      />
      <Stat label="Vendas do período" value={o.sales.current} previous={o.sales.previous} hint={`${o.sales.orders} pedido(s) entregue(s)`} />
      <Stat
        label="Margem realizada"
        value={margin.value}
        previous={marginPrev.value}
        signed
        estimated={estimatedOp}
        estimatedHint="Inclui energia e depreciação estimadas pelas horas de impressão (taxa combinada ou sem taxa no período)."
        hint={
          margin.pct !== null
            ? `${formatPercent(margin.pct)} da receita líquida`
            : recent && recent.margin_source === 'REALIZADA_90D' && recent.margin_pct !== null
              ? `Sem vendas no período · últimos 90 dias: ${formatPercent(recent.margin_pct)}`
              : 'Sem vendas entregues no período'
        }
        badge={o.flags.labor_not_valued && layer === 'full' ? <Badge tone="warning">trabalho não valorizado</Badge> : undefined}
      />
      {compact ? null : (
        <>
          <StockStat />
          <Stat
            label="Margem potencial"
            value={o.potential.potential_margin}
            estimated
            estimatedHint="Saldo livre × preço de referência − custo − taxas, embalagem e impostos estimados (RN-14)."
            hint={
              toNumber(o.potential.units) === 0
                ? 'Nenhuma peça pronta livre: as prontas estão reservadas para pedidos ou não há estoque'
                : o.potential.variants_without_price > 0
                  ? `${o.potential.variants_without_price} variação(ões) sem preço`
                  : `Das ${formatNumber(o.potential.units, 0)} peça(s) livres, se vendidas pelo preço de referência`
            }
          />
          <InvestmentStat investment={o.investment} />
        </>
      )}
    </section>
  );
}

/** Valor de tudo o que está em estoque pelo custo médio, por tipo de item. */
function StockStat() {
  const stock = useStockValue();
  const s = stock.data;
  if (!s) return <Skeleton className="h-24" />;
  const top = s.by_kind.slice(0, 3);
  return (
    <Stat
      label="Estoque (valor total)"
      value={s.total}
      estimated
      estimatedHint="Quantidade em estoque × custo médio de cada item (peças prontas incluem energia e depreciação estimadas)."
      hint={
        top.length === 0 ? (
          'Estoque vazio'
        ) : (
          <>
            {top.map((k, i) => (
              <span key={k.kind}>
                {i > 0 ? ' · ' : ''}
                {KIND_LABELS[k.kind as ItemKind] ?? k.kind} {formatBRL(k.value)}
              </span>
            ))}
            {toNumber(s.finished.units) > 0
              ? ` · ${formatNumber(s.finished.units, 0)} peça(s) pronta(s), ${formatNumber(s.finished.free, 0)} livre(s)`
              : ''}
          </>
        )
      }
    />
  );
}

/**
 * Quanto do investimento do dono já voltou como resultado. Antes de pagar qualquer
 * parcela, a base é o que está comprometido nas compras pagas pelo dono.
 */
function InvestmentStat({ investment: inv }: { investment: Overview['investment'] }) {
  const paid = toNumber(inv.net_investment);
  const committed = toNumber(inv.owner_committed_total);
  const base = paid > 0 ? paid : committed;
  const pct = base > 0 ? toNumber(inv.accumulated_return) / base : null;
  return (
    <Stat
      label="Investimento recuperado"
      value={pct}
      format={(v) => (v === null || v === undefined ? '—' : formatPercent(v))}
      tone={pct !== null && pct < 0 ? 'negative' : 'default'}
      hint={
        base === 0 ? (
          'Nenhum investimento do dono registrado'
        ) : (
          <>
            Retorno <Money value={inv.accumulated_return} /> de <Money value={base} /> {paid > 0 ? 'investidos' : 'comprometidos em parcelas (nada pago ainda)'}
            {inv.months_to_recover ? ` · ~${inv.months_to_recover} meses para recuperar` : ''}
          </>
        )
      }
    />
  );
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const EXPENSE_SOURCE: Record<GoalExpenseSource, string> = {
  MANUAL: 'valor previsto nas configurações',
  MEDIA_3M: 'média dos meses anteriores',
  MES: 'parcelas e contas que vencem neste mês',
  NENHUMA: 'nenhuma despesa lançada',
};

const LAYER_NAMES: Record<CostLayerView, string> = { direct: 'direta', operational: 'operacional', full: 'completa' };

const STATUS_TONE = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', muted: 'text-muted' };

function goalStatus(g: MonthlyGoal): { text: string; tone: keyof typeof STATUS_TONE } {
  const target = toNumber(g.target_revenue);
  const revenue = toNumber(g.revenue);
  if (revenue >= target) return { text: `Meta batida: ${formatBRL(revenue - target)} acima.`, tone: 'success' };
  if (g.projection === null || g.days_elapsed < 3) return { text: 'Ainda é cedo para projetar o mês.', tone: 'muted' };
  const projection = toNumber(g.projection);
  if (projection >= target) return { text: `No ritmo atual o mês fecha em ${formatBRL(projection)}: bate a meta.`, tone: 'success' };
  const breakeven = toNumber(g.breakeven_revenue);
  if (projection >= breakeven) {
    return { text: `No ritmo atual o mês fecha em ${formatBRL(projection)}: paga as despesas, mas fica ${formatBRL(target - projection)} abaixo da meta de lucro.`, tone: 'warning' };
  }
  return { text: `No ritmo atual o mês fecha em ${formatBRL(projection)}: faltariam ${formatBRL(breakeven - projection)} para pagar as despesas.`, tone: 'danger' };
}

/** Meta do mês: faturamento necessário para pagar as contas do mês (e o lucro desejado). */
function GoalBlock({ layer }: { layer: CostLayerView }) {
  const query = useMonthlyGoal(layer);
  const g = query.data;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!g) return <Skeleton className="h-56" />;
  const month = MONTH_NAMES[Number(g.month.slice(5, 7)) - 1];
  const basis = toNumber(g.expenses.basis);
  const profit = toNumber(g.profit_target);
  const pct = g.margin_pct === null ? null : toNumber(g.margin_pct);
  const target = toNumber(g.target_revenue);
  const breakeven = toNumber(g.breakeven_revenue);
  const revenue = toNumber(g.revenue);
  const scale = Math.max(target, revenue, 1);
  const expectedToday = g.days > 0 ? (target * g.days_elapsed) / g.days : 0;
  const status = g.target_revenue !== null && basis + profit > 0 ? goalStatus(g) : null;
  return (
    <Card>
      <CardHeader
        title={`Meta de ${month}`}
        description={
          pct !== null && pct > 0
            ? `Quanto faturar para pagar as contas do mês${profit > 0 ? ` e lucrar ${formatBRL(profit)}` : ''}, com margem ${LAYER_NAMES[g.layer]} de ${formatPercent(pct)}`
            : 'Quanto faturar para pagar as contas do mês'
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/configuracoes/empresa">
              <Settings2 /> Ajustar
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        {pct === null || pct <= 0 ? (
          <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            A margem {LAYER_NAMES[g.layer]} dos últimos 90 dias está em {pct === null ? '—' : formatPercent(pct)}: nenhum faturamento paga as despesas. Revise preços e custos.
          </p>
        ) : basis + profit <= 0 ? (
          <p className="flex items-start gap-2 text-sm text-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Nenhuma conta vence neste mês. Lance as despesas do mês (internet, DAS, assinaturas…) em{' '}
              <Link to="/financeiro/despesas" className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
                Financeiro → Despesas
              </Link>{' '}
              ou informe o valor previsto em Ajustar.
            </span>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted">Faturado no mês</p>
                <p className="num text-2xl font-semibold leading-tight">
                  {formatBRL(revenue)} <span className="text-base font-normal text-muted">de {formatBRL(target)}</span>
                </p>
              </div>
              <p className="num flex items-center gap-1.5 text-lg font-semibold">
                <Target className="size-4 text-muted" aria-hidden />
                {formatPercent(target > 0 ? revenue / target : 0)}
              </p>
            </div>
            <div className="relative" aria-hidden>
              <div className="h-3 overflow-hidden rounded-full bg-subtle">
                <div
                  className={cn('h-full rounded-full', revenue >= target ? 'bg-success' : 'bg-accent')}
                  style={{ width: `${Math.min(100, (revenue / scale) * 100)}%` }}
                />
              </div>
              {g.days_left > 0 ? (
                <span className="absolute -top-1 h-5 w-0.5 rounded bg-ink" style={{ left: `${Math.min(100, (expectedToday / scale) * 100)}%` }} />
              ) : null}
              {profit > 0 ? <span className="absolute -top-1 h-5 w-0.5 rounded bg-danger" style={{ left: `${Math.min(100, (breakeven / scale) * 100)}%` }} /> : null}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {g.days_left > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-0.5 rounded bg-ink" /> Esperado até hoje: {formatBRL(expectedToday)}
                </span>
              ) : null}
              {profit > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-0.5 rounded bg-danger" /> Paga as despesas: {formatBRL(breakeven)}
                </span>
              ) : null}
            </div>
            {status ? <p className={cn('text-sm font-medium', STATUS_TONE[status.tone])}>{status.text}</p> : null}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Falta faturar"
                value={g.remaining ?? 0}
                tone={toNumber(g.remaining) > 0 ? 'default' : 'positive'}
                hint={g.days_left > 0 ? `${g.days_left} dia(s) até o fim do mês` : 'Mês encerrado'}
              />
              <Stat label="Por dia" value={g.per_day ?? 0} hint="Para bater a meta, contando hoje" />
              <Stat label="Resultado do mês" value={g.result} signed hint="Margem das vendas − contas que vencem no mês" />
              <Stat
                label="Pedidos que faltam"
                value={g.orders_needed ?? 0}
                format={(v) => (g.avg_ticket === null ? '—' : formatNumber(v, 0))}
                hint={g.avg_ticket === null ? 'Sem vendas nos últimos 90 dias' : <>Ticket médio <Money value={g.avg_ticket} /> (90 dias)</>}
              />
            </div>
            <PriceSimulator marginPct={pct} needed={basis + profit} />
          </>
        )}
        <details className="rounded-lg border border-line text-sm">
          <summary className="cursor-pointer select-none px-3 py-2 font-medium">Como a meta é calculada</summary>
          <div className="space-y-3 border-t border-line px-3 py-3">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              <dt className="text-muted">Contas do mês ({EXPENSE_SOURCE[g.expenses.source]})</dt>
              <dd className="num text-right">{formatBRL(basis)}</dd>
              {profit > 0 ? (
                <>
                  <dt className="text-muted">+ Lucro desejado</dt>
                  <dd className="num text-right">{formatBRL(profit)}</dd>
                </>
              ) : null}
              <dt className="text-muted">
                ÷ Margem {LAYER_NAMES[g.layer]} ({g.margin_source === 'REALIZADA_90D' ? 'realizada nos últimos 90 dias' : 'margem alvo, sem vendas recentes'})
              </dt>
              <dd className="num text-right">{pct === null ? '—' : formatPercent(pct)}</dd>
              <dt className="font-medium">= Meta de faturamento</dt>
              <dd className="num text-right font-semibold">{g.target_revenue === null ? '—' : formatBRL(target)}</dd>
            </dl>
            <p className="text-xs text-muted">
              De cada {formatBRL(100)} vendidos, sobram {pct === null ? '—' : formatBRL(100 * Math.max(pct, 0))} depois de material, taxas, embalagem e impostos
              {g.layer === 'direct' ? '' : ', energia e depreciação'}
              {g.layer === 'full' ? ' e trabalho' : ''}: é isso que paga as contas do mês. Troque a camada no topo da página para ver a meta em outra margem.
            </p>
            {g.expenses.bills.length > 0 ? (
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 text-left font-medium">Conta do mês</th>
                    <th className="py-1 text-left font-medium">Parcela</th>
                    <th className="py-1 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {g.expenses.bills.map((b, i) => (
                    <tr key={i}>
                      <td className="py-1">
                        {b.description}
                        {b.payer === 'DONO' ? <span className="text-muted"> · pago pelo dono</span> : null}
                        {b.paid ? <span className="text-success"> · paga</span> : null}
                      </td>
                      <td className="num py-1 text-muted">{b.installment}</td>
                      <td className="num py-1 text-right">{formatBRL(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {toNumber(g.expenses.das_pending) > 0 ? (
              <p className="text-xs text-muted">Inclui o DAS do MEI ({formatBRL(g.expenses.das_pending)}) ainda não lançado neste mês.</p>
            ) : null}
          </div>
        </details>
      </div>
    </Card>
  );
}

const STAGES: Array<{ key: 'production' | 'stock' | 'reserved' | 'to_receive' | 'received'; label: string; href: string }> = [
  { key: 'production', label: 'Em produção', href: '/producao' },
  { key: 'stock', label: 'Em estoque (livre)', href: '/estoque?tipo=FINISHED_GOOD' },
  { key: 'reserved', label: 'Reservado', href: '/vendas?aba=abertos' },
  { key: 'to_receive', label: 'Vendido a receber', href: '/financeiro/receber' },
  { key: 'received', label: 'Recebido (período)', href: '/vendas?aba=concluidos' },
];

function ValuePathBlock({ from, to }: { from: string; to: string }) {
  const path = useValuePath(from, to);
  return (
    <Card>
      <CardHeader title="Caminho do valor" description="Onde está o valor do que a Wabee produz: cada peça aparece em uma única etapa." />
      {path.isError ? (
        <div className="p-4">
          <ErrorState error={path.error} onRetry={() => void path.refetch()} />
        </div>
      ) : (
        <ol className="grid grid-cols-1 divide-y divide-line sm:grid-cols-5 sm:divide-x sm:divide-y-0">
          {STAGES.map((stage, index) => {
            const s: ValueStage | undefined = path.data?.[stage.key];
            return (
              <li key={stage.key} className="relative flex flex-col gap-1 p-4">
                <span className="flex items-center gap-2 text-xs font-medium text-muted">
                  <span className="grid size-5 place-items-center rounded-full bg-accent-soft text-[0.65rem] font-bold text-accent-ink">{index + 1}</span>
                  {stage.label}
                </span>
                {s ? (
                  <>
                    <span className="num text-xl font-semibold">{formatNumber(s.pieces, 0)} <span className="text-sm font-normal text-muted">peças</span></span>
                    <span className="text-xs text-muted">
                      Custo <Money value={s.cost} estimated={stage.key !== 'to_receive' && stage.key !== 'received'} hint="Custo médio (inclui operacional estimado)" />
                    </span>
                    <span className="text-xs text-muted">
                      Valor <Money value={s.sale_value} estimated={stage.key === 'production' || stage.key === 'stock'} hint="Pelo preço de referência" />
                    </span>
                    {stage.key === 'stock' && toNumber(s.stale_30d) > 0 ? (
                      <Badge tone="warning" className="mt-1 self-start">
                        {formatNumber(s.stale_30d, 0)} parada(s) há +30 dias
                      </Badge>
                    ) : null}
                    <Link to={stage.href} className="mt-1 text-xs font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
                      ver peças
                    </Link>
                  </>
                ) : (
                  <Skeleton className="h-12" />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function NowPrintingBlock() {
  const now = useNowPrinting();
  const data = now.data;
  return (
    <Card>
      <CardHeader
        title="Agora na impressora"
        description={data ? `${data.printing.length} imprimindo · ${data.queue.length} na fila de hoje · ${formatNumber(data.finishing, 0)} peça(s) em acabamento` : undefined}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/producao">
              <Printer /> Produção
            </Link>
          </Button>
        }
      />
      <div className="p-4">
        {!data ? (
          <Skeleton className="h-16" />
        ) : data.printing.length === 0 && data.queue.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma impressão em andamento ou planejada para hoje.</p>
        ) : (
          <ul className="space-y-2">
            {data.printing.map((job) => (
              <li key={job.id}>
                <Link to={`/producao/impressoes/${job.id}`} className="flex items-center gap-3 rounded-lg border border-line p-3 hover:border-ink">
                  <span className="relative flex size-2.5 shrink-0">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {job.code} · {job.equipment_name}
                    </span>
                    <span className="block truncate text-xs text-muted">{job.outputs_summary}</span>
                  </span>
                  <span className="text-right text-xs text-muted">
                    termina
                    <br />
                    <span className="font-medium text-ink">{formatDateTimeBR(job.expected_end).slice(11)}</span>
                  </span>
                </Link>
              </li>
            ))}
            {data.queue.map((job) => (
              <li key={job.id}>
                <Link to={`/producao/impressoes/${job.id}`} className="flex items-center gap-3 rounded-lg border border-dashed border-line-strong p-3 hover:border-ink">
                  <span className="size-2.5 shrink-0 rounded-full border-2 border-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {job.code} · {job.equipment_name}
                    </span>
                    <span className="block truncate text-xs text-muted">{job.outputs_summary}</span>
                  </span>
                  <span className="text-xs text-muted">{formatMinutes(job.est_minutes)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Charts({ from, to, layer }: { from: string; to: string; layer: CostLayerView }) {
  const days = diffInDays(to, from) + 1;
  const grain: 'day' | 'week' | 'month' = days <= 31 ? (days <= 10 ? 'day' : 'week') : 'month';
  const series = useSalesSeries(from, to, grain);
  const projection = useCashProjection(12);
  const top = useTopProducts(from, to);
  const buckets = series.data ?? [];
  const marginKey = layer === 'direct' ? 'margin_direct' : layer === 'full' ? 'margin_full' : 'margin_operational';
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Vendas × margem" description="Receita líquida e margem de contribuição na camada escolhida" />
        <div className="p-4">
          <ColumnChart
            ariaLabel="Vendas e margem por período"
            stacked={false}
            data={buckets.map((b) => ({
              label: bucketLabel(b.bucket, grain),
              fullLabel: grain === 'month' ? bucketLabel(b.bucket, 'month') : `${grain === 'week' ? 'Semana de ' : ''}${formatDateBR(b.bucket)}`,
              values: { revenue: toNumber(b.net_revenue), margin: toNumber(b[marginKey]) },
            }))}
            series={[
              { key: 'revenue', label: 'Receita líquida', color: 'var(--color-layer-material)' },
              { key: 'margin', label: 'Margem', color: 'var(--color-ink)', kind: 'line' },
            ]}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Composição do custo das peças vendidas" description="CMV por camada" />
        <div className="p-4">
          <ColumnChart
            ariaLabel="Composição do custo das peças vendidas por camada"
            data={buckets.map((b) => ({
              label: bucketLabel(b.bucket, grain),
              fullLabel: formatDateBR(b.bucket),
              values: {
                material: toNumber(b.cmv_material),
                energy: toNumber(b.cmv_energy),
                depreciation: toNumber(b.cmv_depreciation),
                operational: toNumber(b.cmv_operational),
                labor: toNumber(b.cmv_labor),
              },
            }))}
            series={COST_LAYERS.map((l) => ({ ...l }))}
            footnote="Energia, depreciação e operacional são estimados pelas horas de impressão."
          />
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Caixa projetado"
          description={projection.data?.first_negative_month ? `Atenção: saldo negativo em ${bucketLabel(projection.data.first_negative_month, 'month')}` : 'Próximos 12 meses (contas da empresa)'}
        />
        <div className="p-4">
          <ColumnChart
            ariaLabel="Caixa projetado nos próximos 12 meses"
            stacked={false}
            data={(projection.data?.months ?? []).map((m) => ({
              label: bucketLabel(m.month, 'month'),
              values: { closing: toNumber(m.closing), owner: toNumber(m.owner_paid) },
            }))}
            series={[
              { key: 'closing', label: 'Saldo previsto da empresa', color: 'var(--color-layer-material)', kind: 'line', dashed: true },
              { key: 'owner', label: 'Parcelas pagas pelo dono', color: 'var(--color-layer-energy)', kind: 'line' },
            ]}
            footnote="Parcelas pagas pelo dono não saem do caixa da empresa: aparecem só como compromisso dele."
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Top 5 produtos" description="Por margem por hora de máquina no período" />
        <div className="p-4">
          {!top.data ? (
            <Skeleton className="h-32" />
          ) : top.data.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma venda entregue no período.</p>
          ) : (
            <ol className="divide-y divide-line">
              {top.data.map((p, index) => (
                <li key={p.variant_id} className="flex items-center gap-3 py-2">
                  <span className="num w-5 text-sm font-semibold text-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="text-xs text-muted">
                      {formatNumber(p.units, 0)} un · margem <Money value={p.margin} />
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="num block text-sm font-semibold">{p.mhm === null ? '—' : `${formatBRL(p.mhm)}/h`}</span>
                    <span className="text-xs text-muted">por hora de máquina</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </div>
  );
}

export function DashboardPage() {
  const { can, settings } = useMember();
  const [range, setRange] = useDateRange('mes');
  const [layer, setLayer] = useCostLayer();
  const [prefs, setPrefs] = useLayoutPrefs();
  const finance = can('costs');
  const render: Record<BlockId, () => ReactNode> = {
    resumo: () => <WeeklySummaryBlock />,
    meta: () => <GoalBlock layer={layer} />,
    indicadores: () => <Indicators from={range.from} to={range.to} layer={layer} compact={prefs.compact} />,
    caminho: () => <ValuePathBlock from={range.from} to={range.to} />,
    impressora: () => <NowPrintingBlock />,
    carteira: () => <BacklogBlock />,
    retirada: () => <WithdrawalBlock />,
    orcamentos: () => <QuotesBlock from={range.from} to={range.to} />,
    produtos: () => <ProductMixBlock from={range.from} to={range.to} />,
    entregas: () => <DeliveryBlock from={range.from} to={range.to} />,
    comparar: () => <CompareBlock range={range} />,
    graficos: () => <Charts from={range.from} to={range.to} layer={layer} />,
  };
  return (
    <Page>
      <PageHeader
        title="Visão geral"
        description={settings.company_name}
        actions={
          finance ? (
            <div className="flex flex-wrap items-center gap-2">
              <CostLayerSelector value={layer} onChange={setLayer} />
              <CustomizeDialog prefs={prefs} onChange={setPrefs} />
            </div>
          ) : undefined
        }
      />
      {finance ? <PeriodPresets range={range} onChange={setRange} className="mb-5" /> : null}
      <OnboardingCallout />
      <Alerts finance={finance} />
      {finance ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {visibleBlocks(prefs).map((id) => (
            <div key={id} className={cn('min-w-0', !(BLOCKS.find((b) => b.id === id)?.half && !prefs.compact) && 'xl:col-span-2')}>
              {render[id]()}
            </div>
          ))}
        </div>
      ) : (
        <NowPrintingBlock />
      )}
    </Page>
  );
}
