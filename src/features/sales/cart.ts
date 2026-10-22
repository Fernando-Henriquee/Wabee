import Big from 'big.js';
import type { ChannelPrice } from '@/data/products';
import type { BomDeliveryLine, ChannelFee, PaymentTermInput } from '@/data/sales';
import { formatDateBR } from '@/lib/dates';
import { formatBRL, formatNumber, type Numeric } from '@/lib/money';

/**
 * Espelhos das regras do banco para as PRÉVIAS de venda (o banco recalcula e grava):
 * totais do pedido (refresh_order_totals), taxa do canal (channel_fee_for, RN-12),
 * parcelas (order_installments), embalagens padrão (default_packaging) e margem de
 * contribuição (RN-13, v_sales_orders.contribution_margin).
 */

const big = (value: Numeric) => new Big(value === null || value === undefined || value === '' ? 0 : value);
const money = (value: Big) => value.round(2, Big.roundHalfUp);

export interface CartLine {
  qty: Numeric;
  unitPrice: Numeric;
  discount?: Numeric;
  isGift?: boolean;
  /** Custo unitário estimado (custo médio do estoque). */
  unitCost?: Numeric;
}

/** Total da linha: qtd × preço − desconto (brinde = 0). */
export function lineTotal(line: CartLine): string {
  if (line.isGift) return '0.00';
  return money(big(line.qty).times(big(line.unitPrice))).minus(big(line.discount)).toFixed(2);
}

export interface OrderTotals {
  subtotal: string;
  lineDiscounts: string;
  discountTotal: string;
  /** Produtos − descontos: base da taxa do canal e dos impostos. */
  net: string;
  total: string;
  /** Unidades vendidas (sem brindes): base da taxa fixa por unidade. */
  units: string;
}

/** total = subtotal − descontos (linhas + pedido) + frete cobrado. */
export function orderTotals(lines: CartLine[], orderDiscount: Numeric = 0, shippingCharged: Numeric = 0): OrderTotals {
  let subtotal = new Big(0);
  let lineDiscounts = new Big(0);
  let units = new Big(0);
  for (const line of lines) {
    if (line.isGift) continue;
    subtotal = subtotal.plus(money(big(line.qty).times(big(line.unitPrice))));
    lineDiscounts = lineDiscounts.plus(money(big(line.discount)));
    units = units.plus(big(line.qty));
  }
  const discountTotal = lineDiscounts.plus(money(big(orderDiscount)));
  const net = subtotal.minus(discountTotal);
  return {
    subtotal: subtotal.toFixed(2),
    lineDiscounts: lineDiscounts.toFixed(2),
    discountTotal: discountTotal.toFixed(2),
    net: net.toFixed(2),
    total: net.plus(money(big(shippingCharged))).toFixed(2),
    units: units.toString(),
  };
}

function inRange(on: string, validFrom: string, validTo: string | null) {
  return validFrom <= on && (validTo === null || validTo >= on);
}

/** Taxas do canal vigentes na data (a mais recente que cobre a data). */
export function currentFee(fees: ChannelFee[] | undefined, channelId: number | null | undefined, on: string): ChannelFee | null {
  if (!fees || !channelId) return null;
  return (
    fees
      .filter((f) => f.channel_id === channelId && inRange(on, f.valid_from, f.valid_to))
      .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0] ?? null
  );
}

/** Preço da variação no canal (vigente) ou o preço de referência. */
export function priceFor(
  variant: { id: number; reference_price: number | null },
  prices: Array<Pick<ChannelPrice, 'variant_id' | 'channel_id' | 'price' | 'valid_from' | 'valid_to'>> | undefined,
  channelId: number | null | undefined,
  on: string,
): number | null {
  const match = (prices ?? [])
    .filter((p) => p.variant_id === variant.id && p.channel_id === channelId && inRange(on, p.valid_from, p.valid_to))
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
  if (match) return Number(match.price);
  return variant.reference_price === null || variant.reference_price === undefined ? null : Number(variant.reference_price);
}

