import { AlertTriangle, ArrowLeft, ClipboardCheck, Copy, Play, Repeat, RotateCcw, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LayerBar } from '@/components/charts/chart';
import { Page, PageHeader } from '@/components/layout/page';
import { ColorDot } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/states';
import {
  FAILURE_REASON_LABELS,
  POST_PROCESS_LABELS,
  type PrintJobOutputRow,
  type PrintJobRow,
  RATE_MODE_LABELS,
  useJobMaterials,
  useJobOutputs,
  usePostProcessEntries,
  usePrintJob,
  useReplanPrintJob,
  useReversePrintJob,
} from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatDateTimeBR } from '@/lib/dates';
import { formatCost, formatMinutes, formatNumber, formatQty, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { Info, JobProgress, JobStatusBadge, Notice, OutputStatusBadge } from './bits';
import { FinishingDialog, UnitCostLayers } from './finishing-dialog';
import { describeProgress, elapsedMinutes } from './helpers';
import { CancelJobDialog, FailJobDialog, FinishJobDialog, StartJobDialog } from './job-dialogs';
import { useNow } from './use-now';

type Action = 'start' | 'finish' | 'fail' | 'cancel' | 'reverse' | null;

export function JobDetailPage() {
  const { id } = useParams();
  const jobId = Number(id);
  const job = usePrintJob(jobId);
  if (job.isError) return <Page><ErrorState error={job.error} onRetry={() => void job.refetch()} /></Page>;
  if (job.data === undefined) return <Page><LoadingBlock /></Page>;
  if (job.data === null)
    return (
      <Page>
        <EmptyState title="Impressão não encontrada" action={<Button asChild variant="outline"><Link to="/producao">Voltar à produção</Link></Button>} />
      </Page>
    );
  return <JobDetail job={job.data} />;
}

function JobDetail({ job }: { job: PrintJobRow }) {
  const { can, settings } = useMember();
  const showCosts = can('costs');
  const navigate = useNavigate();
  const now = useNow(30_000);
  const outputs = useJobOutputs(job.id);
  const materials = useJobMaterials(job.id);
  const entries = usePostProcessEntries((outputs.data ?? []).map((o) => o.id));
  const [action, setAction] = useState<Action>(null);
  const [finishing, setFinishing] = useState<PrintJobOutputRow | null>(null);
  const [replanId, renewReplan] = useRequestId();
  const [reverseId, renewReverse] = useRequestId();
  const replan = useReplanPrintJob((r) => {
    renewReplan();
    navigate(`/producao/impressoes/${r.print_job_id}`);
  });
  const reverse = useReversePrintJob(() => {
    renewReverse();
    setAction(null);
  });

  const closed = job.status === 'CONCLUIDA' || job.status === 'FALHOU' || job.status === 'ESTORNADA';
  const elapsed = job.status === 'IMPRIMINDO' ? elapsedMinutes(job.started_at, now) : null;
  const tz = settings.timezone;
  const dialogOpen = (kind: Action) => ({ open: action === kind, onOpenChange: (o: boolean) => !o && setAction(null) });

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/producao" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Produção
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-2.5">
            {job.code} <JobStatusBadge status={job.status} className="font-sans text-sm" />
          </span>
        }
        description={
          <span>
            {job.equipment_name} · {job.outputs_summary}
          </span>
        }
        actions={
          can('production') ? (
            <>
              {job.status === 'PLANEJADA' ? (
                <>
                  <Button variant="outline" onClick={() => setAction('cancel')}>
                    <XCircle /> Cancelar
                  </Button>
                  <Button variant="outline" onClick={() => setAction('finish')}>
                    <ClipboardCheck /> Já imprimiu: finalizar
                  </Button>
                  <Button size="lg" onClick={() => setAction('start')}>
                    <Play /> Iniciar
                  </Button>
                </>
              ) : null}
              {job.status === 'IMPRIMINDO' ? (
                <>
                  <Button variant="outline" onClick={() => setAction('cancel')}>
                    <XCircle /> Cancelar
                  </Button>
                  <Button variant="danger-outline" onClick={() => setAction('fail')}>
                    <AlertTriangle /> Falha total
                  </Button>
                  <Button size="lg" onClick={() => setAction('finish')}>
                    <ClipboardCheck /> Finalizar
                  </Button>
                </>
              ) : null}
              {job.status === 'CONCLUIDA' || job.status === 'FALHOU' ? (
                <>
                  {can('write') ? (
                    <Button variant="danger-outline" onClick={() => setAction('reverse')}>
                      <RotateCcw /> Estornar
                    </Button>
                  ) : null}
                  <Button variant={job.status === 'FALHOU' ? 'primary' : 'outline'} onClick={() => replan.mutate({ requestId: replanId, jobId: job.id })} loading={replan.isPending}>
                    {job.status === 'FALHOU' ? <Repeat /> : <Copy />} {job.status === 'FALHOU' ? 'Replanejar' : 'Repetir impressão'}
                  </Button>
                </>
              ) : null}
            </>
          ) : undefined
        }
      />

      {job.status === 'IMPRIMINDO' ? (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">Imprimindo desde {formatDateTimeBR(job.started_at, tz)}</p>
            <p className="text-sm text-muted">
              Previsão de término <strong className="num text-ink">{formatDateTimeBR(job.expected_end, tz)}</strong>
            </p>
          </div>
          <JobProgress elapsed={elapsed} estimated={job.est_minutes} className="mt-3 h-3" />
          <p className="num mt-1.5 text-xs text-muted">{describeProgress(elapsed, job.est_minutes)}</p>
        </Card>
      ) : null}
      {job.status === 'ESTORNADA' ? (
        <Notice tone="warning" icon={<RotateCcw />} className="mb-4">
          Estornada em {formatDateTimeBR(job.reversed_at, tz)}: {job.reverse_reason}. Consumos, peças e custos desta impressão foram revertidos.
        </Notice>
      ) : null}
      {job.status === 'FALHOU' ? (
        <Notice tone="danger" icon={<AlertTriangle />} className="mb-4">
          Falha total{job.failure_reason ? `: ${FAILURE_REASON_LABELS[job.failure_reason]}` : ''}.{job.failure_notes ? ` ${job.failure_notes}` : ''} O filamento gasto foi baixado e o custo foi para falhas.
        </Notice>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Peças"
          value={closed ? job.qty_good : job.qty_planned}
          format={(v) => `${formatNumber(v, 0)} ${closed ? 'boa(s)' : 'planejada(s)'}`}
          tone={closed && job.qty_failed > 0 ? 'warning' : 'default'}
          hint={closed ? `${job.qty_failed} com falha de ${job.qty_planned}` : undefined}
        />
        <Stat
          label={closed ? 'Tempo de máquina' : 'Tempo previsto'}
          value={closed ? job.actual_minutes : job.est_minutes}
          format={(v) => formatMinutes(v)}
          hint={closed ? `Previsto ${formatMinutes(job.est_minutes)}${job.time_estimated ? ' · tempo real não informado' : ''}` : undefined}
        />
        <Stat
          label={closed ? 'Filamento usado' : 'Filamento previsto'}
          value={closed ? job.actual_grams : job.est_grams}
          format={(v) => formatQty(v, 'G')}
          hint={closed ? `Previsto ${formatQty(job.est_grams, 'G')}` : 'Modelo + suporte + purga'}
        />
        {showCosts ? (
          closed ? (
            <Stat label="Custo da impressão" value={job.cost_total} hint={toNumber(job.cost_scrap) > 0 ? <span className="text-danger">Falhas: {formatCost(job.cost_scrap, 2)}</span> : 'Sem custo de falhas'} />
          ) : (
            <Stat label="Custo" value={null} format={() => 'ao finalizar'} hint="Calculado com o consumo real e a taxa do dia" />
          )
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Peças da mesa" description={closed ? 'Boas, falhas e o que entrou no estoque.' : 'Quantidades planejadas.'} />
            {!outputs.data ? (
              <div className="p-4">
                <Skeleton className="h-20" />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {outputs.data.map((o) => {
                  const list = (entries.data ?? []).filter((e) => e.output_id === o.id);
                  return (
                    <li key={o.id} className="space-y-2 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{o.variant_name}</p>
                          <p className="text-xs text-muted">
                            {o.variant_sku} · {o.qty_planned} planejada(s)
                            {o.est_weight_g_per_unit ? ` · ${formatQty(o.est_weight_g_per_unit, 'G')}/un previsto` : ''}
                            {!o.bom_version_id ? ' · sem ficha técnica' : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {o.status ? <OutputStatusBadge status={o.status} /> : <Badge tone="neutral">{o.needs_finishing ? 'terá acabamento' : 'direto para o estoque'}</Badge>}
                        </div>
                      </div>
                      {o.qty_good !== null ? (
                        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                          <Info label="Boas" value={<span className="num">{o.qty_good}</span>} />
                          <Info
                            label="Com falha"
                            value={
                              <span className={cn('num', toNumber(o.qty_failed) > 0 && 'text-danger')}>
                                {o.qty_failed}
                                {o.failure_reason ? <span className="block text-xs font-normal">{FAILURE_REASON_LABELS[o.failure_reason]}</span> : null}
                              </span>
                            }
                          />
                          <Info label="No estoque" value={<span className="num">{o.qty_released ?? '—'}</span>} />
                          <Info
                            label="Reprovadas no acabamento"
                            value={
                              <span className={cn('num', o.qty_rejected > 0 && 'text-danger')}>
                                {o.qty_rejected}
                                {o.reject_reason ? <span className="block text-xs font-normal">{o.reject_reason}</span> : null}
                              </span>
                            }
                          />
                        </dl>
                      ) : null}
                      {list.length > 0 ? (
                        <p className="text-xs text-muted">
                          <Wrench className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
                          Acabamento: {list.map((e) => `${POST_PROCESS_LABELS[e.kind]} ${formatMinutes(e.minutes)}`).join(' · ')}
                        </p>
                      ) : null}
                      {showCosts && o.qty_good !== null ? (
                        <div className="space-y-2 rounded-lg bg-subtle p-3 text-xs text-ink-soft">
                          <p>
                            Parte da mesa <Money value={o.alloc_total} cost className="font-medium text-ink" /> ({formatNumber(toNumber(o.allocation_share) * 100, 1)}% pelo peso) · impressão por unidade{' '}
                            <Money value={o.print_unit_cost} cost className="font-medium text-ink" />
                            {toNumber(o.scrap_cost) > 0 ? (
                              <>
                                {' '}
                                · falhas <Money value={o.scrap_cost} cost className="text-danger" />
                              </>
                            ) : null}
                          </p>
                          {o.status === 'LIBERADA' && o.unit_total !== null ? <UnitCostLayers output={o} /> : null}
                        </div>
                      ) : null}
                      {o.status === 'AGUARDANDO_ACABAMENTO' && can('production') ? (
                        <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setFinishing(o)}>
                          <Wrench /> Acabamento e liberar
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Filamento" description={closed ? 'Consumo real baixado dos carretéis.' : 'Previsto pela ficha (ou informado no planejamento).'} />
            {!materials.data ? (
              <div className="p-4">
                <Skeleton className="h-12" />
              </div>
            ) : materials.data.length === 0 ? (
              <p className="p-4 text-sm text-muted">Sem filamento registrado.</p>
            ) : (
              <ul className="divide-y divide-line">
                {materials.data.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                    <ColorDot hex={m.color_hex} className="size-4" />
                    <span className="min-w-0 flex-1">
                      <Link to={`/estoque/itens/${m.item_id}`} className="font-medium underline-offset-2 hover:underline">
                        {m.item_name}
                      </Link>
                      {m.lot_code ? <span className="block text-xs text-muted">Carretel {m.lot_code}</span> : null}
                    </span>
                    <span className="num text-right">
                      {m.actual_g !== null ? formatQty(m.actual_g, 'G') : formatQty(m.est_g, 'G')}
                      <span className="block text-xs text-muted">{m.actual_g !== null ? `previsto ${formatQty(m.est_g, 'G')}` : 'previsto'}</span>
                    </span>
                    {showCosts && m.cost_total !== null ? (
                      <span className="w-24 text-right">
                        <Money value={m.cost_total} />
                        <span className="block text-xs text-muted">{formatCost(toNumber(m.unit_cost_snapshot) * 1000, 2)}/kg</span>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {showCosts && closed ? (
            <Card>
              <CardHeader title="Composição do custo" />
              <div className="space-y-3 p-4">
                <LayerBar
                  values={{
                    material: toNumber(job.cost_material),
                    energy: toNumber(job.cost_energy),
                    depreciation: toNumber(job.cost_depreciation),
                    operational: toNumber(job.cost_operational),
                    labor: toNumber(job.cost_labor),
                  }}
                />
                <p className="text-xs text-muted">
                  {job.rate_mode ? `${RATE_MODE_LABELS[job.rate_mode]} na data do término.` : ''} Material = gramas × custo médio do filamento; operacional = horas × taxa por hora.
                  Trabalho vem dos minutos de acabamento. Peças com falha ou reprovadas viram custo de falhas.
                </p>
                {job.missing_rates ? <p className="text-xs text-warning">Não havia taxa por hora vigente: o custo operacional ficou zero.</p> : null}
              </div>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Linha do tempo" />
            <dl className="space-y-3 p-4 text-sm">
              <Info label="Planejada para" value={formatDateTimeBR(job.planned_for, tz)} />
              <Info label="Início" value={formatDateTimeBR(job.started_at, tz)} />
              <Info label={job.status === 'IMPRIMINDO' ? 'Previsão de término' : 'Término'} value={formatDateTimeBR(job.status === 'IMPRIMINDO' ? job.expected_end : job.finished_at, tz)} />
              <Info label="Criada em" value={formatDateTimeBR(job.created_at, tz)} />
              {job.replanned_from_id ? (
                <Info
                  label="Repetição de"
                  value={
                    <Link to={`/producao/impressoes/${job.replanned_from_id}`} className="underline decoration-accent decoration-2 underline-offset-2">
                      Impressão anterior
                    </Link>
                  }
                />
              ) : null}
              {job.sales_order_id ? (
                <Info
                  label="Pedido"
                  value={
                    <Link to={`/vendas/${job.sales_order_id}`} className="underline decoration-accent decoration-2 underline-offset-2">
                      Pedido nº {job.sales_order_id}
                    </Link>
                  }
                />
              ) : null}
              {job.notes ? <Info label="Observações" value={<span className="whitespace-pre-line font-normal">{job.notes}</span>} /> : null}
              {job.failure_notes && job.status !== 'FALHOU' ? <Info label="Notas da finalização" value={<span className="font-normal">{job.failure_notes}</span>} /> : null}
            </dl>
          </Card>
        </div>
      </div>

      <StartJobDialog job={job} {...dialogOpen('start')} />
      <FinishJobDialog job={job} {...dialogOpen('finish')} />
      <FailJobDialog job={job} {...dialogOpen('fail')} onReplanned={(newId) => navigate(`/producao/impressoes/${newId}`)} />
      <CancelJobDialog job={job} {...dialogOpen('cancel')} />
      <ReasonDialog
        open={action === 'reverse'}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Estornar ${job.code}?`}
        description="Devolve o filamento aos carretéis, retira do estoque as peças liberadas, devolve componentes e desfaz os custos de falha — tudo numa transação. Fica bloqueado se alguma peça desta impressão já foi entregue ou reservada."
        confirmLabel="Estornar impressão"
        onConfirm={(reason) => reverse.mutateAsync({ requestId: reverseId, jobId: job.id, reason })}
      />
      {finishing ? <FinishingDialog output={finishing} open onOpenChange={(o) => !o && setFinishing(null)} /> : null}
    </Page>
  );
}
