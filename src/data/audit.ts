import { keepPreviousData } from '@tanstack/react-query';
import { from, unwrap } from './api';
import { useAppQuery } from './hooks';

/** Auditoria (US-0.5): quem fez o quê e quando. Somente leitura (dono e leitura). */

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL' | 'REVERSE' | 'CLOSE_MONTH' | 'REOPEN_MONTH' | 'LOGIN';

export interface AuditRow {
  id: number;
  user_id: string | null;
  user_name: string;
  action: AuditAction;
  model_label: string;
  object_id: number | null;
  object_ref: string | null;
  summary: string | null;
  changes: unknown;
  ip: string | null;
  occurred_at: string;
}

export interface AuditFilter {
  from: string;
  to: string;
  /** id do usuário, "sistema" (sem usuário) ou vazio. */
  userId?: string;
  action?: string;
  model?: string;
  objectId?: number | null;
}

/** Máximo de registros carregados por consulta (refine o período para ver mais). */
export const AUDIT_LIMIT = 500;

export function useAuditLogs(filter: AuditFilter, enabled = true) {
  return useAppQuery(
    ['audit', filter.from, filter.to, filter.userId ?? '', filter.action ?? '', filter.model ?? '', filter.objectId ?? null],
    async () => {
      let query = from('v_audit_logs')
        .select('*', { count: 'exact' })
        .gte('occurred_at', `${filter.from}T00:00:00-03:00`)
        .lte('occurred_at', `${filter.to}T23:59:59.999-03:00`);
      if (filter.userId === 'sistema') query = query.is('user_id', null);
      else if (filter.userId) query = query.eq('user_id', filter.userId);
      if (filter.action) query = query.eq('action', filter.action);
      if (filter.model) query = query.eq('model_label', filter.model);
      if (filter.objectId) query = query.eq('object_id', filter.objectId);
      const { data, error, count } = await query.order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(AUDIT_LIMIT);
      if (error) throw error;
      const rows = (data ?? []) as AuditRow[];
      return { rows, total: count ?? rows.length };
    },
    { enabled, placeholderData: keepPreviousData },
  );
}

/** Pessoas que podem aparecer na auditoria (perfis visíveis a qualquer membro). */
export function useAuditUsers() {
  return useAppQuery(['audit-users'], () => unwrap<Array<{ id: string; display_name: string }>>(from('profiles').select('id,display_name').order('display_name')));
}

/** Um registro (para abrir o detalhe por link, mesmo fora do período filtrado). */
export function useAuditEntry(id: number | null) {
  return useAppQuery(
    ['audit', 'entry', id],
    async () => {
      const rows = await unwrap<AuditRow[]>(from('v_audit_logs').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: id !== null },
  );
}
