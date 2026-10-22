import { ArrowRight, ExternalLink, Info } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Freshness } from '@/components/shared/freshness';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingBlock, Spinner } from '@/components/ui/states';
import { AUDIT_LIMIT, type AuditAction, type AuditRow, useAuditEntry, useAuditLogs, useAuditUsers } from '@/data/audit';
import { useMember } from '@/features/member/member-context';
import { BackLink } from '@/features/settings/bits';
import { formatDateTimeBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { ACTION_LABELS, ACTION_TONES, auditObjectHref, auditSummary, describeChanges, fieldLabel, formatAuditValue, MODEL_LABELS, modelLabel } from './audit-format';

const ACTIONS = Object.keys(ACTION_LABELS) as AuditAction[];
const MODELS = Object.entries(MODEL_LABELS).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function useNames() {
  const users = useAuditUsers();
  return useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.display_name])), [users.data]);
}

/** Referência legível do objeto (o id de pessoa vira o nome). */
function objectRef(row: AuditRow, names: Map<string, string>): string | null {
  if (row.object_ref && UUID.test(row.object_ref)) return names.get(row.object_ref) ?? 'pessoa';
  return row.object_ref ?? (row.object_id ? `#${row.object_id}` : null);
}

export function AuditPage() {
  const { can, settings } = useMember();
  const [range, setRange] = useDateRange('mes');
  const [params, setParams] = useSearchParams();
  const userId = params.get('usuario') ?? '';
  const action = params.get('acao') ?? '';
  const model = params.get('entidade') ?? '';
  const objectParam = Number(params.get('objeto'));
  const objectId = Number.isInteger(objectParam) && objectParam > 0 ? objectParam : null;
  const openParam = Number(params.get('registro'));
  const openId = Number.isInteger(openParam) && openParam > 0 ? openParam : null;

  const allowed = can('audit');
  const logs = useAuditLogs({ from: range.from, to: range.to, userId, action, model, objectId }, allowed);
  const users = useAuditUsers();
  const names = useNames();
  const tz = settings.timezone;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const hrefFor = (row: AuditRow) => {
    const next = new URLSearchParams(params);
    next.set('registro', String(row.id));
    return `?${next.toString()}`;
  };

  const rows = useMemo(() => logs.data?.rows ?? [], [logs.data]);

  const columns = useMemo<Column<AuditRow>[]>(
    () => [
      { key: 'when', header: 'Quando', sortValue: (r) => r.occurred_at, cell: (r) => <span className="num whitespace-nowrap">{formatDateTimeBR(r.occurred_at, tz)}</span> },
      { key: 'user', header: 'Quem', sortValue: (r) => r.user_name, cell: (r) => r.user_name },
      { key: 'action', header: 'Ação', sortValue: (r) => r.action, cell: (r) => <Badge tone={ACTION_TONES[r.action] ?? 'neutral'}>{ACTION_LABELS[r.action] ?? r.action}</Badge> },
      {
        key: 'model',
        header: 'O quê',
        sortValue: (r) => modelLabel(r.model_label),
        cell: (r) => (
          <span>
            {modelLabel(r.model_label)}
            {objectRef(r, names) ? <span className="block text-xs text-muted">{objectRef(r, names)}</span> : null}
          </span>
        ),
      },
      { key: 'summary', header: 'Resumo', cell: (r) => <span className="line-clamp-2 max-w-md text-ink-soft">{auditSummary(r)}</span> },
    ],
    [tz, names],
  );

  const exportColumns: ExportColumn<AuditRow>[] = [
    { header: 'Data e hora', value: (r) => formatDateTimeBR(r.occurred_at, tz) },
    { header: 'Usuário', value: (r) => r.user_name },
    { header: 'Ação', value: (r) => ACTION_LABELS[r.action] ?? r.action },
    { header: 'Entidade', value: (r) => modelLabel(r.model_label) },
    { header: 'Referência', value: (r) => objectRef(r, names) },
    { header: 'Resumo', value: (r) => auditSummary(r) },
    { header: 'IP', value: (r) => r.ip },
    { header: 'Alterações (JSON)', value: (r) => (describeChanges(r.changes).kind === 'empty' ? '' : JSON.stringify(r.changes)) },
  ];

  if (!allowed) {
    return (
      <Page>
        <PageHeader title="Auditoria" />
        <EmptyState title="Sem permissão" description="A auditoria é vista pelos perfis Dono e Somente leitura." />
      </Page>
    );
  }

  const filtered = Boolean(userId || action || model || objectId);
  const total = logs.data?.total ?? 0;

  return (
    <Page>
      <PageHeader
        back={
          can('settings') ? (
            <BackLink />
          ) : undefined
        }
        title="Auditoria"
        description="Quem fez o quê e quando. Os registros não podem ser alterados nem apagados."
        actions={<ExportMenu rows={rows} columns={exportColumns} fileName={`auditoria-${range.from}-a-${range.to}`} />}
      />
      <div className="space-y-4">
        <PeriodPresets range={range} onChange={setRange} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select aria-label="Usuário" value={userId} onChange={(e) => setParam('usuario', e.target.value)}>
            <option value="">Todas as pessoas</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name || 'Sem nome'}
              </option>
            ))}
            <option value="sistema">Sistema (automático)</option>
          </Select>
          <Select aria-label="Ação" value={action} onChange={(e) => setParam('acao', e.target.value)}>
            <option value="">Todas as ações</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </Select>
          <Select aria-label="Entidade" value={model} onChange={(e) => setParam('entidade', e.target.value)}>
            <option value="">Tudo (produtos, compras, vendas…)</option>
            {MODELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {model && !MODEL_LABELS[model] ? <option value={model}>{model}</option> : null}
          </Select>
        </div>
        {objectId ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            Mostrando só o registro #{objectId}.
            <Button variant="link" onClick={() => setParam('objeto', null)}>
              Ver todos
            </Button>
          </p>
        ) : null}
        {logs.data && total > rows.length ? (
          <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Mostrando os {AUDIT_LIMIT} registros mais recentes de {total.toLocaleString('pt-BR')}. Reduza o período ou use os filtros para ver os demais.
          </p>
        ) : null}

        {logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        ) : !logs.data ? (
          <LoadingBlock />
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <Freshness query={logs} />
              {logs.isFetching && logs.isPlaceholderData ? <Spinner label="Atualizando…" /> : null}
            </div>
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(r) => String(r.id)}
              searchText={(r) => `${r.user_name} ${modelLabel(r.model_label)} ${objectRef(r, names) ?? ''} ${auditSummary(r)} ${r.ip ?? ''}`}
              searchPlaceholder="Pesquisar no resumo, pessoa, referência…"
              rowHref={hrefFor}
              pageSize={50}
              emptyTitle={filtered ? 'Nada com estes filtros' : 'Nenhum registro no período'}
              emptyDescription={filtered ? 'Troque os filtros ou o período.' : 'Escolha um período maior.'}
              mobileCard={(r) => (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={ACTION_TONES[r.action] ?? 'neutral'}>{ACTION_LABELS[r.action] ?? r.action}</Badge>
                    <span className="num text-xs text-muted">{formatDateTimeBR(r.occurred_at, tz)}</span>
                  </div>
                  <p className="line-clamp-2 text-sm font-medium text-ink">{auditSummary(r)}</p>
                  <p className="truncate text-xs text-muted">
                    {modelLabel(r.model_label)}
                    {objectRef(r, names) ? ` · ${objectRef(r, names)}` : ''} · {r.user_name}
                  </p>
                </div>
              )}
            />
          </>
        )}
      </div>
      <AuditDetailDialog id={openId} row={rows.find((r) => r.id === openId) ?? null} names={names} onClose={() => setParam('registro', null)} />
    </Page>
  );
}

