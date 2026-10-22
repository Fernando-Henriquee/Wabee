import { from, rpc, unwrap } from './api';
import type { OwnerFundingType, Payer } from './finance';
import { useAppQuery, useWrite } from './hooks';
import type { ItemKind, ItemUnit, Supplier } from './inventory';

/** Compras, recebimento e fornecedores (Módulo 3). Leituras pelas views v_purchases / v_purchase_lines. */

export type PurchaseStatus = 'RASCUNHO' | 'CONFIRMADA' | 'RECEBIDA_PARCIAL' | 'RECEBIDA' | 'CANCELADA';
export type PaymentMethod = 'PIX' | 'DINHEIRO' | 'DEBITO' | 'CREDITO_VISTA' | 'CREDITO_PARCELADO' | 'BOLETO';
export type LineKind = 'ITEM' | 'EQUIPMENT' | 'EXPENSE';
export type SupplierKind = NonNullable<Supplier['kind']>;
export type EquipmentKind = 'PRINTER' | 'DRYER' | 'POST_PROCESS' | 'OTHER';

export const STATUS_LABELS: Record<PurchaseStatus, string> = {
  RASCUNHO: 'Rascunho',
  CONFIRMADA: 'Confirmada',
  RECEBIDA_PARCIAL: 'Recebida parcialmente',
  RECEBIDA: 'Recebida',
  CANCELADA: 'Cancelada',
};

export const STATUS_ORDER: PurchaseStatus[] = ['RASCUNHO', 'CONFIRMADA', 'RECEBIDA_PARCIAL', 'RECEBIDA', 'CANCELADA'];

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Débito',
  CREDITO_VISTA: 'Crédito à vista',
  CREDITO_PARCELADO: 'Crédito parcelado',
  BOLETO: 'Boleto',
};

export const METHOD_ORDER: PaymentMethod[] = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO_VISTA', 'CREDITO_PARCELADO', 'BOLETO'];

export const LINE_KIND_LABELS: Record<LineKind, string> = { ITEM: 'Item do estoque', EQUIPMENT: 'Equipamento', EXPENSE: 'Despesa' };

export const SUPPLIER_KIND_LABELS: Record<SupplierKind, string> = { LOJA_ONLINE: 'Loja online', MARKETPLACE: 'Marketplace', LOJA_FISICA: 'Loja física' };

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  PRINTER: 'Impressora',
  DRYER: 'Secador',
  POST_PROCESS: 'Pós-processamento',
  OTHER: 'Outro',
};

/** Naturezas aceitas nas linhas de despesa (filhas destas raízes). */
export const EXPENSE_NATURES = ['DESPESA_VENDA', 'DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA', 'NAO_OPERACIONAL'];

export interface PurchaseRow {
  id: number;
  number: string;
  supplier_id: number | null;
  supplier_name: string | null;
  purchased_at: string;
  invoice_ref: string | null;
  status: PurchaseStatus;
  goods_total: number;
  freight_total: number;
  discount_total: number;
  cash_price_total: number;
  total: number;
  interest_total: number;
  interest_unknown: boolean;
  payment_method: PaymentMethod;
  payment_account_id: number | null;
  payment_account_name: string | null;
  payer: Payer;
  owner_funding_type: OwnerFundingType | null;
  installments_count: number;
  first_due_date: string | null;
  is_opening: boolean;
  manually_allocated: boolean;
  payable_id: number | null;
  notes: string | null;
  confirmed_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  installments_paid: number;
  installments_total_count: number;
  paid_by_owner: number;
  paid_by_company: number;
  open_amount: number;
  next_due_date: string | null;
  lines_summary: string | null;
}

/** Linha da tabela purchases (rascunho para edição: inclui as parcelas editadas). */
export interface PurchaseRecord {
  id: number;
  number: string;
  supplier_id: number | null;
  purchased_at: string;
  invoice_ref: string | null;
  status: PurchaseStatus;
  freight_total: number;
  discount_total: number;
  cash_price_total: number;
  installments_total: number | null;
  interest_unknown: boolean;
  payment_method: PaymentMethod;
  payment_account_id: number | null;
  payer: Payer;
  owner_funding_type: OwnerFundingType | null;
  installments_count: number;
  first_due_date: string | null;
  custom_installments: Array<{ due_date: string; amount: number | string }> | null;
  is_opening: boolean;
  manually_allocated: boolean;
  notes: string | null;
}

