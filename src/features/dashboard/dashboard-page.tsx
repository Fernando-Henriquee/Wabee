import { AlertTriangle, ArrowRight, CircleAlert, Info, Printer, Sparkles } from 'lucide-react';
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
  type MarginBlock,
  useAlerts,
  useCashProjection,
  useNowPrinting,
  useOverview,
  useSalesSeries,
  useTopProducts,
  useValuePath,
  type ValueStage,
} from '@/data/dashboard';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { diffInDays, formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { formatBRL, formatMinutes, formatNumber, formatPercent, toNumber } from '@/lib/money';
import { pendingStepsFromState } from '@/features/onboarding/onboarding-logic';

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

function Alerts() {
  const alerts = useAlerts();
  if (!alerts.data || alerts.data.length === 0) return null;
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

function Indicators({ from, to, layer }: { from: string; to: string; layer: CostLayerView }) {
  const overview = useOverview(from, to);
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  if (!o) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
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
        hint={margin.pct !== null ? `${formatPercent(margin.pct)} da receita líquida` : undefined}
        badge={o.flags.labor_not_valued && layer === 'full' ? <Badge tone="warning">trabalho não valorizado</Badge> : undefined}
      />
      <Stat
        label="Estoque pronto"
        value={o.finished_stock.cost}
        estimated
        estimatedHint="Custo médio das peças livres (inclui operacional estimado)."
        hint={
          <>
            {formatNumber(o.finished_stock.units, 0)} peça(s) · vale <Money value={o.finished_stock.sale_value} estimated hint="Preço de referência do canal padrão" />
          </>
        }
      />
      <Stat
        label="Margem potencial"
        value={o.potential.potential_margin}
        estimated
        estimatedHint="Saldo livre × preço de referência − custo − taxas, embalagem e impostos estimados (RN-14)."
        hint={o.potential.variants_without_price > 0 ? `${o.potential.variants_without_price} variação(ões) sem preço` : 'Do estoque livre'}
      />
      <Stat
        label="Investimento recuperado"
        value={o.investment.recovered_pct}
        format={(v) => (v === null || v === undefined ? '—' : formatPercent(v))}
        hint={
          <>
            de <Money value={o.investment.net_investment} /> investidos
            {o.investment.months_to_recover ? ` · ~${o.investment.months_to_recover} meses para recuperar` : ''}
          </>
        }
      />
    </section>
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
    <Card className="mb-5">
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
  const finance = can('costs');
  return (
    <Page>
      <PageHeader
        title="Visão geral"
        description={settings.company_name}
        actions={finance ? <CostLayerSelector value={layer} onChange={setLayer} /> : undefined}
      />
      {finance ? <PeriodPresets range={range} onChange={setRange} className="mb-5" /> : null}
      <OnboardingCallout />
      <Alerts />
      {finance ? (
        <>
          <Indicators from={range.from} to={range.to} layer={layer} />
          <div className="mt-5">
            <ValuePathBlock from={range.from} to={range.to} />
          </div>
          <div className="mb-5">
            <NowPrintingBlock />
          </div>
          <Charts from={range.from} to={range.to} layer={layer} />
        </>
      ) : (
        <NowPrintingBlock />
      )}
    </Page>
  );
}
