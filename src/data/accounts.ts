import { useQuery } from '@tanstack/react-query';
import { rpc } from './api';
import { useAppQuery, useWrite } from './hooks';

export type AccountStatus = 'pendente' | 'aprovado' | 'recusado';

export interface PendingAccount {
  user_id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  created_at: string;
}

export interface DecidedAccount {
  user_id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  status: AccountStatus;
  decided_at: string;
}

export interface AccountsOverview {
  pendentes: PendingAccount[];
  decididas: DecidedAccount[];
}

/** Situação do cadastro da conta. Enquanto pendente, confere de novo a cada 15 s (a aprovação libera sozinha). */
export function useMyAccountStatus(userId: string | undefined) {
  return useQuery({
    queryKey: ['account', 'status', userId],
    enabled: Boolean(userId),
    queryFn: () => rpc<AccountStatus>('my_account_status'),
    refetchInterval: (query) => (query.state.data === 'pendente' ? 15_000 : false),
  });
}

/** A conta é administradora da plataforma (aprova cadastros)? */
export function useIsPlatformAdmin() {
  return useAppQuery(['admin', 'is'], () => rpc<boolean>('is_platform_admin'), { staleTime: 5 * 60_000 });
}

/** Cadastros aguardando aprovação (só administrador). Atualiza a cada minuto para o aviso no menu. */
export function useAccountsOverview(enabled: boolean) {
  return useAppQuery(['admin', 'accounts'], () => rpc<AccountsOverview>('admin_pending_accounts'), { enabled, refetchInterval: 60_000 });
}

export function useDecideAccount() {
  return useWrite<{ userId: string; approve: boolean }>({
    mutationFn: (v) => rpc('admin_decide_account', { p_user_id: v.userId, p_approve: v.approve }),
    success: (_r, v) => (v.approve ? 'Cadastro aprovado. A pessoa já pode entrar.' : 'Cadastro recusado.'),
  });
}