export interface PurchaseLineRow {
  id: number;
  purchase_id: number;
  line_kind: LineKind;
  item_id: number | null;
  sku: string | null;
  item_name: string | null;
  item_kind: ItemKind | null;
  unit: ItemUnit | null;
  is_stock_tracked: boolean | null;
  color_hex: string | null;
  nominal_spool_g: number | null;
  equipment_id: number | null;
  expense_category_id: number | null;
  expense_category_code: string | null;
  expense_category_name: string | null;
  description: string;
  qty: number;
  unit_price: number;
  line_total: number;
  freight_alloc: number;
  discount_alloc: number;
  landed_total: number;
  landed_unit_cost: number;
  qty_received: number;
  qty_pending: number;
  sort_order: number;
}

export interface ReceiptRow {
  id: number;
  purchase_id: number;
  received_at: string;
  notes: string | null;
  reversed_at: string | null;
  reverse_reason: string | null;
  created_at: string;
}

export interface ReceiptLineRow {
  id: number;
  receipt_id: number;
  purchase_line_id: number;
  qty: number;
  stock_qty: number;
  spool_count: number | null;
  lot_codes: string[];
  movement_ids: number[];
  equipment_ids: number[];
}

/** Linha que passa por recebimento (equipamento ou item com controle de saldo). */
export function isReceivable(line: Pick<PurchaseLineRow, 'line_kind' | 'is_stock_tracked'>): boolean {
  return line.line_kind === 'EQUIPMENT' || (line.line_kind === 'ITEM' && Boolean(line.is_stock_tracked));
}

export interface PurchaseFilter {
  from?: string;
  to?: string;
  supplierId?: number;
}

export function usePurchases(filter: PurchaseFilter = {}, enabled = true) {
  return useAppQuery(
    ['purchases', 'list', filter],
    async () => {
      let query = from('v_purchases').select('*').order('purchased_at', { ascending: false }).order('id', { ascending: false });
      if (filter.from) query = query.gte('purchased_at', filter.from);
      if (filter.to) query = query.lte('purchased_at', filter.to);
      if (filter.supplierId) query = query.eq('supplier_id', filter.supplierId);
      return unwrap<PurchaseRow[]>(query);
    },
    { enabled },
  );
}

