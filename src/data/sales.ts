import { from, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';
import type { ChannelPrice } from './products';

/**
 * Vendas, pedidos, entregas e clientes (Módulo 6). Leituras pelas views v_* (sem
 * embedding); toda escrita passa pelas RPCs. Três momentos independentes (seção 12):
 * confirmar (reserva e conta a receber), entregar (estoque, receita, CMV e taxas no
 * resultado) e receber (dinheiro no caixa pela baixa da parcela).
 */

export type OrderStatus = 'RASCUNHO' | 'CONFIRMADO' | 'EM_PRODUCAO' | 'PRONTO' | 'ENTREGUE' | 'CANCELADO';
export type OrderKind = 'PRONTA_ENTREGA' | 'ENCOMENDA';
export type DeliveryMethod = 'RETIRADA' | 'ENTREGA_PROPRIA' | 'CORREIOS' | 'MARKETPLACE';
export type ChannelKind = 'DIRETO' | 'REDE_SOCIAL' | 'MARKETPLACE' | 'FEIRA';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  RASCUNHO: 'Rascunho',
  CONFIRMADO: 'Confirmado',
  EM_PRODUCAO: 'Em produção',
  PRONTO: 'Pronto para entregar',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

export const ORDER_KIND_LABELS: Record<OrderKind, string> = { PRONTA_ENTREGA: 'Pronta entrega', ENCOMENDA: 'Encomenda' };

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  RETIRADA: 'Retirada pelo cliente',
  ENTREGA_PROPRIA: 'Entrega própria',
  CORREIOS: 'Correios / transportadora',
  MARKETPLACE: 'Envio do marketplace',
};

export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = { DIRETO: 'Direto', REDE_SOCIAL: 'Rede social', MARKETPLACE: 'Marketplace', FEIRA: 'Feira / evento' };

/** Status "em aberto" (compromisso assumido, ainda não entregue). */
export const OPEN_STATUSES: OrderStatus[] = ['RASCUNHO', 'CONFIRMADO', 'EM_PRODUCAO'];

export interface SalesOrderRow {
  id: number;
  number: string;
  kind: OrderKind;
  status: OrderStatus;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_instagram: string | null;
  channel_id: number;
  channel_name: string;
  channel_kind: ChannelKind;
  ordered_at: string;
  due_date: string | null;
  delivered_at: string | null;
  items_subtotal: number;
  order_discount: number;
  discount_total: number;
  shipping_charged: number;
  shipping_cost: number;
  total: number;
  channel_fee_total: number;
  payment_fee_total: number;
  tax_total: number;
  packaging_cost_total: number;
  gift_cost_total: number;
  cogs_material: number;
  cogs_energy: number;
  cogs_depreciation: number;
  cogs_operational: number;
  cogs_labor: number;
  cogs_total: number;
  is_historical: boolean;
  receivable_id: number | null;
  notes: string | null;
  cancel_reason: string | null;
  confirmed_at: string | null;
  created_at: string;
  received_amount: number;
  open_amount: number;
  overdue_amount: number;
  next_due_date: string | null;
  line_count: number;
  units: number;
  units_reserved: number;
  units_delivered: number;
  lines_summary: string | null;
  contribution_margin: number | null;
}

export interface SalesOrderLineRow {
  id: number;
  order_id: number;
  item_id: number | null;
  variant_id: number | null;
  description: string | null;
  sku: string | null;
  custom_description: string | null;
  qty: number;
  unit_price: number;
  discount: number;
  line_total: number;
  is_gift: boolean;
  qty_reserved: number;
  qty_delivered: number;
  qty_pending: number;
  item_free_qty: number | null;
  unit_cogs_material: number | null;
  unit_cogs_energy: number | null;
  unit_cogs_depreciation: number | null;
  unit_cogs_operational: number | null;
  unit_cogs_labor: number | null;
  cogs_total: number;
  historical_unit_cost: number | null;
  sort_order: number;
}

export interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  document: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  notes: string | null;
  marketing_consent: boolean;
  credit_balance: number;
  active: boolean;
  anonymized_at: string | null;
  created_at: string;
  order_count: number;
  total_purchased: number;
  last_order_at: string | null;
  open_amount: number;
  overdue_amount: number;
}

export interface SalesChannel {
  id: number;
  name: string;
  kind: ChannelKind;
  payout_days: number;
  active: boolean;
  notes: string | null;
}

export interface ChannelFee {
  id: number;
  channel_id: number;
  fee_pct: number;
  fee_fixed: number;
  fee_fixed_per: 'PEDIDO' | 'UNIDADE';
  payment_fee_pct: number;
  valid_from: string;
  valid_to: string | null;
}

export interface DeliveryRow {
  id: number;
  order_id: number;
  delivered_at: string;
  method: DeliveryMethod;
  tracking_code: string | null;
  shipping_cost: number;
  revenue: number;
  cogs_total: number;
  channel_fee: number;
  packaging_cost: number;
  notes: string | null;
  created_at: string;
}

export interface DeliveryLineRow {
  id: number;
  delivery_id: number;
  order_line_id: number;
  qty: number;
  cogs_total: number;
}

export interface OrderPackagingRow {
  id: number;
  order_id: number;
  delivery_id: number | null;
  item_id: number;
  qty: number;
  unit_cost_snapshot: number;
  total_cost: number;
}

/** Linhas de embalagem baixadas na entrega (fichas técnicas ativas). */
export interface BomDeliveryLine {
  id: number;
  bom_version_id: number;
  item_id: number;
  item_name: string;
  qty_per_unit: number;
  waste_pct: number;
  avg_cost_total: number | null;
}

export interface OrderPrintJob {
  id: number;
  code: string;
  status: string;
  planned_for: string | null;
  finished_at: string | null;
  outputs_summary: string | null;
  qty_planned: number;
  qty_good: number;
}

// ----------------------------------------------------------------------------
// Entradas das RPCs (valores decimais como texto canônico "1234.56")
// ----------------------------------------------------------------------------

export interface OrderLineInput {
  variant_id?: number | null;
  item_id?: number | null;
  custom_description?: string | null;
  qty: string;
  /** Vazio: o banco usa o preço do canal ou o de referência. */
  unit_price?: string | null;
  discount?: string | null;
  is_gift?: boolean;
  /** Só em vendas anteriores ao sistema. */
  unit_cost?: string | null;
}

export interface NewCustomerInput {
  name: string;
  phone?: string | null;
  instagram?: string | null;
}

export interface CustomerRef {
  customer_id?: number;
  new_customer?: NewCustomerInput;
}

export interface PaymentTermInput {
  label: string;
  pct?: string | null;
  amount?: string | null;
  due_date?: string | null;
}

export interface OrderInput extends CustomerRef {
  kind: OrderKind;
  channel_id: number;
  ordered_at?: string | null;
  due_date?: string | null;
  lines: OrderLineInput[];
  order_discount?: string | null;
  shipping_charged?: string | null;
  payment_terms?: PaymentTermInput[] | null;
  notes?: string | null;
  confirm?: boolean;
}

export interface PackagingInput {
  item_id: number;
  qty: string;
}

export interface DeliveryInput {
  delivered_at?: string | null;
  method: DeliveryMethod;
  tracking_code?: string | null;
  shipping_cost?: string | null;
  /** Ausente: o banco aplica as embalagens padrão (fichas + embalagem por pedido). */
  packaging?: PackagingInput[];
  lines?: Array<{ line_id: number; qty: string }>;
  notes?: string | null;
}

export interface QuickSaleInput extends CustomerRef {
  channel_id: number;
  lines: OrderLineInput[];
  order_discount?: string | null;
  shipping_charged?: string | null;
  packaging?: PackagingInput[];
  delivered_at?: string | null;
  payment: { account_id: number; amount?: string | null; fee?: string | null } | null;
  notes?: string | null;
}

