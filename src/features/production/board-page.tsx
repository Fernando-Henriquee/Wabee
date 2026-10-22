import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Cpu, Gauge, MoreHorizontal, Play, Plus, Printer, Wrench, XCircle } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger, Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { ErrorState, LoadingBlock, Skeleton } from '@/components/ui/states';
import {
  FAILURE_REASON_LABELS,
  type PrintJobOutputRow,
  type PrintJobRow,
  type PrintJobStatus,
  useBoardJobs,
  useFinishingQueue,
  useJobHistory,
} from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatMinutes, toNumber } from '@/lib/money';
import { JobMobileCard, JobProgress, JobStatusBadge, Notice } from './bits';
import { FinishingDialog } from './finishing-dialog';
import { describeProgress, elapsedMinutes, formatTimeBR, formatWhen } from './helpers';
import { CancelJobDialog, FailJobDialog, FinishJobDialog, StartJobDialog } from './job-dialogs';
import { historyExportColumns, useHistoryColumns } from './job-table';
import { useNow } from './use-now';

type SectionKey = 'PLANEJADA' | 'IMPRIMINDO' | 'ACABAMENTO' | 'HOJE';
type JobAction = { kind: 'start' | 'finish' | 'fail' | 'cancel'; job: PrintJobRow };

const SECTION_KEYS: SectionKey[] = ['PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO', 'HOJE'];