/** RN-12: % sobre (subtotal − descontos) + fixo por pedido (só na 1ª entrega) ou por unidade. */
export function channelFeeAmount(fee: Pick<ChannelFee, 'fee_pct' | 'fee_fixed' | 'fee_fixed_per'> | null, net: Numeric, units: Numeric, includeFixed = true): string {
  if (!fee) return '0.00';
  const netValue = big(net);
  const pct = big(fee.fee_pct).times(netValue.gt(0) ? netValue : 0);
  const fixed = !includeFixed ? new Big(0) : fee.fee_fixed_per === 'UNIDADE' ? big(fee.fee_fixed).times(big(units)) : big(fee.fee_fixed);
  return money(pct.plus(fixed)).toFixed(2);
}

export interface InstallmentPreview {
  label: string;
  amount: string;
  dueDate: string;
}

/**
 * Parcelas a partir da condição de pagamento (order_installments): % ou valor por
 * linha, a última recebe o restante. Marketplace: valor esperado já sem a taxa do canal.
 */
export function previewInstallments(expected: Numeric, terms: PaymentTermInput[], defaultDue: string): { rows: InstallmentPreview[]; invalid: boolean } {
  const total = money(big(expected));
  if (terms.length === 0) return { rows: [{ label: 'Parcela única', amount: total.toFixed(2), dueDate: defaultDue }], invalid: total.lt(0) };
  let sum = new Big(0);
  let invalid = false;
  const rows = terms.map((term, index) => {
    let amount: Big;
    if (index === terms.length - 1) amount = total.minus(sum);
    else if (term.pct !== null && term.pct !== undefined && term.pct !== '') amount = money(total.times(big(term.pct)));
    else amount = money(big(term.amount));
    if (amount.lt(0)) invalid = true;
    sum = sum.plus(amount);
    return { label: term.label, amount: amount.toFixed(2), dueDate: term.due_date || defaultDue };
  });
  return { rows, invalid };
}

/**
 * Embalagens padrão da entrega (default_packaging): linhas DELIVERY das fichas ativas ×
 * quantidade (com perda) + a embalagem padrão por pedido na primeira entrega.
 */
export function defaultPackaging(
  lines: Array<{ bomId: number | null | undefined; qty: Numeric }>,
  bomLines: BomDeliveryLine[] | undefined,
  defaultItemId: number | null | undefined,
  firstDelivery: boolean,
): Map<number, string> {
  const totals = new Map<number, Big>();
  for (const line of lines) {
    if (!line.bomId) continue;
    for (const bl of bomLines ?? []) {
      if (bl.bom_version_id !== line.bomId) continue;
      const qty = big(bl.qty_per_unit).times(big(1).plus(big(bl.waste_pct))).times(big(line.qty));
      totals.set(bl.item_id, (totals.get(bl.item_id) ?? new Big(0)).plus(qty));
    }
  }
  if (defaultItemId && firstDelivery) totals.set(defaultItemId, (totals.get(defaultItemId) ?? new Big(0)).plus(1));
  const result = new Map<number, string>();
  for (const [itemId, qty] of totals) {
    const rounded = qty.round(3, Big.roundHalfUp);
    if (rounded.gt(0)) result.set(itemId, rounded.toString());
  }
  return result;
}

export interface MarginInput {
  lines: CartLine[];
  orderDiscount?: Numeric;
  shippingCharged?: Numeric;
  fee: Pick<ChannelFee, 'fee_pct' | 'fee_fixed' | 'fee_fixed_per' | 'payment_fee_pct'> | null;
  /** Taxa de pagamento informada (ex.: maquininha); vazio = % do canal × total. */
  paymentFee?: Numeric | null;
  packagingCost?: Numeric;
  shippingCost?: Numeric;
  /** Fração de imposto sobre a venda (só no Simples). */
  taxPct?: Numeric;
}

export interface MarginPreview extends OrderTotals {
  cogs: string;
  giftCost: string;
  channelFee: string;
  paymentFee: string;
  packaging: string;
  shippingCost: string;
  tax: string;
  margin: string;
  /** Margem ÷ produtos líquidos (null sem receita). */
  marginPct: number | null;
  /** Alguma linha sem custo conhecido. */
  missingCost: boolean;
}