export interface HistoricalSaleInput extends CustomerRef {
  date: string;
  channel_id: number;
  lines: OrderLineInput[];
  account_id?: number | null;
  notes?: string | null;
}

export interface CustomerInput {
  id?: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  document?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_district?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  notes?: string | null;
  marketing_consent?: boolean;
  active?: boolean;
}

export interface ConfirmResult {
  order_id: number;
  number: string;
  status: OrderStatus;
  receivable_id: number | null;
  missing?: Array<{ line_id: number; item_id: number; missing: number }>;
}

export interface DeliveryResult {
  delivery_id: number;
  order_id: number;
  status: OrderStatus;
  revenue: number;
  cogs: number;
  channel_fee: number;
  packaging: number;
}

export interface QuickSaleResult {
  order_id: number;
  number: string;
  delivery: DeliveryResult;
  receipt: { installment_id: number; net_amount: number } | null;
}

// ----------------------------------------------------------------------------
// Leituras
// ----------------------------------------------------------------------------

export function useSalesOrders(filter: { customerId?: number; orderedFrom?: string; channelId?: number } = {}, enabled = true) {
  return useAppQuery(
    ['sales-orders', filter],
    async () => {
      let query = from('v_sales_orders').select('*').order('ordered_at', { ascending: false }).order('id', { ascending: false });
      if (filter.customerId) query = query.eq('customer_id', filter.customerId);
      if (filter.channelId) query = query.eq('channel_id', filter.channelId);
      if (filter.orderedFrom) query = query.gte('ordered_at', filter.orderedFrom);
      return unwrap<SalesOrderRow[]>(query.limit(3000));
    },
    { enabled },
  );
}