export function BoardPage() {
  const { can } = useMember();
  const [params, setParams] = useSearchParams();
  const view = params.get('aba') === 'historico' ? 'historico' : 'quadro';
  const setView = (next: string) => {
    const updated = new URLSearchParams();
    if (next === 'historico') updated.set('aba', 'historico');
    setParams(updated, { replace: true });
  };
  return (
    <Page>
      <PageHeader
        title="Produção"
        description="Planeje as mesas, acompanhe a impressora e registre o que saiu."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/producao/equipamentos">
                <Cpu /> Equipamentos
              </Link>
            </Button>
            {can('costs') ? (
              <Button asChild variant="outline">
                <Link to="/producao/taxas">
                  <Gauge /> Taxas
                </Link>
              </Button>
            ) : null}
            {can('production') ? (
              <Button asChild>
                <Link to="/producao/impressoes/nova">
                  <Plus /> Nova impressão
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs value={view} onValueChange={setView}>
        <TabsList className="mb-4">
          <TabsTrigger value="quadro">Quadro</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'quadro' ? <Board /> : <History />}
    </Page>
  );
}

// -----------------------------------------------------------------------------
// Quadro (US-5.8)
// -----------------------------------------------------------------------------

function Board() {
  const { today, can, settings } = useMember();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const now = useNow(30_000);
  const jobs = useBoardJobs(`${today()}T00:00:00-03:00`);
  const finishing = useFinishingQueue();
  const [action, setAction] = useState<JobAction | null>(null);
  const [output, setOutput] = useState<PrintJobOutputRow | null>(null);

  const planned = (jobs.data?.active ?? []).filter((j) => j.status === 'PLANEJADA');
  const printing = (jobs.data?.active ?? []).filter((j) => j.status === 'IMPRIMINDO');
  const done = jobs.data?.done ?? [];
  const queue = finishing.data ?? [];
  const busy = new Map(printing.map((j) => [j.equipment_id, j.code]));

  const requested = params.get('status');
  const focus = requested === 'IMPRIMINDO';
  const selected: SectionKey = SECTION_KEYS.includes(requested as SectionKey)
    ? (requested as SectionKey)
    : printing.length > 0
      ? 'IMPRIMINDO'
      : planned.length > 0
        ? 'PLANEJADA'
        : queue.length > 0
          ? 'ACABAMENTO'
          : 'HOJE';
  const select = (key: SectionKey) => {
    const updated = new URLSearchParams(params);
    updated.set('status', key);
    setParams(updated, { replace: true });
  };

  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  if (!jobs.data) return <LoadingBlock />;

  const sections: Array<{ key: SectionKey; label: string; count: number; content: ReactNode }> = [
    {
      key: 'PLANEJADA',
      label: 'Planejadas',
      count: planned.length,
      content:
        planned.length === 0 ? (
          <ColumnEmpty>Nenhuma mesa planejada.{can('production') ? ' Toque em “Nova impressão”.' : ''}</ColumnEmpty>
        ) : (
          planned.map((job) => (
            <JobCard key={job.id} job={job}>
              <p className="text-xs text-muted">
                <CalendarClock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
                {formatMinutes(job.est_minutes)} · para {formatWhen(job.planned_for, today(), settings.timezone)}
              </p>
              {busy.has(job.equipment_id) ? <p className="text-xs text-warning">Impressora ocupada com {busy.get(job.equipment_id)}.</p> : null}
              {can('production') ? (
                <div className="mt-3 flex gap-2">
                  <Button className="h-11 flex-1" onClick={() => setAction({ kind: 'start', job })}>
                    <Play /> Iniciar
                  </Button>
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="outline" size="icon" className="size-11" aria-label={`Mais ações de ${job.code}`}>
                        <MoreHorizontal />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => setAction({ kind: 'finish', job })}>
                        <ClipboardCheck /> Já imprimiu: finalizar
                      </MenuItem>
                      <MenuItem tone="danger" onSelect={() => setAction({ kind: 'cancel', job })}>
                        <XCircle /> Cancelar
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
              ) : null}
            </JobCard>
          ))
        ),
    },
    {
      key: 'IMPRIMINDO',
      label: 'Imprimindo',
      count: printing.length,
      content:
        printing.length === 0 ? (
          <ColumnEmpty>Nenhuma impressão em andamento.</ColumnEmpty>
        ) : (
          printing.map((job) => {
            const elapsed = elapsedMinutes(job.started_at, now);
            return (
              <JobCard key={job.id} job={job} highlight={focus}>
                <JobProgress elapsed={elapsed} estimated={job.est_minutes} className="mt-1" />
                <p className="num text-xs text-muted">{describeProgress(elapsed, job.est_minutes)}</p>
                <p className="text-xs text-muted">
                  Começou {formatWhen(job.started_at, today(), settings.timezone)} · termina ~{formatTimeBR(job.expected_end, settings.timezone)}
                </p>
                {can('production') ? (
                  <div className="mt-3 flex gap-2">
                    <Button size="lg" className={cn('flex-1', focus && 'ring-2 ring-accent ring-offset-2')} onClick={() => setAction({ kind: 'finish', job })}>
                      <ClipboardCheck /> Finalizar
                    </Button>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="outline" size="icon" className="size-12" aria-label={`Mais ações de ${job.code}`}>
                          <MoreHorizontal />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem onSelect={() => setAction({ kind: 'fail', job })}>
                          <AlertTriangle /> Falha total
                        </MenuItem>
                        <MenuItem tone="danger" onSelect={() => setAction({ kind: 'cancel', job })}>
                          <XCircle /> Cancelar
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                ) : null}
              </JobCard>
            );
          })
        ),
    },
    {
      key: 'ACABAMENTO',
      label: 'Aguardando acabamento',
      count: queue.length,
      content: !finishing.data ? (
        <Skeleton className="h-24" />
      ) : queue.length === 0 ? (
        <ColumnEmpty>Nada na fila de acabamento.</ColumnEmpty>
      ) : (
        queue.map((o) => (
          <article key={o.id} className="rounded-[var(--radius-card)] border border-line bg-panel p-3 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold">{o.variant_name}</p>
              <Badge tone="info" className="num">
                {o.qty_good} un
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              <Link to={`/producao/impressoes/${o.print_job_id}`} className="underline-offset-2 hover:underline">
                {o.print_job_code}
              </Link>{' '}
              · terminou {formatWhen(o.finished_at, today(), settings.timezone)}
            </p>
            <p className="text-xs text-muted">
              <Wrench className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              {o.post_process_minutes > 0 ? `${formatMinutes(o.post_process_minutes)} de acabamento registrados` : 'Sem trabalho registrado'}
            </p>
            {can('production') ? (
              <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => setOutput(o)}>
                <Wrench /> Acabamento e liberar
              </Button>
            ) : null}
          </article>
        ))
      ),
    },
    {
      key: 'HOJE',
      label: 'Concluídas hoje',
      count: done.length,
      content:
        done.length === 0 ? (
          <ColumnEmpty>Nenhuma impressão terminou hoje.</ColumnEmpty>
        ) : (
          done.map((job) => (
            <JobCard key={job.id} job={job} showStatus>
              <p className="num text-xs text-muted">
                {job.qty_good} boa(s){job.qty_failed > 0 ? ` · ${job.qty_failed} falha(s)` : ''} · {formatMinutes(job.actual_minutes)} · {formatTimeBR(job.finished_at, settings.timezone)}
              </p>
              {job.failure_reason ? <p className="text-xs text-danger">{FAILURE_REASON_LABELS[job.failure_reason]}</p> : null}
              {can('costs') ? (
                <p className="text-xs text-muted">
                  Custo <Money value={job.cost_total} className="font-medium text-ink" />
                  {toNumber(job.cost_scrap) > 0 ? (
                    <>
                      {' '}
                      · falhas <Money value={job.cost_scrap} className="text-danger" />
                    </>
                  ) : null}
                </p>
              ) : null}
            </JobCard>
          ))
        ),
    },
  ];

  return (
    <>
      {focus ? (
        <Notice tone="info" icon={<ClipboardCheck />} className="mb-4">
          {printing.length > 0 ? 'Toque em “Finalizar” na impressão que terminou: tempo, gramas, peças boas e falhas numa tela só.' : 'Nenhuma impressão em andamento agora.'}
        </Notice>
      ) : null}

      <div role="radiogroup" aria-label="Etapa do quadro" className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={selected === s.key}
            onClick={() => select(s.key)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium',
              selected === s.key ? 'border-ink bg-ink text-brand-fg' : 'border-line-strong bg-panel text-ink-soft',
            )}
          >
            {s.label}
            <span className={cn('num rounded-full px-1.5 text-xs', selected === s.key ? 'bg-brand-fg/20' : 'bg-subtle')}>{s.count}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {sections.map((s) => (
          <section
            key={s.key}
            aria-label={s.label}
            className={cn(
              selected === s.key ? 'block' : 'hidden',
              'rounded-[var(--radius-card)] lg:block lg:border lg:border-line lg:bg-subtle/60 lg:p-2.5',
              focus && s.key === 'IMPRIMINDO' && 'lg:border-accent lg:bg-accent-soft/50',
            )}
          >
            <h2 className="mb-2 hidden items-center justify-between px-0.5 text-sm font-semibold lg:flex">
              {s.label}
              <span className="num rounded-full bg-panel px-2 text-xs font-medium text-muted">{s.count}</span>
            </h2>
            <div className="space-y-2">{s.content}</div>
          </section>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted">
        Peças cuja ficha tem montagem de componentes ou minutos de acabamento esperam em “Aguardando acabamento”; as outras entram no estoque assim que a impressão é finalizada.
      </p>

      {action ? (
        <>
          <StartJobDialog job={action.job} open={action.kind === 'start'} onOpenChange={(o) => !o && setAction(null)} />
          <FinishJobDialog job={action.job} open={action.kind === 'finish'} onOpenChange={(o) => !o && setAction(null)} />
          <FailJobDialog job={action.job} open={action.kind === 'fail'} onOpenChange={(o) => !o && setAction(null)} onReplanned={(id) => navigate(`/producao/impressoes/${id}`)} />
          <CancelJobDialog job={action.job} open={action.kind === 'cancel'} onOpenChange={(o) => !o && setAction(null)} />
        </>
      ) : null}
      {output ? <FinishingDialog output={output} open onOpenChange={(o) => !o && setOutput(null)} /> : null}
    </>
  );
}

function ColumnEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-3 py-6 text-center text-sm text-muted">{children}</p>;
}

