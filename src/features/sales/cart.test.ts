import { describe, expect, it } from 'vitest';
import type { BomDeliveryLine, ChannelFee } from '@/data/sales';
import { channelFeeAmount, currentFee, defaultPackaging, estimateMargin, orderSummaryText, orderTotals, previewInstallments, priceFor } from './cart';

const fee = (over: Partial<ChannelFee> = {}): ChannelFee => ({
  id: 1,
  channel_id: 1,
  fee_pct: 0,
  fee_fixed: 0,
  fee_fixed_per: 'PEDIDO',
  payment_fee_pct: 0,
  valid_from: '2026-01-01',
  valid_to: null,
  ...over,
});

describe('prévias de venda (espelho das regras do banco)', () => {
  it('primeira venda da Wabee: 2 × R$ 5,00 com custo R$ 1,66 → margem R$ 6,68 (66,8%)', () => {
    const m = estimateMargin({ lines: [{ qty: 2, unitPrice: 5, unitCost: 1.66 }], fee: null });
    expect(m.total).toBe('10.00');
    expect(m.cogs).toBe('3.32');
    expect(m.margin).toBe('6.68');
    expect(m.marginPct).toBeCloseTo(0.668, 3);
  });

  it('venda rápida: MC = 10 − 2,78 − 0,20 (taxa) − 0,25 (embalagem) = 6,77', () => {
    const m = estimateMargin({ lines: [{ qty: 2, unitPrice: 5, unitCost: 1.39 }], fee: fee(), paymentFee: '0.2', packagingCost: 0.25 });
    expect(m.margin).toBe('6.77');
  });

  it('brinde: preço zero, custo vai para Marketing (fora do CMV)', () => {
    const m = estimateMargin({ lines: [{ qty: 1, unitPrice: 5, unitCost: 1.19 }, { qty: 1, unitPrice: 0, unitCost: 1.39, isGift: true }], fee: null });
    expect(m.total).toBe('5.00');
    expect(m.cogs).toBe('1.19');
    expect(m.giftCost).toBe('1.39');
    expect(m.units).toBe('1');
  });

  it('totais: descontos de linha e do pedido, frete cobrado', () => {
    const t = orderTotals([{ qty: 3, unitPrice: 4.5, discount: 1 }, { qty: 1, unitPrice: 10 }], 2, 8);
    expect(t.subtotal).toBe('23.50');
    expect(t.discountTotal).toBe('3.00');
    expect(t.net).toBe('20.50');
    expect(t.total).toBe('28.50');
  });

  it('taxa do canal (marketplace): 20% × 20 + R$ 1 fixo = R$ 5', () => {
    expect(channelFeeAmount(fee({ fee_pct: 0.2, fee_fixed: 1 }), 20, 2)).toBe('5.00');
    expect(channelFeeAmount(fee({ fee_pct: 0.1, fee_fixed: 0.5, fee_fixed_per: 'UNIDADE' }), 20, 4)).toBe('4.00');
    expect(channelFeeAmount(fee({ fee_pct: 0.2, fee_fixed: 1 }), 20, 2, false)).toBe('4.00');
  });

  it('parcelas: 50% de sinal + restante na entrega; valor fixo + saldo', () => {
    const half = previewInstallments(48, [{ label: 'Sinal', pct: '0.5', due_date: '2026-10-21' }, { label: 'Na entrega' }], '2026-11-10');
    expect(half.rows.map((r) => [r.amount, r.dueDate])).toEqual([
      ['24.00', '2026-10-21'],
      ['24.00', '2026-11-10'],
    ]);
    const fixed = previewInstallments(10, [{ label: 'Sinal', amount: '3' }, { label: 'Saldo' }], '2026-11-10');
    expect(fixed.rows.map((r) => r.amount)).toEqual(['3.00', '7.00']);
    expect(previewInstallments(10, [{ label: 'Sinal', amount: '30' }, { label: 'Saldo' }], '2026-11-10').invalid).toBe(true);
  });

  it('embalagens padrão: linhas DELIVERY × quantidade + 1 por pedido na primeira entrega', () => {
    const bom: BomDeliveryLine[] = [{ id: 1, bom_version_id: 7, item_id: 4, item_name: 'Saquinho', qty_per_unit: 1, waste_pct: 0, avg_cost_total: 0.2 }];
    expect([...defaultPackaging([{ bomId: 7, qty: 2 }], bom, 4, true)]).toEqual([[4, '3']]);
    expect([...defaultPackaging([{ bomId: 7, qty: 2 }], bom, 4, false)]).toEqual([[4, '2']]);
    expect([...defaultPackaging([{ bomId: null, qty: 2 }], bom, null, true)]).toEqual([]);
  });

  it('taxa e preço vigentes na data', () => {
    const fees = [fee({ id: 1, payment_fee_pct: 0.01, valid_from: '2026-01-01', valid_to: '2026-06-30' }), fee({ id: 2, payment_fee_pct: 0.02, valid_from: '2026-07-01' })];
    expect(currentFee(fees, 1, '2026-03-01')?.id).toBe(1);
    expect(currentFee(fees, 1, '2026-10-22')?.id).toBe(2);
    expect(currentFee(fees, 2, '2026-10-22')).toBeNull();
    const prices = [{ id: 1, variant_id: 9, channel_id: 3, price: 6, valid_from: '2026-01-01', valid_to: null }];
    expect(priceFor({ id: 9, reference_price: 5 }, prices, 3, '2026-10-22')).toBe(6);
    expect(priceFor({ id: 9, reference_price: 5 }, prices, 1, '2026-10-22')).toBe(5);
    expect(priceFor({ id: 8, reference_price: null }, prices, 1, '2026-10-22')).toBeNull();
  });

  it('texto do pedido para o WhatsApp', () => {
    const text = orderSummaryText({
      number: 'PED-2026-0003',
      company: 'Wabee',
      customerName: 'Escola Demo',
      dueDate: '2026-10-28',
      lines: [{ description: 'Chaveiro Coração — preto', qty: 10, total: 35 }],
      subtotal: 35,
      discountTotal: 0,
      shippingCharged: 0,
      total: 35,
      installments: [{ label: 'Sinal', amount: 17.5, dueDate: '2026-10-22', paid: true }],
    });
    expect(text).toContain('*Pedido PED-2026-0003* — Wabee');
    expect(text).toContain('• 10× Chaveiro Coração — preto — R$');
    expect(text).toContain('*Total: R$');
    expect(text).toContain('22/10/2026');
    expect(text).toContain('Entrega prevista: 28/10/2026');
  });
});