export function useSalesOrder(id: number | undefined) {
  return useAppQuery(
    ['sales-orders', 'detail', id],
    async () => {
      const rows = await unwrap<SalesOrderRow[]>(from('v_sales_orders').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

/** Condição de pagamento gravada no pedido (não está na view). */
export function useOrderPaymentTerms(id: number | undefined) {
  return useAppQuery(
    ['sales-orders', 'terms', id],
    async () => {
      const rows = await unwrap<Array<{ id: number; payment_terms: PaymentTermInput[] | null }>>(from('sales_orders').select('id,payment_terms').eq('id', id!));
      return rows[0]?.payment_terms ?? null;
    },
    { enabled: Boolean(id) },
  );
}

export function useOrderLines(orderIds: number[], enabled = true) {
  const ids = [...orderIds].sort((a, b) => a - b);
  return useAppQuery(
    ['sales-order-lines', ids],
    () => unwrap<SalesOrderLineRow[]>(from('v_sales_order_lines').select('*').in('order_id', ids).order('order_id').order('sort_order')),
    { enabled: enabled && ids.length > 0 },
  );
}

export function useOrderDeliveries(orderId: number | undefined) {
  return useAppQuery(
    ['sales-deliveries', orderId],
    async () => {
      const deliveries = await unwrap<DeliveryRow[]>(from('deliveries').select('*').eq('order_id', orderId!).order('delivered_at'));
      const ids = deliveries.map((d) => d.id);
      const [lines, packaging] = await Promise.all([
        ids.length ? unwrap<DeliveryLineRow[]>(from('delivery_lines').select('id,delivery_id,order_line_id,qty,cogs_total').in('delivery_id', ids)) : Promise.resolve([]),
        unwrap<OrderPackagingRow[]>(from('order_packaging').select('id,order_id,delivery_id,item_id,qty,unit_cost_snapshot,total_cost').eq('order_id', orderId!)),
      ]);
      return { deliveries, lines, packaging };
    },
    { enabled: Boolean(orderId) },
  );
}

export function useOrderPrintJobs(orderId: number | undefined) {
  return useAppQuery(
    ['sales-print-jobs', orderId],
    () =>
      unwrap<OrderPrintJob[]>(
        from('v_print_jobs').select('id,code,status,planned_for,finished_at,outputs_summary,qty_planned,qty_good').eq('sales_order_id', orderId!).order('id'),
      ),
    { enabled: Boolean(orderId) },
  );
}

export function useCustomers() {
  return useAppQuery(['customers'], () => unwrap<CustomerRow[]>(from('v_customers').select('*').order('name')));
}

export function useCustomer(id: number | undefined) {
  return useAppQuery(
    ['customers', 'detail', id],
    async () => {
      const rows = await unwrap<CustomerRow[]>(from('v_customers').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

export function useSalesChannels(includeInactive = false) {
  return useAppQuery(['sales-channels', includeInactive], async () => {
    let query = from('sales_channels').select('id,name,kind,payout_days,active,notes').order('name');
    if (!includeInactive) query = query.eq('active', true);
    return unwrap<SalesChannel[]>(query);
  });
}

export function useChannelFees() {
  return useAppQuery(['sales-channel-fees'], () =>
    unwrap<ChannelFee[]>(from('sales_channel_fees').select('id,channel_id,fee_pct,fee_fixed,fee_fixed_per,payment_fee_pct,valid_from,valid_to').order('valid_from', { ascending: false })),
  );
}

/** Todos os preços por canal (tabela pequena), para o preço padrão das linhas. */
export function useAllChannelPrices() {
  return useAppQuery(['channel-prices', 'all'], () =>
    unwrap<ChannelPrice[]>(from('channel_prices').select('*').order('valid_from', { ascending: false })),
  );
}

/** Embalagens das fichas ativas (baixadas na entrega). */
export function useBomDeliveryLines(bomIds: number[]) {
  const ids = [...new Set(bomIds)].sort((a, b) => a - b);
  return useAppQuery(
    ['bom-delivery-lines', ids],
    () =>
      unwrap<BomDeliveryLine[]>(
        from('v_bom_lines').select('id,bom_version_id,item_id,item_name,qty_per_unit,waste_pct,avg_cost_total').in('bom_version_id', ids).eq('consumed_at', 'DELIVERY'),
      ),
    { enabled: ids.length > 0, placeholderData: (previous) => previous },
  );
}

// ----------------------------------------------------------------------------
// Escritas (RPCs)
// ----------------------------------------------------------------------------

export function useSaveCustomer(onSaved?: (id: number) => void) {
  return useWrite<CustomerInput, number>({
    mutationFn: (customer) => rpc<number>('save_customer', { p_customer: customer }),
    success: (_id, c) => (c.id ? 'Cliente atualizado.' : 'Cliente cadastrado.'),
    onSuccess: (id) => onSaved?.(id),
  });
}

export function useAnonymizeCustomer(onDone?: () => void) {
  return useWrite<number>({
    mutationFn: (id) => rpc('anonymize_customer', { p_customer_id: id }),
    success: 'Dados pessoais excluídos. Os pedidos continuam nos relatórios, sem identificar a pessoa.',
    onSuccess: () => onDone?.(),
  });
}

export function useCreateOrder(onDone?: (result: ConfirmResult) => void) {
  return useWrite<{ requestId: string; order: OrderInput }, ConfirmResult>({
    mutationFn: (v) => rpc('create_order', { p_request_id: v.requestId, p_order: v.order }),
    success: (r) => (r.status === 'RASCUNHO' ? `Rascunho ${r.number} salvo.` : `Pedido ${r.number} confirmado.`),
    onSuccess: (r) => onDone?.(r),
  });
}

export function useUpdateOrderDraft() {
  return useWrite<{ orderId: number; order: Partial<OrderInput> }, { order_id: number; total: number }>({
    mutationFn: (v) => rpc('update_order_draft', { p_order_id: v.orderId, p_order: v.order }),
  });
}

export function useConfirmOrder(onDone?: (result: ConfirmResult) => void) {
  return useWrite<{ requestId: string; orderId: number }, ConfirmResult>({
    mutationFn: (v) => rpc('confirm_order', { p_request_id: v.requestId, p_order_id: v.orderId }),
    success: (r) => `Pedido ${r.number} confirmado.`,
    onSuccess: (r) => onDone?.(r),
  });
}

export function useReserveLine(onDone?: () => void) {
  return useWrite<{ lineId: number; qty?: string | null }, { reserved: number }>({
    mutationFn: (v) => rpc('reserve_order_line', { p_line_id: v.lineId, p_qty: v.qty ?? null }),
    success: 'Peças reservadas para o pedido.',
    onSuccess: () => onDone?.(),
  });
}

export function useReleaseReservation(onDone?: () => void) {
  return useWrite<{ lineId: number; qty?: string | null }, { released: number }>({
    mutationFn: (v) => rpc('release_order_reservation', { p_line_id: v.lineId, p_qty: v.qty ?? null }),
    success: 'Reserva liberada: as peças voltaram ao saldo livre.',
    onSuccess: () => onDone?.(),
  });
}

export function useDeliverOrder(onDone?: (result: DeliveryResult) => void) {
  return useWrite<{ requestId: string; orderId: number; delivery: DeliveryInput }, DeliveryResult>({
    mutationFn: (v) => rpc('deliver_order', { p_request_id: v.requestId, p_order_id: v.orderId, p_delivery: v.delivery }),
    success: (r) => (r.status === 'ENTREGUE' ? 'Entrega registrada: pedido entregue.' : 'Entrega parcial registrada.'),
    onSuccess: (r) => onDone?.(r),
  });
}

export function useQuickSale(onDone?: (result: QuickSaleResult) => void) {
  return useWrite<{ requestId: string; sale: QuickSaleInput }, QuickSaleResult>({
    mutationFn: (v) => rpc('quick_sale', { p_request_id: v.requestId, p_sale: v.sale }),
    onSuccess: (r) => onDone?.(r),
    // A tela trata o erro: sem saldo livre, oferece transformar em encomenda.
    toastError: false,
  });
}

export function useRegisterHistoricalSale(onDone?: (result: { order_id: number; number: string; total: number; cogs: number }) => void) {
  return useWrite<{ requestId: string; sale: HistoricalSaleInput }, { order_id: number; number: string; total: number; cogs: number }>({
    mutationFn: (v) => rpc('register_historical_sale', { p_request_id: v.requestId, p_sale: v.sale }),
    success: (r) => `Venda anterior ${r.number} registrada.`,
    onSuccess: (r) => onDone?.(r),
  });
}

export function useCancelOrder(onDone?: () => void) {
  return useWrite<
    { requestId: string; orderId: number; reason: string; depositAction: 'REFUND' | 'CREDIT'; cancelPrintJobs: boolean },
    { order_id: number; refund_payable_id: number | null; deposit: number }
  >({
    mutationFn: (v) =>
      rpc('cancel_order', {
        p_request_id: v.requestId,
        p_order_id: v.orderId,
        p_reason: v.reason,
        p_deposit_action: v.depositAction,
        p_cancel_print_jobs: v.cancelPrintJobs,
      }),
    success: (r, v) =>
      Number(r.deposit) > 0
        ? v.depositAction === 'CREDIT'
          ? 'Pedido cancelado. O sinal virou crédito do cliente.'
          : 'Pedido cancelado. A devolução do sinal entrou em contas a pagar.'
        : 'Pedido cancelado. As reservas voltaram ao saldo livre.',
    onSuccess: () => onDone?.(),
  });
}

export function useProduceOrder(onDone?: (result: { print_job_id: number; code: string }) => void) {
  return useWrite<{ requestId: string; orderId: number; equipmentId: number }, { print_job_id: number; code: string }>({
    mutationFn: (v) => rpc('produce_order', { p_request_id: v.requestId, p_order_id: v.orderId, p_equipment_id: v.equipmentId }),
    success: (r) => `Impressão ${r.code} planejada para a encomenda.`,
    onSuccess: (r) => onDone?.(r),
  });
}
