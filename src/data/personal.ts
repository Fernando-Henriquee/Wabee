import { from, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';

/**
 * Finanças pessoais (aba "Pessoal"). Dados separados da empresa: tabelas pf_*, visíveis só aos
 * membros do espaço. Leituras por tabelas/views com RLS; escritas por RPC.
 */

export type PfAccountKind = 'CONTA' | 'CARTEIRA' | 'POUPANCA' | 'INVESTIMENTO' | 'CARTAO';
export type PfTxKind = 'GASTO' | 'ENTRADA' | 'TRANSFERENCIA' | 'AJUSTE';
export type PfPlanKind = 'CONTA_FIXA' | 'ENTRADA_FIXA' | 'PARCELADO' | 'FINANCIAMENTO';
export type PfAmortization = 'PRICE' | 'SAC' | 'FIXA';
export type PfScheduleStatus = 'PREVISTO' | 'PAGO' | 'PULADO';

export const ACCOUNT_KIND_LABELS: Record<PfAccountKind, string> = {
  CONTA: 'Conta corrente',
  CARTEIRA: 'Carteira (dinheiro)',
  POUPANCA: 'Poupança',
  INVESTIMENTO: 'Investimento',
  CARTAO: 'Cartão de crédito',
};

export const PLAN_KIND_LABELS: Record<PfPlanKind, string> = {
  CONTA_FIXA: 'Conta fixa',
  ENTRADA_FIXA: 'Entrada fixa',
  PARCELADO: 'Compra parcelada',
  FINANCIAMENTO: 'Financiamento',
};

export const AMORTIZATION_LABELS: Record<PfAmortization, string> = {
  PRICE: 'Price (parcelas iguais)',
  SAC: 'SAC (parcelas decrescentes)',
  FIXA: 'Valor da parcela informado',
};

export interface PfSpace {
  id: number;
  name: string;
  cycle_start_day: number;
  cycle_reserve: number;
}

export interface PfAccount {
  id: number;
  name: string;
  kind: PfAccountKind;
  opening_balance: number;
  opening_date: string;
  in_budget: boolean;
  active: boolean;
  /** Só no cartão de crédito. */
  credit_limit: number | null;
}

export interface PfAccountBalance {
  account_id: number;
  /** Saldo de hoje. No cartão, negativo = quanto está devendo. */
  balance: number;
  last_adjusted_at: string | null;
}

export interface PfCategory {
  id: number;
  name: string;
  kind: 'GASTO' | 'ENTRADA';
  keywords: string[];
  active: boolean;
}

export interface PfTransaction {
  id: number;
  kind: PfTxKind;
  account_id: number;
  account_name: string;
  to_account_id: number | null;
  to_account_name: string | null;
  category_id: number | null;
  category_name: string | null;
  amount: number;
  date: string;
  description: string | null;
  source: 'MANUAL' | 'VOZ';
  transcript: string | null;
  schedule_id: number | null;
  created_at: string;
}

export interface PfPlan {
  id: number;
  kind: PfPlanKind;
  name: string;
  account_id: number | null;
  category_id: number | null;
  amount: number;
  installments_total: number | null;
  first_due: string;
  status: 'ATIVO' | 'ENCERRADO';
  lender: string | null;
  principal: number | null;
  down_payment: number | null;
  rate_month: number | null;
  system: PfAmortization | null;
  notes: string | null;
  paid_count: number;
  open_count: number;
  paid_amount: number;
  remaining_amount: number;
  total_interest: number | null;
  next_due: string | null;
  last_due: string | null;
  outstanding_principal: number | null;
}

export interface PfScheduleRow {
  id: number;
  plan_id: number;
  plan_name: string;
  plan_kind: PfPlanKind;
  installments_total: number | null;
  account_id: number | null;
  category_id: number | null;
  number: number;
  due_date: string;
  amount: number;
  interest: number | null;
  status: PfScheduleStatus;
  transaction_id: number | null;
  paid_at: string | null;
}

export interface PfBill {
  schedule_id: number;
  name: string;
  kind: PfPlanKind;
  number: number;
  installments_total: number | null;
  due_date: string;
  amount: number;
  overdue: boolean;
}

export interface PfBudget {
  date: string;
  cycle_start: string;
  cycle_end: string;
  days_left: number;
  balance: number;
  incomes: number;
  commitments: number;
  reserve: number;
  available: number;
  allowance: number;
  spent: number;
  remaining: number;
  tomorrow_if_save: number | null;
  tomorrow_if_spend: number | null;
  next_bills: PfBill[];
  overdue_count: number;
}

export interface PfCalendarDay {
  date: string;
  is_future: boolean;
  is_cycle_start: boolean;
  spent: number;
  income: number;
  paid_bills: number;
  /** Ajustes de saldo do dia (com sinal), nas contas do cálculo. */
  adjust: number;
  allowance: number | null;
  bills: Array<{ schedule_id: number; name: string; kind: PfPlanKind; amount: number; status: PfScheduleStatus }>;
}

export interface PfCalendar {
  today: string;
  cycle_start: string;
  cycle_end: string;
  days: PfCalendarDay[];
}

export interface PfSummary {
  spent: number;
  spent_daily: number;
  income: number;
  /** Soma dos ajustes de saldo (com sinal); fora de gastos e entradas. */
  adjustments: number;
  by_category: Array<{ category_id: number | null; name: string; total: number }>;
}

export interface PfMember {
  user_id: string;
  display_name: string;
  email: string;
  is_me: boolean;
}

export interface PfWordRule {
  word: string;
  category_id: number;
}

// -----------------------------------------------------------------------------
// Leituras
// -----------------------------------------------------------------------------

/** Cria o espaço na primeira vez e devolve o id. As demais leituras esperam por ele. */
export function usePfSpaceReady() {
  return useAppQuery(['pf', 'ensure'], () => rpc<number>('pf_ensure_space'), { staleTime: Infinity, retry: 1 });
}

export function usePfSpace(enabled = true) {
  return useAppQuery(
    ['pf', 'space'],
    async () => (await unwrap<PfSpace[]>(from('pf_spaces').select('id,name,cycle_start_day,cycle_reserve')))[0]!,
    { enabled },
  );
}

export function usePfAccounts(enabled = true) {
  return useAppQuery(['pf', 'accounts'], () => unwrap<PfAccount[]>(from('pf_accounts').select('*').order('id')), { enabled });
}

export function usePfCategories(enabled = true) {
  return useAppQuery(['pf', 'categories'], () => unwrap<PfCategory[]>(from('pf_categories').select('*').order('name')), { enabled });
}

export function usePfWordRules(enabled = true) {
  return useAppQuery(['pf', 'word-rules'], () => unwrap<PfWordRule[]>(from('pf_word_rules').select('word,category_id')), { enabled });
}

export function usePfTransactions(range: { from: string; to: string } | { limit: number }, enabled = true) {
  return useAppQuery(
    ['pf', 'transactions', range],
    () => {
      let query = from('v_pf_transactions').select('*').order('date', { ascending: false }).order('id', { ascending: false });
      if ('limit' in range) query = query.limit(range.limit);
      else query = query.gte('date', range.from).lte('date', range.to);
      return unwrap<PfTransaction[]>(query);
    },
    { enabled },
  );
}

export function usePfAccountBalances(enabled = true) {
  return useAppQuery(['pf', 'balances'], () => rpc<PfAccountBalance[]>('pf_account_balances'), { enabled });
}

export function usePfPlans(enabled = true) {
  return useAppQuery(['pf', 'plans'], () => unwrap<PfPlan[]>(from('v_pf_plans').select('*').order('id', { ascending: false })), { enabled });
}

export function usePfPlan(id: number | undefined) {
  return useAppQuery(
    ['pf', 'plans', id],
    async () => (await unwrap<PfPlan[]>(from('v_pf_plans').select('*').eq('id', id!)))[0] ?? null,
    { enabled: Boolean(id) },
  );
}

export function usePfSchedule(filter: { from?: string; to?: string; planId?: number; status?: PfScheduleStatus }, enabled = true) {
  return useAppQuery(
    ['pf', 'schedule', filter],
    () => {
      let query = from('v_pf_schedule').select('*').order('due_date').order('id');
      if (filter.planId) query = query.eq('plan_id', filter.planId);
      if (filter.status) query = query.eq('status', filter.status);
      if (filter.from) query = query.gte('due_date', filter.from);
      if (filter.to) query = query.lte('due_date', filter.to);
      return unwrap<PfScheduleRow[]>(query);
    },
    { enabled },
  );
}

export function usePfBudget(date: string | null = null, enabled = true) {
  return useAppQuery(['pf', 'budget', date], () => rpc<PfBudget>('pf_budget', { p_date: date }), { enabled });
}

export function usePfCalendar(month: string, enabled = true) {
  return useAppQuery(['pf', 'calendar', month], () => rpc<PfCalendar>('pf_calendar', { p_month: month }), { enabled });
}

export function usePfSummary(from_: string, to: string, enabled = true) {
  return useAppQuery(['pf', 'summary', from_, to], () => rpc<PfSummary>('pf_summary', { p_from: from_, p_to: to }), { enabled });
}

export function usePfMembers(enabled = true) {
  return useAppQuery(['pf', 'members'], () => rpc<PfMember[]>('pf_members'), { enabled });
}

// -----------------------------------------------------------------------------
// Escritas
// -----------------------------------------------------------------------------

export interface PfTxInput {
  kind?: PfTxKind;
  account_id?: number | null;
  to_account_id?: number | null;
  category_id?: number | null;
  amount: number | string;
  date?: string;
  description?: string | null;
  source?: 'MANUAL' | 'VOZ';
  transcript?: string | null;
}

export function useAddTransactions(onDone?: (ids: number[]) => void) {
  return useWrite<{ requestId: string; txs: PfTxInput[] }, { ids: number[] }>({
    mutationFn: (v) => rpc('pf_add_transaction', { p_request_id: v.requestId, p_txs: v.txs }),
    success: (r) => (r.ids.length > 1 ? `${r.ids.length} lançamentos salvos.` : 'Lançamento salvo.'),
    onSuccess: (r) => onDone?.(r.ids),
  });
}

export function useUpdateTransaction(onDone?: () => void) {
  return useWrite<{ id: number; tx: Partial<PfTxInput> }>({
    mutationFn: (v) => rpc('pf_update_transaction', { p_id: v.id, p_tx: v.tx }),
    success: 'Lançamento atualizado.',
    onSuccess: () => onDone?.(),
  });
}

export function useDeleteTransaction(onDone?: () => void) {
  return useWrite<number>({
    mutationFn: (id) => rpc('pf_delete_transaction', { p_id: id }),
    success: 'Lançamento apagado.',
    onSuccess: () => onDone?.(),
  });
}

/** Informa o saldo que cada conta tem agora (no cartão, o negativo do que se deve); só o que mudou vira ajuste. */
export function useAdjustBalances(onDone?: (adjusted: number) => void) {
  return useWrite<{ requestId: string; items: Array<{ account_id: number; target: number }> }, { adjusted: number }>({
    mutationFn: (v) => rpc('pf_adjust_balances', { p_request_id: v.requestId, p_items: v.items }),
    success: (r) => (r.adjusted === 0 ? 'Os saldos já estavam certos.' : 'Saldos atualizados.'),
    onSuccess: (r) => onDone?.(r.adjusted),
  });
}

export interface PfPlanInput {
  id?: number;
  kind?: PfPlanKind;
  name: string;
  account_id?: number | null;
  category_id?: number | null;
  amount?: number | string | null;
  installments_total?: number | null;
  first_due?: string;
  paid_count?: number;
  lender?: string | null;
  principal?: number | string | null;
  down_payment?: number | string | null;
  rate_month?: number | string | null;
  system?: PfAmortization;
  notes?: string | null;
}

export function useSavePlan(onDone?: (id: number) => void) {
  return useWrite<PfPlanInput, number>({
    mutationFn: (plan) => rpc<number>('pf_save_plan', { p_plan: plan }),
    success: (_id, p) => (p.id ? 'Cadastro atualizado.' : 'Cadastro criado.'),
    onSuccess: (id) => onDone?.(id),
  });
}

export function usePaySchedule(onDone?: () => void) {
  return useWrite<{ scheduleId: number; date?: string | null; accountId?: number | null; amount?: number | string | null }, number>({
    mutationFn: (v) => rpc<number>('pf_pay_schedule', { p_schedule_id: v.scheduleId, p_date: v.date ?? null, p_account_id: v.accountId ?? null, p_amount: v.amount ?? null }),
    success: 'Pagamento registrado.',
    onSuccess: () => onDone?.(),
  });
}

export function useUnpaySchedule() {
  return useWrite<number>({
    mutationFn: (id) => rpc('pf_unpay_schedule', { p_schedule_id: id }),
    success: 'Voltou a ficar previsto.',
  });
}

export function useSkipSchedule() {
  return useWrite<number>({
    mutationFn: (id) => rpc('pf_skip_schedule', { p_schedule_id: id }),
    success: 'Vencimento pulado.',
  });
}

export function useSetScheduleAmount(onDone?: () => void) {
  return useWrite<{ id: number; amount: number | string }>({
    mutationFn: (v) => rpc('pf_set_schedule_amount', { p_schedule_id: v.id, p_amount: v.amount }),
    success: 'Valor atualizado.',
    onSuccess: () => onDone?.(),
  });
}

export function useSetScheduleDue(onDone?: () => void) {
  return useWrite<{ id: number; date: string; following: boolean }>({
    mutationFn: (v) => rpc('pf_set_schedule_due', { p_schedule_id: v.id, p_date: v.date, p_following: v.following }),
    success: 'Vencimento atualizado.',
    onSuccess: () => onDone?.(),
  });
}

export function useClosePlan(onDone?: () => void) {
  return useWrite<number>({
    mutationFn: (id) => rpc('pf_close_plan', { p_plan_id: id }),
    success: 'Cadastro encerrado.',
    onSuccess: () => onDone?.(),
  });
}

export function useSaveAccount(onDone?: (id: number) => void) {
  return useWrite<Partial<PfAccount> & { name: string }, number>({
    mutationFn: (account) => rpc<number>('pf_save_account', { p_account: account }),
    success: (_id, a) => (a.id ? 'Conta atualizada.' : 'Conta criada.'),
    onSuccess: (id) => onDone?.(id),
  });
}

export function useSaveCategory(onDone?: (id: number) => void) {
  return useWrite<Partial<PfCategory> & { name: string }, number>({
    mutationFn: (category) => rpc<number>('pf_save_category', { p_category: category }),
    success: (_id, c) => (c.id ? 'Categoria atualizada.' : 'Categoria criada.'),
    onSuccess: (id) => onDone?.(id),
  });
}

export function useSaveSpaceSettings() {
  return useWrite<{ name?: string; cycle_start_day?: number; cycle_reserve?: number | string }>({
    mutationFn: (settings) => rpc('pf_save_settings', { p_settings: settings }),
    success: 'Ajustes salvos.',
  });
}

export function useAddMember(onDone?: () => void) {
  return useWrite<string, { display_name: string }>({
    mutationFn: (email) => rpc('pf_add_member', { p_email: email }),
    success: (r) => `${r.display_name} agora vê e lança nas mesmas finanças.`,
    onSuccess: () => onDone?.(),
  });
}

export function useRemoveMember() {
  return useWrite<string>({
    mutationFn: (userId) => rpc('pf_remove_member', { p_user_id: userId }),
    success: 'Pessoa removida do espaço.',
  });
}

/** Ensina o interpretador de voz: palavra → categoria. Silencioso. */
export function useLearnWords() {
  return useWrite<PfWordRule[], number>({
    mutationFn: (rules) => rpc<number>('pf_learn_words', { p_rules: rules }),
    toastError: false,
  });
}
