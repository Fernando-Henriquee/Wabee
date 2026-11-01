import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, Cpu, Gauge, MoreHorizontal, Plus, Printer, Wrench, XCircle } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { ErrorState, LoadingBlock, Skeleton } from '@/components/ui/states';
import {
  type BoardStage,
  FAILURE_REASON_LABELS,
  type PrintJobOutputRow,
  type PrintJobRow,
  type PrintJobStatus,
  useBoardJobs,
  useCompletePrintJob,
  useFinishingQueue,
  useJobHistory,
  useMovePrintJob,
} from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addDays } from '@/lib/dates';
import { formatMinutes, toNumber } from '@/lib/money';
import { JobMobileCard, JobStatusBadge } from './bits';
import { FinishingDialog } from './finishing-dialog';
import { formatWhen } from './helpers';
import { CancelJobDialog, FailJobDialog, FinishJobDialog } from './job-dialogs';
import { historyExportColumns, useHistoryColumns } from './job-table';

type SectionKey = 'PLANEJADA' | 'IMPRIMINDO' | 'ACABAMENTO' | 'CONCLUIDA';
type JobAction = { kind: 'finish' | 'fail' | 'cancel'; job: PrintJobRow };

const SECTION_KEYS: SectionKey[] = ['PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO', 'CONCLUIDA'];

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
        description="Planeje as mesas e mova os cards entre as etapas. O custo vem da ficha técnica de cada produto."
        actions={
          <>
            <Button asChild variant="outline" className="h-9 sm:h-10">
              <Link to="/producao/equipamentos">
                <Cpu /> Equipamentos
              </Link>
            </Button>
            {can('costs') ? (
              <Button asChild variant="outline" className="h-9 sm:h-10">
                <Link to="/producao/taxas">
                  <Gauge /> Taxas
                </Link>
              </Button>
            ) : null}
            {can('production') ? (
              <Button asChild className="order-first h-11 w-full sm:order-none sm:h-10 sm:w-auto">
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
  // Concluídas dos últimos 7 dias: dá para arrastar de volta se precisar reimprimir.
  const since = useMemo(() => `${addDays(today(), -6)}T00:00:00-03:00`, [today]);
  const jobs = useBoardJobs(since);
  const finishing = useFinishingQueue();
  const [action, setAction] = useState<JobAction | null>(null);
  const [output, setOutput] = useState<PrintJobOutputRow | null>(null);
  const [reopen, setReopen] = useState<{ job: PrintJobRow; to: SectionKey } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<SectionKey | null>(null);
  /** Posição otimista enquanto a gravação não volta. */
  const [pending, setPending] = useState<Record<number, SectionKey>>({});
  const owner = can('settings');
  const canMove = can('production');

  const move = useMovePrintJob();
  const complete = useCompletePrintJob(owner ? (jobId) => move.mutateAsync({ requestId: crypto.randomUUID(), jobId, to: 'ACABAMENTO', undo: true }) : undefined);

  const all = [...(jobs.data?.active ?? []), ...(jobs.data?.done ?? [])];
  const stageOf = (job: PrintJobRow): SectionKey => pending[job.id] ?? (job.status === 'FALHOU' ? 'CONCLUIDA' : (job.status as SectionKey));
  const inStage = (key: SectionKey) => all.filter((j) => stageOf(j) === key);
  const queue = finishing.data ?? [];

  const requested = params.get('status') === 'HOJE' ? 'CONCLUIDA' : params.get('status');
  const counts: Record<SectionKey, number> = {
    PLANEJADA: inStage('PLANEJADA').length,
    IMPRIMINDO: inStage('IMPRIMINDO').length,
    ACABAMENTO: inStage('ACABAMENTO').length + queue.length,
    CONCLUIDA: inStage('CONCLUIDA').length,
  };
  const selected: SectionKey = SECTION_KEYS.includes(requested as SectionKey)
    ? (requested as SectionKey)
    : (SECTION_KEYS.find((k) => k !== 'CONCLUIDA' && counts[k] > 0) ?? 'PLANEJADA');
  const select = (key: SectionKey) => {
    const updated = new URLSearchParams(params);
    updated.set('status', key);
    setParams(updated, { replace: true });
  };

  const settle = (jobId: number) => setPending(({ [jobId]: _done, ...rest }) => rest);
  const moveTo = (job: PrintJobRow, to: SectionKey) => {
    const from = stageOf(job);
    if (from === to || !canMove) return;
    if (to === 'CONCLUIDA') {
      setPending((p) => ({ ...p, [job.id]: to }));
      complete.mutate({ requestId: crypto.randomUUID(), jobId: job.id, code: job.code }, { onSettled: () => settle(job.id) });
      return;
    }
    if (from === 'CONCLUIDA') {
      if (!owner) {
        toast.error('Só o dono desfaz uma impressão concluída.');
        return;
      }
      setReopen({ job, to });
      return;
    }
    setPending((p) => ({ ...p, [job.id]: to }));
    move.mutate({ requestId: crypto.randomUUID(), jobId: job.id, to }, { onSettled: () => settle(job.id) });
  };

  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  if (!jobs.data) return <LoadingBlock />;

  const card = (job: PrintJobRow, key: SectionKey) => (
    <JobCard
      key={job.id}
      job={job}
      showStatus={key === 'CONCLUIDA'}
      draggable={canMove}
      dragging={dragging === job.id}
      saving={pending[job.id] !== undefined}
      onDragStart={() => setDragging(job.id)}
      onDragEnd={() => {
        setDragging(null);
        setOver(null);
      }}
      menu={canMove ? <CardMenu job={job} stage={key} owner={owner} onMove={(to) => moveTo(job, to)} onAction={(kind) => setAction({ kind, job })} /> : null}
    >
      {key === 'CONCLUIDA' ? (
        <>
          <p className="num text-xs text-muted">
            {job.qty_good} boa(s){job.qty_failed > 0 ? ` · ${job.qty_failed} falha(s)` : ''} · {formatMinutes(job.actual_minutes)} · {formatWhen(job.finished_at, today(), settings.timezone)}
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
        </>
      ) : (
        <p className="text-xs text-muted">
          <CalendarClock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          {formatMinutes(job.est_minutes)} pela ficha{job.planned_for ? ` · para ${formatWhen(job.planned_for, today(), settings.timezone)}` : ''}
        </p>
      )}
    </JobCard>
  );

  const sections: Array<{ key: SectionKey; label: string; short: string; empty: string; extra?: ReactNode }> = [
    { key: 'PLANEJADA', label: 'Planejadas', short: 'Planejadas', empty: `Nenhuma mesa planejada.${canMove ? ' Toque em “Nova impressão”.' : ''}` },
    { key: 'IMPRIMINDO', label: 'Imprimindo', short: 'Imprimindo', empty: 'Arraste para cá o que está na impressora.' },
    {
      key: 'ACABAMENTO',
      label: 'Acabamento',
      short: 'Acabamento',
      empty: 'Arraste para cá o que saiu da mesa e está em acabamento.',
      extra: !finishing.data ? (
        <Skeleton className="h-24" />
      ) : (
        queue.map((o) => (
          <article key={`o${o.id}`} className="rounded-[var(--radius-card)] border border-line bg-panel p-3 shadow-[var(--shadow-card)]">
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
              · já concluída, aguardando liberar
            </p>
            {canMove ? (
              <Button variant="outline" className="mt-3 h-10 w-full" onClick={() => setOutput(o)}>
                <Wrench /> Acabamento e liberar
              </Button>
            ) : null}
          </article>
        ))
      ),
    },
    { key: 'CONCLUIDA', label: 'Concluídas (7 dias)', short: 'Concluídas', empty: 'Arraste para cá o que terminou: o filamento é baixado e as peças entram no estoque.' },
  ];

  return (
    <>
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
            {s.short}
            <span className={cn('num rounded-full px-1.5 text-xs', selected === s.key ? 'bg-brand-fg/20' : 'bg-subtle')}>{counts[s.key]}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {sections.map((s) => {
          const list = inStage(s.key);
          return (
            <section
              key={s.key}
              aria-label={s.label}
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                if (over !== s.key) setOver(s.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const job = all.find((j) => j.id === dragging);
                setDragging(null);
                setOver(null);
                if (job) moveTo(job, s.key);
              }}
              className={cn(
                selected === s.key ? 'block' : 'hidden',
                'rounded-[var(--radius-card)] transition-colors lg:block lg:min-h-48 lg:border lg:border-line lg:bg-subtle/60 lg:p-2.5',
                over === s.key && 'lg:border-accent lg:bg-accent-soft/50',
              )}
            >
              <h2 className="mb-2 hidden items-center justify-between px-0.5 text-sm font-semibold lg:flex">
                {s.label}
                <span className="num rounded-full bg-panel px-2 text-xs font-medium text-muted">{counts[s.key]}</span>
              </h2>
              <div className="space-y-2">
                {list.map((job) => card(job, s.key))}
                {s.extra}
                {list.length === 0 && (s.key !== 'ACABAMENTO' || queue.length === 0) ? <ColumnEmpty>{s.empty}</ColumnEmpty> : null}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted">
        Arraste os cards (ou use o menu ⋯) como num quadro de projeto: Planejadas, Imprimindo e Acabamento não mexem no estoque nem no custo. Ao concluir,
        o filamento e o tempo vêm da ficha técnica e as peças entram no estoque; para registrar falhas ou gramas diferentes, use “Concluir com ajustes”.
      </p>

      {action ? (
        <>
          <FinishJobDialog job={action.job} open={action.kind === 'finish'} onOpenChange={(o) => !o && setAction(null)} />
          <FailJobDialog job={action.job} open={action.kind === 'fail'} onOpenChange={(o) => !o && setAction(null)} onReplanned={(id) => navigate(`/producao/impressoes/${id}`)} />
          <CancelJobDialog job={action.job} open={action.kind === 'cancel'} onOpenChange={(o) => !o && setAction(null)} />
        </>
      ) : null}
      {output ? <FinishingDialog output={output} open onOpenChange={(o) => !o && setOutput(null)} /> : null}
      <ConfirmDialog
        open={reopen !== null}
        onOpenChange={(o) => !o && setReopen(null)}
        tone="primary"
        title={reopen ? `Voltar ${reopen.job.code} para ${STAGE_LABELS[reopen.to]}?` : ''}
        description="Desfaz a conclusão: o filamento volta ao estoque, as peças saem do estoque e o custo é estornado. Peças já entregues ou baixadas bloqueiam a volta."
        confirmLabel="Desfazer e mover"
        onConfirm={() => (reopen ? move.mutateAsync({ requestId: crypto.randomUUID(), jobId: reopen.job.id, to: reopen.to as BoardStage }) : undefined)}
      />
    </>
  );
}

const STAGE_LABELS: Record<SectionKey, string> = { PLANEJADA: 'Planejada', IMPRIMINDO: 'Imprimindo', ACABAMENTO: 'Acabamento', CONCLUIDA: 'Concluída' };

function CardMenu({
  job,
  stage,
  owner,
  onMove,
  onAction,
}: {
  job: PrintJobRow;
  stage: SectionKey;
  owner: boolean;
  onMove: (to: SectionKey) => void;
  onAction: (kind: JobAction['kind']) => void;
}) {
  const done = stage === 'CONCLUIDA';
  const targets = SECTION_KEYS.filter((k) => k !== stage && (!done || owner));
  if (done && targets.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Mover ou mais ações de ${job.code}`}>
          <MoreHorizontal />
        </Button>
      </MenuTrigger>
      <MenuContent>
        {targets.map((k) => (
          <MenuItem key={k} onSelect={() => onMove(k)}>
            <ArrowRight /> {done ? `Desfazer e voltar para ${STAGE_LABELS[k]}` : `Mover para ${STAGE_LABELS[k]}`}
          </MenuItem>
        ))}
        {!done ? (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => onAction('finish')}>
              <ClipboardCheck /> Concluir com ajustes
            </MenuItem>
            <MenuItem onSelect={() => onAction('fail')}>
              <AlertTriangle /> Falha total
            </MenuItem>
            <MenuItem tone="danger" onSelect={() => onAction('cancel')}>
              <XCircle /> Cancelar
            </MenuItem>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

function ColumnEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-3 py-6 text-center text-sm text-muted">{children}</p>;
}

function JobCard({
  job,
  children,
  showStatus,
  menu,
  draggable,
  dragging,
  saving,
  onDragStart,
  onDragEnd,
}: {
  job: PrintJobRow;
  children?: ReactNode;
  showStatus?: boolean;
  menu?: ReactNode;
  draggable?: boolean;
  dragging?: boolean;
  saving?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(job.id));
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      aria-busy={saving || undefined}
      className={cn(
        'space-y-1 rounded-[var(--radius-card)] border border-line bg-panel p-3 shadow-[var(--shadow-card)] transition-opacity',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
        saving && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 text-sm font-semibold leading-snug">{job.outputs_summary}</p>
        <div className="-my-1 -mr-1.5 shrink-0">{menu}</div>
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
        <Link to={`/producao/impressoes/${job.id}`} draggable={false} className="font-medium text-ink-soft underline-offset-2 hover:underline">
          {job.code}
        </Link>
        <span className="inline-flex items-center gap-1">
          <Printer className="size-3.5 shrink-0" aria-hidden /> {job.equipment_name}
        </span>
        {showStatus ? <JobStatusBadge status={job.status} /> : null}
      </p>
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
  // Totais só do que valeu: estornadas e canceladas não contam.
  const totals = rows.filter((r) => r.status === 'CONCLUIDA' || r.status === 'FALHOU').reduce(
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
