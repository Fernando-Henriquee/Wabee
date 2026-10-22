import { type ChannelFee, FEE_FIXED_PER_LABELS } from '@/data/settings';
import { formatBRL, formatPercent, toNumber } from '@/lib/money';

/** Texto curto das taxas: "12% + R$ 4,00 por pedido · pagamento 3,5%". */
export function describeFee(fee: Pick<ChannelFee, 'fee_pct' | 'fee_fixed' | 'fee_fixed_per' | 'payment_fee_pct'> | null): string {
  if (!fee) return 'Sem tabela de taxas';
  const parts: string[] = [];
  if (toNumber(fee.fee_pct) > 0) parts.push(formatPercent(fee.fee_pct, 2));
  if (toNumber(fee.fee_fixed) > 0) parts.push(`${formatBRL(fee.fee_fixed)} ${FEE_FIXED_PER_LABELS[fee.fee_fixed_per]}`);
  const channel = parts.length ? parts.join(' + ') : 'sem taxa do canal';
  return toNumber(fee.payment_fee_pct) > 0 ? `${channel} · pagamento ${formatPercent(fee.payment_fee_pct, 2)}` : channel;
}

export function payoutLabel(days: number): string {
  if (days <= 0) return 'na hora';
  return days === 1 ? 'em 1 dia' : `em ${days} dias`;
}