export function usePurchase(id: number | undefined) {
  return useAppQuery(
    ['purchases', 'detail', id],
    async () => {
      const rows = await unwrap<PurchaseRow[]>(from('v_purchases').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

/** Registro bruto (tabela purchases) para editar o rascunho com as parcelas editadas. */
export function usePurchaseRecord(id: number | undefined) {
  return useAppQuery(
    ['purchases', 'record', id],
    async () => {
      const rows = await unwrap<PurchaseRecord[]>(from('purchases').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

export function usePurchaseLines(purchaseIds: number[] | undefined) {
  const ids = purchaseIds ?? [];
  return useAppQuery(
    ['purchases', 'lines', ids],
    async () => {
      if (ids.length === 0) return [];
      const query = ids.length === 1 ? from('v_purchase_lines').select('*').eq('purchase_id', ids[0]!) : from('v_purchase_lines').select('*').in('purchase_id', ids);
      return unwrap<PurchaseLineRow[]>(query.order('purchase_id').order('sort_order'));
    },
    { enabled: purchaseIds !== undefined },
  );
}

export function useReceipts(purchaseId: number | undefined) {
  return useAppQuery(
    ['purchases', 'receipts', purchaseId],
    async () => {
      const receipts = await unwrap<ReceiptRow[]>(from('receipts').select('*').eq('purchase_id', purchaseId!).order('received_at', { ascending: false }).order('id', { ascending: false }));
      const lines =
        receipts.length === 0
          ? []
          : await unwrap<ReceiptLineRow[]>(
              from('receipt_lines')
                .select('*')
                .in(
                  'receipt_id',
                  receipts.map((r) => r.id),
                )
                .order('id'),
            );
      return receipts.map((receipt) => ({ ...receipt, lines: lines.filter((l) => l.receipt_id === receipt.id) }));
    },
    { enabled: Boolean(purchaseId) },
  );
}

export function useSupplier(id: number | undefined) {
  return useAppQuery(
    ['suppliers', 'detail', id],
    async () => {
      const rows = await unwrap<Supplier[]>(from('suppliers').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

export interface PurchaseLineInput {
  line_kind: LineKind;
  item_id?: number | null;
  expense_category_id?: number | null;
  description?: string | null;
  qty: string;
  unit_price: string;
}

export interface PurchaseDraftInput {
  id?: number;
  supplier_id?: number | null;
  new_supplier_name?: string | null;
  purchased_at: string;
  invoice_ref?: string | null;
  freight_total?: string | null;
  discount_total?: string | null;
  payment_method: PaymentMethod;
  payment_account_id?: number | null;
  payer: Payer;
  owner_funding_type?: OwnerFundingType | null;
  installments_count: number;
  first_due_date?: string | null;
  installments_total?: string | null;
  interest_unknown: boolean;
  custom_installments?: Array<{ due_date: string; amount: string }> | null;
  is_opening: boolean;
  manually_allocated: boolean;
  notes?: string | null;
  lines: PurchaseLineInput[];
}

export interface DraftResult {
  purchase_id: number;
  number: string;
  goods_total: number;
  cash_price_total: number;
  installments: Array<{ due_date: string; amount: number }>;
}

export function useSavePurchaseDraft() {
  return useWrite<PurchaseDraftInput, DraftResult>({
    mutationFn: (purchase) => rpc<DraftResult>('save_purchase_draft', { p_purchase: purchase }),
    success: (r, v) => (v.id ? `Rascunho ${r.number} atualizado.` : `Rascunho ${r.number} salvo: nada mudou no estoque nem no financeiro.`),
    toastError: false,
  });
}

export function useDiscardPurchaseDraft(onDone?: () => void) {
  return useWrite<number>({
    mutationFn: (id) => rpc('discard_purchase_draft', { p_purchase_id: id }),
    success: 'Rascunho descartado.',
    onSuccess: () => onDone?.(),
  });
}

export function useConfirmPurchase(onDone?: () => void) {
  return useWrite<{ requestId: string; purchaseId: number; paidCount?: number }, { purchase_id: number; payable_id: number; paid_installments: number }>({
    mutationFn: (v) => rpc('confirm_purchase', { p_request_id: v.requestId, p_purchase_id: v.purchaseId, p_paid_count: v.paidCount ?? 0 }),
    success: (r) => (r.paid_installments > 0 ? `Compra confirmada: conta a pagar criada, ${r.paid_installments} parcela(s) já baixada(s).` : 'Compra confirmada: conta a pagar criada.'),
    onSuccess: () => onDone?.(),
  });
}

export interface ReceiveLineInput {
  line_id: number;
  qty?: string | null;
  spool_count?: number | null;
  spools?: string[] | null;
  equipment?: {
    name: string;
    kind?: EquipmentKind;
    useful_life_hours?: string | null;
    avg_power_w?: string | null;
    initial_hours?: string | null;
    maintenance_interval_hours?: string | null;
    residual_value?: string | null;
  } | null;
}

export interface ReceiveInput {
  requestId: string;
  purchaseId: number;
  lines: ReceiveLineInput[];
  receivedAt?: string | null;
  /** "Confirmar e receber": as duas operações numa transação. */
  confirm?: boolean;
  paidCount?: number;
}

export function useReceivePurchase(onDone?: () => void) {
  return useWrite<ReceiveInput, { receipt_id?: number }>({
    mutationFn: (v) =>
      v.confirm
        ? rpc('confirm_and_receive_purchase', {
            p_request_id: v.requestId,
            p_purchase_id: v.purchaseId,
            p_lines: v.lines,
            p_received_at: v.receivedAt ?? null,
            p_paid_count: v.paidCount ?? 0,
          })
        : rpc('receive_purchase', { p_request_id: v.requestId, p_purchase_id: v.purchaseId, p_lines: v.lines, p_received_at: v.receivedAt ?? null }),
    success: (_r, v) => (v.confirm ? 'Compra confirmada e recebida: estoque e contas a pagar atualizados.' : 'Recebimento registrado: o estoque foi atualizado.'),
    onSuccess: () => onDone?.(),
    toastError: false,
  });
}

export function useReverseReceipt(onDone?: () => void) {
  return useWrite<{ requestId: string; receiptId: number; reason: string }>({
    mutationFn: (v) => rpc('reverse_receipt', { p_request_id: v.requestId, p_receipt_id: v.receiptId, p_reason: v.reason }),
    success: 'Recebimento estornado: as entradas no estoque foram revertidas.',
    onSuccess: () => onDone?.(),
  });
}

export function useCancelPurchase(onDone?: (result: { refund_receivable_id: number | null }) => void) {
  return useWrite<{ requestId: string; purchaseId: number; reason: string }, { purchase_id: number; refund_receivable_id: number | null }>({
    mutationFn: (v) => rpc('cancel_purchase', { p_request_id: v.requestId, p_purchase_id: v.purchaseId, p_reason: v.reason }),
    success: (r) =>
      r.refund_receivable_id ? 'Compra cancelada. O que já foi pago virou um reembolso a receber do fornecedor.' : 'Compra cancelada. As parcelas em aberto foram canceladas.',
    onSuccess: (r) => onDone?.(r),
    toastError: false,
  });
}
