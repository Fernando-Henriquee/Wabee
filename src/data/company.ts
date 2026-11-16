import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { rpc } from './api';
import { useWrite } from './hooks';

export type CompanyRole = 'dono' | 'membro';

export interface CompanySummary {
  id: string;
  name: string;
  role: CompanyRole;
}

export interface PendingInvite {
  id: string;
  company_id: string;
  company_name: string;
  invited_by: string;
  created_at: string;
}

export interface SentInvite {
  id: string;
  email: string;
  created_at: string;
}

/** Empresas da conta. Consulta de nível da conta: não depende da empresa ativa. */
export function useMyCompanies(userId: string | undefined) {
  return useQuery({
    queryKey: ['account', 'companies', userId],
    enabled: Boolean(userId),
    queryFn: () => rpc<CompanySummary[]>('my_companies'),
  });
}

export function usePendingInvites(userId: string | undefined) {
  return useQuery({
    queryKey: ['account', 'invites', userId],
    enabled: Boolean(userId),
    queryFn: () => rpc<PendingInvite[]>('my_pending_invites'),
  });
}

/** Convites enviados e ainda pendentes na empresa ativa (só o dono). */
export function useSentInvites(enabled: boolean) {
  return useQuery({
    queryKey: ['w', 'sent-invites'],
    enabled,
    queryFn: () => rpc<SentInvite[]>('list_invites'),
  });
}

export function useCreateCompany(onCreated: (id: string) => void) {
  return useWrite<string, string>({
    mutationFn: (name) => rpc<string>('create_company', { p_name: name }),
    success: 'Empresa criada.',
    onSuccess: (id) => onCreated(id),
  });
}

export function useAcceptInvite(onAccepted: (companyId: string) => void) {
  return useWrite<string, string>({
    mutationFn: (inviteId) => rpc<string>('accept_invite', { p_invite_id: inviteId }),
    success: 'Convite aceito. Você já faz parte da empresa.',
    onSuccess: (companyId) => onAccepted(companyId),
  });
}

export function useDeclineInvite(onDone: () => void) {
  return useWrite<string>({
    mutationFn: (inviteId) => rpc('decline_invite', { p_invite_id: inviteId }),
    success: 'Convite recusado.',
    onSuccess: onDone,
  });
}

/**
 * Convida por e-mail pela função de borda: ela confere que quem chama é dono da empresa, registra o
 * convite e, se a pessoa ainda não tem conta, envia o e-mail de cadastro do Supabase.
 */
export function useInviteMember(onDone?: () => void) {
  return useWrite<{ email: string; companyId: string }, { invited: boolean }>({
    mutationFn: async ({ email, companyId }) => {
      const { data, error } = await supabase.functions.invoke<{ invited: boolean; error?: string }>('invite-member', {
        body: { email, company_id: companyId },
      });
      if (error) {
        const detail = await readFunctionError(error);
        throw new Error(detail ?? 'Não foi possível enviar o convite.');
      }
      if (data?.error) throw new Error(data.error);
      return { invited: true };
    },
    success: 'Convite enviado.',
    onSuccess: () => onDone?.(),
    toastError: false,
  });
}

async function readFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // corpo vazio ou não JSON
    }
  }
  return null;
}

export function useCancelInvite() {
  return useWrite<string>({
    mutationFn: (inviteId) => rpc('cancel_invite', { p_invite_id: inviteId }),
    success: 'Convite cancelado.',
  });
}

export function useRemoveMember() {
  return useWrite<string>({
    mutationFn: (userId) => rpc('remove_member', { p_user_id: userId }),
    success: 'Pessoa removida da empresa.',
  });
}

export function useRenameCompany() {
  return useWrite<string>({
    mutationFn: (name) => rpc('rename_company', { p_name: name }),
    success: 'Nome da empresa atualizado.',
  });
}
