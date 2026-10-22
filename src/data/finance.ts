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