function AuditDetailDialog({ id, row: listed, names, onClose }: { id: number | null; row: AuditRow | null; names: Map<string, string>; onClose: () => void }) {
  const { settings } = useMember();
  const entry = useAuditEntry(id !== null && !listed ? id : null);
  const row = listed ?? entry.data ?? null;
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      {id !== null ? (
        <DialogContent
          size="lg"
          title={row ? auditSummary(row) : 'Registro de auditoria'}
          description={row ? `${formatDateTimeBR(row.occurred_at, settings.timezone)} · ${row.user_name}` : undefined}
          footer={
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          }
        >
          {!row ? (
            entry.isError ? (
              <ErrorState error={entry.error} />
            ) : entry.isFetching ? (
              <LoadingBlock rows={3} />
            ) : (
              <EmptyState title="Registro não encontrado" />
            )
          ) : (
            <AuditDetail row={row} names={names} />
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function AuditDetail({ row, names }: { row: AuditRow; names: Map<string, string> }) {
  const { settings } = useMember();
  const href = auditObjectHref(row);
  const shape = describeChanges(row.changes);
  const ref = objectRef(row, names);
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">Ação</dt>
          <dd>
            <Badge tone={ACTION_TONES[row.action] ?? 'neutral'}>{ACTION_LABELS[row.action] ?? row.action}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">O quê</dt>
          <dd className="font-medium text-ink">{modelLabel(row.model_label)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Referência</dt>
          <dd className="font-medium text-ink">
            {href ? (
              <Link to={href} className="inline-flex items-center gap-1 underline decoration-accent decoration-2 underline-offset-4 hover:decoration-ink">
                {ref ?? 'Abrir'} <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            ) : (
              (ref ?? '—')
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Quem</dt>
          <dd className="font-medium text-ink">{row.user_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Quando</dt>
          <dd className="num font-medium text-ink">{formatDateTimeBR(row.occurred_at, settings.timezone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">IP</dt>
          <dd className="num font-medium text-ink">{row.ip ?? '—'}</dd>
        </div>
      </dl>
      {row.summary ? (
        <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">
          <span className="text-xs text-muted">Resumo registrado: </span>
          {row.summary}
        </p>
      ) : null}

      <section aria-label="Alterações">
        <h3 className="mb-2 text-sm font-semibold">
          {shape.kind === 'diff' ? 'Antes e depois' : shape.kind === 'snapshot' ? 'Dados cadastrados' : 'Detalhes'}
        </h3>
        {shape.kind === 'empty' ? <p className="text-sm text-muted">Sem detalhes adicionais.</p> : null}
        {shape.kind === 'diff' ? (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {shape.rows.map((r) => (
              <li key={r.field} className="px-3 py-2.5 text-sm">
                <p className="text-xs font-medium text-muted">{fieldLabel(r.field)}</p>
                <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
                  <span className="break-words text-danger line-through decoration-danger/40">{formatAuditValue(r.before, r.field, settings.timezone)}</span>
                  <ArrowRight className="mt-0.5 size-4 text-muted" aria-label="para" />
                  <span className="break-words font-medium text-success">{formatAuditValue(r.after, r.field, settings.timezone)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {shape.kind === 'snapshot' ? (
          <dl className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {shape.rows.map((r) => (
              <div key={r.field} className="grid grid-cols-1 gap-0.5 px-3 py-2 text-sm sm:grid-cols-[14rem_1fr] sm:gap-3">
                <dt className="text-xs text-muted sm:text-sm">{fieldLabel(r.field)}</dt>
                <dd className="break-words text-ink">{formatAuditValue(r.value, r.field, settings.timezone)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {shape.kind === 'json' ? (
          <pre className="max-h-80 overflow-auto rounded-xl border border-line bg-subtle p-3 text-xs leading-relaxed text-ink">{JSON.stringify(shape.value, null, 2)}</pre>
        ) : null}
      </section>
    </div>
  );
}