/** RN-13: MC = total − CMV − taxa do canal − taxa de pagamento − embalagem − frete pago − impostos − brindes. */
export function estimateMargin(input: MarginInput): MarginPreview {
  const totals = orderTotals(input.lines, input.orderDiscount, input.shippingCharged);
  let cogs = new Big(0);
  let gift = new Big(0);
  let missingCost = false;
  for (const line of input.lines) {
    if (line.unitCost === null || line.unitCost === undefined || line.unitCost === '') missingCost = true;
    const cost = money(big(line.qty).times(big(line.unitCost)));
    if (line.isGift) gift = gift.plus(cost);
    else cogs = cogs.plus(cost);
  }
  const channelFee = channelFeeAmount(input.fee, totals.net, totals.units, true);
  const paymentFee =
    input.paymentFee !== null && input.paymentFee !== undefined && input.paymentFee !== ''
      ? money(big(input.paymentFee)).toFixed(2)
      : money(big(totals.total).times(big(input.fee?.payment_fee_pct))).toFixed(2);
  const tax = money(big(totals.net).times(big(input.taxPct))).toFixed(2);
  const packaging = money(big(input.packagingCost)).toFixed(2);
  const shippingCost = money(big(input.shippingCost)).toFixed(2);
  const margin = big(totals.total).minus(cogs).minus(channelFee).minus(paymentFee).minus(packaging).minus(shippingCost).minus(tax).minus(gift);
  const net = big(totals.net);
  return {
    ...totals,
    cogs: cogs.toFixed(2),
    giftCost: gift.toFixed(2),
    channelFee,
    paymentFee,
    packaging,
    shippingCost,
    tax,
    margin: margin.toFixed(2),
    marginPct: net.gt(0) ? Number(margin.div(net)) : null,
    missingCost,
  };
}

/** Taxa de pagamento sugerida: % do canal × valor recebido. */
export function suggestedPaymentFee(amount: Numeric, paymentFeePct: Numeric): string {
  return money(big(amount).times(big(paymentFeePct))).toFixed(2);
}

export interface SummaryOrder {
  number: string;
  company: string;
  customerName?: string | null;
  dueDate?: string | null;
  lines: Array<{ description: string; qty: Numeric; total: Numeric; isGift?: boolean }>;
  subtotal: Numeric;
  discountTotal: Numeric;
  shippingCharged: Numeric;
  total: Numeric;
  installments?: Array<{ label: string; amount: Numeric; dueDate: string | null; paid?: boolean }>;
  notes?: string | null;
}

/** Texto do pedido para colar no WhatsApp (negrito com *asteriscos*). */
export function orderSummaryText(order: SummaryOrder): string {
  const out: string[] = [`*Pedido ${order.number}* — ${order.company}`];
  if (order.customerName) out.push(`Cliente: ${order.customerName}`);
  out.push('');
  for (const line of order.lines) {
    out.push(`• ${formatNumber(line.qty)}× ${line.description} — ${line.isGift ? 'brinde' : formatBRL(line.total)}`);
  }
  out.push('');
  if (big(order.discountTotal).gt(0) || big(order.shippingCharged).gt(0)) {
    out.push(`Subtotal: ${formatBRL(order.subtotal)}`);
    if (big(order.discountTotal).gt(0)) out.push(`Desconto: −${formatBRL(order.discountTotal)}`);
    if (big(order.shippingCharged).gt(0)) out.push(`Frete: ${formatBRL(order.shippingCharged)}`);
  }
  out.push(`*Total: ${formatBRL(order.total)}*`);
  if (order.installments && order.installments.length > 0) {
    out.push('');
    out.push('Pagamento:');
    for (const inst of order.installments) {
      out.push(`• ${inst.label}: ${formatBRL(inst.amount)}${inst.dueDate ? ` (${formatDateBR(inst.dueDate)})` : ''}${inst.paid ? ' — pago ✓' : ''}`);
    }
  }
  if (order.dueDate) out.push(`Entrega prevista: ${formatDateBR(order.dueDate)}`);
  if (order.notes) out.push(`Obs.: ${order.notes}`);
  return out.join('\n');
}
