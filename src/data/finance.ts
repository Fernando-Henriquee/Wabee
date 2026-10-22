import { from, newRequestId, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';

/** Financeiro (Módulo 7): contas, categorias, parcelas a pagar/receber, caixa, dono, DRE. */

export type Payer = 'EMPRESA' | 'DONO';
export type OwnerFundingType = 'CAPITAL_CONTRIBUTION' | 'OWNER_LOAN' | 'OWNER_PAID_EXPENSE';

export const PAYER_LABELS: Record<Payer, string> = { EMPRESA: 'Empresa', DONO: 'Dono' };
export const FUNDING_LABELS: Record<OwnerFundingType, string> = {
  CAPITAL_CONTRIBUTION: 'Aporte de capital',
  OWNER_LOAN: 'Empréstimo do dono',
  OWNER_PAID_EXPENSE: 'Despesa a reembolsar',
};
export const ACCOUNT_KIND_LABELS: Record<string, string> = { BANCO: 'Conta bancária', DINHEIRO: 'Dinheiro', CARTAO_CREDITO: 'Cartão de crédito', CARTEIRA: 'Carteira digital' };

export interface PaymentAccount {
  id: number;
  name: string;
  kind: 'BANCO' | 'DINHEIRO' | 'CARTAO_CREDITO' | 'CARTEIRA';
  owner: Payer;
  opening_balance: number;
  opening_date: string;
  card_closing_day: number | null;
  card_due_day: number | null;
  active: boolean;
  notes: string | null;
  balance: number | null;
  last_activity_on: string | null;
  unreconciled_count: number;
}

export interface FinancialCategory {
  id: number;
  parent_id: number | null;
  code: string;
  name: string;
  nature: string;
  in_income_statement: boolean;
  is_system: boolean;
  active: boolean;
}

export interface InstallmentRow {
  id: number;
  kind: 'PAGAR' | 'RECEBER';
  payable_id: number | null;
  receivable_id: number | null;
  title_number: string;
  description: string;
  source_type: string;
  source_id: number | null;
  source_ref: string | null;
  counterparty_name: string | null;
  supplier_id: number | null;
  customer_id: number | null;
  channel_id: number | null;
  number: number;
  of_total: number;
  due_date: string;
  amount: number;
  principal: number;
  interest: number;
  status: 'ABERTA' | 'PAGA' | 'CANCELADA';
  is_overdue: boolean;
  paid_on: string | null;
  paid_amount: number | null;
  fee_amount: number;
  extra_amount: number;
  discount_amount: number;
  payer: Payer;
  owner_funding_type: OwnerFundingType | null;
  account_id: number | null;
  account_name: string | null;
  account_owner: Payer | null;
  account_kind: string | null;
  category_code: string | null;
  category_name: string | null;
  parent_id: number | null;
  notes: string | null;
}

/** Link para o documento de origem de um título. */
export function titleSourceHref(row: Pick<InstallmentRow, 'source_type' | 'source_id' | 'payable_id'>): string | null {
  switch (row.source_type) {
    case 'purchase':
      return `/compras/${row.source_id}`;
    case 'sales_order':
    case 'order_refund':
      return `/vendas/${row.source_id}`;
    case 'purchase_refund':
      return `/compras/${row.source_id}`;
    default:
      return null;
  }
}

export function useAccounts(options: { includeInactive?: boolean } = {}) {
  return useAppQuery(['accounts', options.includeInactive ?? false], async () => {
    let query = from('v_payment_accounts').select('*').order('owner').order('name');
    if (!options.includeInactive) query = query.eq('active', true);
    return unwrap<PaymentAccount[]>(query);
  });
}

export function useCategories() {
  return useAppQuery(['categories'], () => unwrap<FinancialCategory[]>(from('financial_categories').select('*').order('code')));
}

export interface InstallmentFilter {
  kind?: 'PAGAR' | 'RECEBER';
  status?: 'ABERTA' | 'PAGA' | 'CANCELADA';
  payableId?: number;
  receivableId?: number;
  sourceType?: string;
  sourceId?: number;
  customerId?: number;
  dueFrom?: string;
  dueTo?: string;
}

export function useInstallments(filter: InstallmentFilter, enabled = true) {
  return useAppQuery(
    ['installments', filter],
    async () => {
      let query = from('v_installments').select('*').order('due_date').order('number');
      if (filter.kind) query = query.eq('kind', filter.kind);
      if (filter.status) query = query.eq('status', filter.status);
      if (filter.payableId) query = query.eq('payable_id', filter.payableId);
      if (filter.receivableId) query = query.eq('receivable_id', filter.receivableId);
      if (filter.sourceType) query = query.eq('source_type', filter.sourceType);
      if (filter.sourceId) query = query.eq('source_id', filter.sourceId);
      if (filter.customerId) query = query.eq('customer_id', filter.customerId);
      if (filter.dueFrom) query = query.gte('due_date', filter.dueFrom);
      if (filter.dueTo) query = query.lte('due_date', filter.dueTo);
      return unwrap<InstallmentRow[]>(query);
    },
    { enabled },
  );
}

export interface PayInstallmentInput {
  requestId: string;
  installmentId: number;
  paidOn: string;
  accountId: number | null;
  amount?: string | null;
  payer?: Payer | null;
  remainder?: 'DESCONTO' | 'SALDO';
  notes?: string | null;
}

export function usePayInstallment(onDone?: () => void) {
  return useWrite<PayInstallmentInput, { installment_id: number }>({
    mutationFn: (v) =>
      rpc('pay_installment', {
        p_request_id: v.requestId,
        p_installment_id: v.installmentId,
        p_paid_on: v.paidOn,
        p_account_id: v.accountId,
        p_amount: v.amount ?? null,
        p_payer: v.payer ?? null,
        p_remainder: v.remainder ?? 'DESCONTO',
        p_notes: v.notes ?? null,
      }),
    success: 'Pagamento registrado.',
    undo: { run: (r) => rpc('reverse_installment_payment', { p_request_id: newRequestId(), p_installment_id: r.installment_id, p_reason: 'Desfeito logo após o lançamento' }) },
    onSuccess: () => onDone?.(),
  });
}

export function usePayInstallments(onDone?: () => void) {
  return useWrite<{ requestId: string; ids: number[]; paidOn: string; accountId: number | null; payer?: Payer | null }>({
    mutationFn: (v) => rpc('pay_installments', { p_request_id: v.requestId, p_installment_ids: v.ids, p_paid_on: v.paidOn, p_account_id: v.accountId, p_payer: v.payer ?? null }),
    success: (_r, v) => `${v.ids.length} parcela(s) paga(s).`,
    onSuccess: () => onDone?.(),
  });
}

export interface ReceiveInstallmentInput {
  requestId: string;
  installmentId: number;
  receivedOn: string;
  accountId: number;
  amount?: string | null;
  fee?: string | null;
  remainder?: 'SALDO' | 'DESCONTO';
  notes?: string | null;
}

export function useReceiveInstallment(onDone?: () => void) {
  return useWrite<ReceiveInstallmentInput, { installment_id: number }>({
    mutationFn: (v) =>
      rpc('receive_installment', {
        p_request_id: v.requestId,
        p_installment_id: v.installmentId,
        p_received_on: v.receivedOn,
        p_account_id: v.accountId,
        p_amount: v.amount ?? null,
        p_fee: v.fee ?? '0',
        p_remainder: v.remainder ?? 'SALDO',
        p_notes: v.notes ?? null,
      }),
    success: 'Recebimento registrado.',
    undo: { run: (r) => rpc('reverse_installment_payment', { p_request_id: newRequestId(), p_installment_id: r.installment_id, p_reason: 'Desfeito logo após o lançamento' }) },
    onSuccess: () => onDone?.(),
  });
}

export function useReverseInstallmentPayment(onDone?: () => void) {
  return useWrite<{ installmentId: number; reason: string }>({
    mutationFn: (v) => rpc('reverse_installment_payment', { p_request_id: newRequestId(), p_installment_id: v.installmentId, p_reason: v.reason }),
    success: 'Baixa estornada: a parcela voltou a ficar em aberto.',
    onSuccess: () => onDone?.(),
  });
}

// -----------------------------------------------------------------------------
// Contas, categorias, caixa, despesas, dono, DRE e fechamento (US-7.1 a US-7.12)
// -----------------------------------------------------------------------------

export type AccountKind = PaymentAccount['kind'];

export const NATURE_LABELS: Record<string, string> = {
  RECEITA: 'Receita',
  CUSTO: 'Custo',
  DESPESA_VENDA: 'Despesa de venda',
  DESPESA_OPERACIONAL: 'Despesa operacional',
  DESPESA_FINANCEIRA: 'Despesa financeira',
  NAO_OPERACIONAL: 'Não operacional',
  INVESTIMENTO: 'Investimento',
  DONO: 'Dono',
  TRANSFERENCIA: 'Transferência',
};

/** Naturezas aceitas numa despesa avulsa. */
export const EXPENSE_NATURES = ['DESPESA_VENDA', 'DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA', 'NAO_OPERACIONAL'];

export type OwnerMovementKind =
  | 'CAPITAL_CONTRIBUTION'
  | 'OWNER_LOAN'
  | 'OWNER_PAID_EXPENSE'
  | 'OWNER_REIMBURSEMENT'
  | 'LOAN_REPAYMENT'
  | 'PRO_LABORE'
  | 'PROFIT_DISTRIBUTION'
  | 'GOODS_WITHDRAWAL';

export const OWNER_KIND_LABELS: Record<OwnerMovementKind, string> = {
  CAPITAL_CONTRIBUTION: 'Aporte de capital',
  OWNER_LOAN: 'Empréstimo do dono',
  OWNER_PAID_EXPENSE: 'Despesa paga pelo dono',
  OWNER_REIMBURSEMENT: 'Reembolso ao dono',
  LOAN_REPAYMENT: 'Devolução de empréstimo',
  PRO_LABORE: 'Pró-labore',
  PROFIT_DISTRIBUTION: 'Distribuição de lucro',
  GOODS_WITHDRAWAL: 'Retirada de produtos',
};

/** Movimentos do dono lançados à mão (os demais nascem de pagamentos e retiradas de estoque). */
export const MANUAL_OWNER_KINDS: Array<{ kind: OwnerMovementKind; direction: 'IN' | 'OUT'; hint: string }> = [
  { kind: 'CAPITAL_CONTRIBUTION', direction: 'IN', hint: 'Dinheiro do dono que entra na empresa e não volta.' },
  { kind: 'OWNER_LOAN', direction: 'IN', hint: 'Dinheiro do dono que a empresa vai devolver.' },
  { kind: 'OWNER_REIMBURSEMENT', direction: 'OUT', hint: 'A empresa devolve despesas que o dono pagou.' },
  { kind: 'LOAN_REPAYMENT', direction: 'OUT', hint: 'A empresa devolve parte do empréstimo do dono.' },
  { kind: 'PRO_LABORE', direction: 'OUT', hint: 'Remuneração pelo trabalho do dono: entra no DRE como despesa.' },
  { kind: 'PROFIT_DISTRIBUTION', direction: 'OUT', hint: 'Retirada do lucro já apurado: fora do DRE.' },
];

export interface CashTransaction {
  id: number;
  account_id: number;
  account_name: string;
  occurred_on: string;
  direction: 'IN' | 'OUT';
  amount: number;
  signed_amount: number;
  category_id: number;
  category_code: string;
  category_name: string;
  description: string | null;
  installment_id: number | null;
  transfer_group: string | null;
  owner_movement_id: number | null;
  reconciled: boolean;
  source_type: string | null;
  source_id: number | null;
  reverses_id: number | null;
  is_reversed: boolean;
  created_at: string;
}

export interface OwnerMovement {
  id: number;
  kind: OwnerMovementKind;
  occurred_on: string;
  amount: number;
  direction: 'DONO_PARA_EMPRESA' | 'EMPRESA_PARA_DONO';
  invested_delta: number;
  installment_id: number | null;
  purchase_id: number | null;
  purchase_number: string | null;
  cash_transaction_id: number | null;
  stock_movement_id: number | null;
  notes: string | null;
  reverses_id: number | null;
  is_reversed: boolean;
  created_at: string;
}

export interface ResultEntry {
  id: number;
  occurred_on: string;
  category_id: number;
  category_code: string;
  category_name: string;
  nature: string;
  amount: number;
  source_type: string | null;
  source_id: number | null;
  description: string | null;
  channel_id: number | null;
  item_id: number | null;
  reverses_id: number | null;
  created_at: string;
  source_ref: string | null;
}

export interface Payable {
  id: number;
  number: string;
  supplier_id: number | null;
  source_type: string;
  source_id: number | null;
  description: string;
  category_id: number;
  issue_date: string;
  principal_total: number;
  interest_total: number;
  total: number;
  payer: Payer;
  owner_funding_type: OwnerFundingType | null;
  status: 'ABERTO' | 'PARCIAL' | 'QUITADO' | 'CANCELADO';
  cancel_reason: string | null;
  created_at: string;
}

export interface IncomeStatementLine {
  key: string;
  label: string;
  kind: 'line' | 'total';
  codes: string[] | null;
  amount: number;
  previous: number;
  pct: number | null;
  previous_pct: number | null;
}

export interface IncomeStatement {
  from: string;
  to: string;
  compare_from: string;
  compare_to: string;
  lines: IncomeStatementLine[];
  warnings: { energy_not_reconciled: boolean; labor_not_valued: boolean };
}

export interface CashFlow {
  opening: number;
  /** Saldos iniciais de contas abertas dentro do período. */
  opened_in_period: number;
  closing: number;
  buckets: Array<{ bucket: string; inflows: number; outflows: number; net: number }>;
  categories: Array<{ code: string; name: string; direction: 'IN' | 'OUT'; amount: number }>;
}

export interface MonthClose {
  month: string;
  status: 'ABERTO' | 'FECHADO';
  closed_at: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  notes: string | null;
  metrics: { cash_balance?: number; dre?: IncomeStatement };
}

export interface MonthChecklist {
  month: string;
  open_print_jobs: number;
  outputs_in_finishing: number;
  purchases_not_received: number;
  overdue_installments: number;
  draft_purchases: number;
  stock_ok: boolean;
}

/** Lançamento de caixa → documento de origem. */
export function cashSourceHref(t: Pick<CashTransaction, 'source_type' | 'source_id'>): string | null {
  switch (t.source_type) {
    case 'purchase':
      return `/compras/${t.source_id}`;
    case 'sales_order':
      return `/vendas/${t.source_id}`;
    default:
      return null;
  }
}

/** Códigos de categoria de uma linha do DRE ("4.*" = grupo 4) aplicados a uma lista de lançamentos. */
export function matchesCodes(code: string, codes: string[] | null): boolean {
  if (!codes) return false;
  const explicit = ['1.1', '1.2', '1.4', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '3.1', '3.2', '3.3', '3.4', '3.5', '3.7'];
  return codes.some((c) => (c.endsWith('.*') ? code.startsWith(c.slice(0, -1)) && !explicit.includes(code) : c === code));
}

export function useCashTransactions(filter: { accountId?: number; from?: string; to?: string }) {
  return useAppQuery(['cash', filter], async () => {
    let query = from('v_cash_transactions').select('*').order('occurred_on', { ascending: false }).order('id', { ascending: false });
    if (filter.accountId) query = query.eq('account_id', filter.accountId);
    if (filter.from) query = query.gte('occurred_on', filter.from);
    if (filter.to) query = query.lte('occurred_on', filter.to);
    return unwrap<CashTransaction[]>(query.limit(2000));
  });
}

export function useOwnerMovements() {
  return useAppQuery(['owner-movements'], () =>
    unwrap<OwnerMovement[]>(from('v_owner_movements').select('*').order('occurred_on', { ascending: false }).order('id', { ascending: false }).limit(2000)),
  );
}

export function useResultEntries(range: { from: string; to: string }, enabled = true) {
  return useAppQuery(
    ['result-entries', range],
    () => unwrap<ResultEntry[]>(from('v_result_entries').select('*').gte('occurred_on', range.from).lte('occurred_on', range.to).order('occurred_on', { ascending: false }).limit(5000)),
    { enabled },
  );
}

export function usePayables(filter: { sourceType?: string; from?: string; to?: string }) {
  return useAppQuery(['payables', filter], async () => {
    let query = from('payables').select('*').order('issue_date', { ascending: false }).order('id', { ascending: false });
    if (filter.sourceType) query = query.eq('source_type', filter.sourceType);
    if (filter.from) query = query.gte('issue_date', filter.from);
    if (filter.to) query = query.lte('issue_date', filter.to);
    return unwrap<Payable[]>(query.limit(2000));
  });
}

export function useIncomeStatement(from_: string, to: string, compare?: { from: string; to: string } | null) {
  return useAppQuery(['income-statement', from_, to, compare ?? null], () =>
    rpc<IncomeStatement>('income_statement', { p_from: from_, p_to: to, p_compare_from: compare?.from ?? null, p_compare_to: compare?.to ?? null }),
  );
}

export function useCashFlow(from_: string, to: string, grain: 'day' | 'week' | 'month', accountId?: number | null) {
  return useAppQuery(['cash-flow', from_, to, grain, accountId ?? null], () =>
    rpc<CashFlow>('cash_flow', { p_from: from_, p_to: to, p_grain: grain, p_account_id: accountId ?? null }),
  );
}

export function useMonthCloses() {
  return useAppQuery(['month-closes'], () => unwrap<MonthClose[]>(from('month_closes').select('*').order('month', { ascending: false })));
}

export function useMonthChecklist(month: string, enabled = true) {
  return useAppQuery(['month-checklist', month], () => rpc<MonthChecklist>('month_close_checklist', { p_month: month }), { enabled });
}

export interface AccountInput {
  id?: number;
  name: string;
  kind: AccountKind;
  owner: Payer;
  opening_balance?: string | null;
  opening_date?: string | null;
  card_closing_day?: number | null;
  card_due_day?: number | null;
  active?: boolean;
  notes?: string | null;
}

export function useSaveAccount(onSaved?: (id: number) => void) {
  return useWrite<AccountInput, number>({
    mutationFn: (account) => rpc<number>('save_payment_account', { p_account: account }),
    success: (_id, a) => (a.id ? 'Conta atualizada.' : 'Conta cadastrada.'),
    onSuccess: (id) => onSaved?.(id),
  });
}

export function useSaveCategory(onSaved?: (id: number) => void) {
  return useWrite<{ id?: number; parent_id?: number; name?: string; active?: boolean }, number>({
    mutationFn: (category) => rpc<number>('save_financial_category', { p_category: category }),
    success: (_id, c) => (c.id ? (c.active === false ? 'Categoria desativada.' : 'Categoria atualizada.') : 'Categoria criada.'),
    onSuccess: (id) => onSaved?.(id),
  });
}

export interface ExpenseInput {
  requestId: string;
  description: string;
  category_id: number;
  amount: string;
  business_share_pct?: string | null;
  competence_date: string;
  due_date: string;
  supplier_id?: number | null;
  paid: boolean;
  paid_on?: string | null;
  account_id?: number | null;
  payer?: Payer;
  owner_funding_type?: OwnerFundingType | null;
}

export function useCreateExpense(onDone?: () => void) {
  return useWrite<ExpenseInput, { payable_id: number; installment_id: number }>({
    mutationFn: ({ requestId, ...expense }) => rpc('create_expense', { p_request_id: requestId, p_expense: expense }),
    success: (_r, v) => (v.paid ? 'Despesa lançada e paga.' : 'Despesa lançada em contas a pagar.'),
    undo: { run: (r) => rpc('cancel_expense', { p_request_id: newRequestId(), p_payable_id: r.payable_id, p_reason: 'Desfeito logo após o lançamento' }) },
    onSuccess: () => onDone?.(),
  });
}

export function useCancelExpense(onDone?: () => void) {
  return useWrite<{ payableId: number; reason: string }>({
    mutationFn: (v) => rpc('cancel_expense', { p_request_id: newRequestId(), p_payable_id: v.payableId, p_reason: v.reason }),
    success: 'Despesa cancelada.',
    onSuccess: () => onDone?.(),
  });
}

export function useRegisterOwnerMovement(onDone?: (warning: string | null) => void) {
  return useWrite<
    { requestId: string; kind: OwnerMovementKind; amount: string; occurredOn: string; accountId: number; notes?: string | null },
    { owner_movement_id: number; warning: string | null }
  >({
    mutationFn: (v) =>
      rpc('register_owner_movement', { p_request_id: v.requestId, p_kind: v.kind, p_amount: v.amount, p_occurred_on: v.occurredOn, p_account_id: v.accountId, p_notes: v.notes ?? null }),
    success: (_r, v) => `${OWNER_KIND_LABELS[v.kind]} registrado.`,
    undo: { run: (r) => rpc('reverse_owner_movement', { p_request_id: newRequestId(), p_owner_movement_id: r.owner_movement_id, p_reason: 'Desfeito logo após o lançamento' }) },
    onSuccess: (r) => onDone?.(r.warning ?? null),
  });
}

export function useReverseOwnerMovement(onDone?: () => void) {
  return useWrite<{ id: number; reason: string }>({
    mutationFn: (v) => rpc('reverse_owner_movement', { p_request_id: newRequestId(), p_owner_movement_id: v.id, p_reason: v.reason }),
    success: 'Movimento estornado.',
    onSuccess: () => onDone?.(),
  });
}

export function useTransfer(onDone?: () => void) {
  return useWrite<{ requestId: string; fromId: number; toId: number; amount: string; occurredOn: string; notes?: string | null }>({
    mutationFn: (v) =>
      rpc('transfer_between_accounts', { p_request_id: v.requestId, p_from_account_id: v.fromId, p_to_account_id: v.toId, p_amount: v.amount, p_occurred_on: v.occurredOn, p_notes: v.notes ?? null }),
    success: 'Transferência registrada.',
    onSuccess: () => onDone?.(),
  });
}

export function useCloseMonth(onDone?: () => void) {
  return useWrite<{ month: string; notes?: string | null }>({
    mutationFn: (v) => rpc('close_month', { p_month: v.month, p_notes: v.notes ?? null }),
    success: 'Mês fechado: lançamentos com data nele ficam bloqueados.',
    onSuccess: () => onDone?.(),
  });
}

export function useReopenMonth(onDone?: () => void) {
  return useWrite<{ month: string; reason: string }>({
    mutationFn: (v) => rpc('reopen_month', { p_month: v.month, p_reason: v.reason }),
    success: 'Mês reaberto.',
    onSuccess: () => onDone?.(),
  });
}
