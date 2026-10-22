import { History } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { from, unwrap } from '@/data/api';
import type { AuditRow } from '@/data/audit';
import { useAppQuery } from '@/data/hooks';
import { ACTION_LABELS, ACTION_TONES, auditSummary, modelLabel } from '@/features/audit/audit-format';
import { useMember } from '@/features/member/member-context';
import { formatDateTimeBR } from '@/lib/dates';

export interface HistoryRef {
  model: string;
  ids: Array<number | null | undefined>;
}

/**
 * Linha do tempo de auditoria de um documento (US-0.5, aba Histórico): o próprio
 * documento e os registros ligados a ele (recebimentos, saídas, parcelas…).
 */
export function DocumentHistory({ refs, title = 'Histórico', mainModel }: { refs: HistoryRef[]; title?: string; mainModel?: string }) {
  const { can, settings } = useMember();
  const clean = refs.map((r) => ({ model: r.model, ids: [...new Set(r.ids.filter((id): id is number => typeof id === 'number'))].sort((a, b) => a - b) })).filter((r) => r.ids.length > 0);
  const history = useAppQuery(
    ['doc-history', clean],
    async () => {
      const groups = await Promise.all(
        clean.map((r) => unwrap<AuditRow[]>(from('v_audit_logs').select('*').eq('model_label', r.model).in('object_id', r.ids).order('occurred_at', { ascending: false }).limit(200))),
      );
      return groups.flat().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id);
    },
    { enabled: can('audit') && clean.length > 0 },
  );
  if (!can('audit')) return null;

  return (
    <Card>
      <CardHeader title={title} description="Quem fez o quê e quando. Nada é apagado: correções aparecem como estorno ou cancelamento." />
      {history.isError ? (
        <ErrorState className="m-4" error={history.error} />
      ) : !history.data ? (
        <div className="p-4">
          <LoadingBlock rows={2} />
        </div>
      ) : history.data.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted">
          <History className="size-4" /> Sem registros.
        </p>
      ) : (
        <ol className="divide-y divide-line">
          {history.data.map((row) => (
            <li key={row.id}>
              <Link to={`/auditoria?registro=${row.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-subtle">
                <span className="num w-32 shrink-0 text-xs text-muted">{formatDateTimeBR(row.occurred_at, settings.timezone)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={ACTION_TONES[row.action] ?? 'neutral'}>{ACTION_LABELS[row.action] ?? row.action}</Badge>
                    {row.model_label !== mainModel ? <span className="text-xs text-muted">{modelLabel(row.model_label)}</span> : null}
                  </span>
                  <span className="mt-0.5 block">{auditSummary(row)}</span>
                </span>
                <span className="text-xs text-muted">{row.user_name}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