function JobCard({ job, children, highlight, showStatus }: { job: PrintJobRow; children?: ReactNode; highlight?: boolean; showStatus?: boolean }) {
  return (
    <article className={cn('space-y-1 rounded-[var(--radius-card)] border bg-panel p-3 shadow-[var(--shadow-card)]', highlight ? 'border-accent' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <Link to={`/producao/impressoes/${job.id}`} className="min-w-0 text-sm font-semibold underline-offset-4 hover:underline hover:decoration-accent hover:decoration-2">
          {job.code}
        </Link>
        {showStatus ? (
          <JobStatusBadge status={job.status} />
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
            <Printer className="size-3.5" aria-hidden /> {job.equipment_name}
          </span>
        )}
      </div>
      <p className="text-sm text-ink-soft">{job.outputs_summary}</p>
      {children}
    </article>
  );
}

// -----------------------------------------------------------------------------
// Histórico
// -----------------------------------------------------------------------------

const HISTORY_FILTERS: Array<{ key: 'todas' | PrintJobStatus; label: string }> = [
  { key: 'todas', label: 'Todas' },
  { key: 'CONCLUIDA', label: 'Concluídas' },
  { key: 'FALHOU', label: 'Com falha' },
  { key: 'CANCELADA', label: 'Canceladas' },
  { key: 'ESTORNADA', label: 'Estornadas' },
];

function History() {
  const { can, settings } = useMember();
  const showCosts = can('costs');
  const [range, setRange] = useDateRange('mes');
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filtro') as (typeof HISTORY_FILTERS)[number]['key'] | null) ?? 'todas';
  const history = useJobHistory(range);
  const columns = useHistoryColumns(showCosts, settings.timezone);
  const rows = useMemo(() => (history.data ?? []).filter((r) => filter === 'todas' || r.status === filter), [history.data, filter]);
  const setFilter = (key: string) => {
    const updated = new URLSearchParams(params);
    if (key === 'todas') updated.delete('filtro');
    else updated.set('filtro', key);
    setParams(updated, { replace: true });
  };
  const totals = rows.reduce(
    (acc, r) => ({ good: acc.good + r.qty_good, failed: acc.failed + r.qty_failed, minutes: acc.minutes + toNumber(r.actual_minutes), cost: acc.cost + toNumber(r.cost_total), scrap: acc.scrap + toNumber(r.cost_scrap) }),
    { good: 0, failed: 0, minutes: 0, cost: 0, scrap: 0 },
  );

  return (
    <div className="space-y-3">
      <PeriodPresets range={range} onChange={setRange} />
      <div role="radiogroup" aria-label="Situação" className="flex flex-wrap gap-1.5">
        {HISTORY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn('h-9 rounded-full border px-3 text-sm font-medium', filter === f.key ? 'border-ink bg-ink text-brand-fg' : 'border-line-strong bg-panel text-ink-soft')}
          >
            {f.label}
          </button>
        ))}
      </div>
      {history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : !history.data ? (
        <LoadingBlock />
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            <CheckCircle2 className="mr-1 inline size-4 align-[-3px] text-success" aria-hidden />
            <span className="num">{totals.good}</span> peça(s) boa(s) · <span className="num">{totals.failed}</span> com falha · <span className="num">{formatMinutes(totals.minutes)}</span> de máquina
            {showCosts ? (
              <>
                {' '}
                · custo <Money value={totals.cost} className="font-medium" /> · falhas <Money value={totals.scrap} className="text-danger" />
              </>
            ) : null}
          </p>
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => String(r.id)}
            rowHref={(r) => `/producao/impressoes/${r.id}`}
            searchText={(r) => `${r.code} ${r.outputs_summary ?? ''} ${r.equipment_name}`}
            searchPlaceholder="Pesquisar por código ou peça…"
            initialSort={{ key: 'date', direction: 'desc' }}
            toolbar={<ExportMenu rows={rows} columns={historyExportColumns(showCosts, settings.timezone)} fileName={`impressoes-${range.from}-${range.to}`} />}
            emptyTitle="Nenhuma impressão no período"
            emptyDescription="Impressões concluídas, com falha, canceladas e estornadas aparecem aqui."
            mobileCard={(r) => <JobMobileCard job={r} showCosts={showCosts} timeZone={settings.timezone} />}
          />
        </>
      )}
    </div>
  );
}
