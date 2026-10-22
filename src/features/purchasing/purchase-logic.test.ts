import { describe, expect, it } from 'vitest';
import type { PurchaseLineRow } from '@/data/purchasing';
import { buildInstallments, editedFromCustom, fitLinesToTotal, lineFromRow, lineQty, lineUnitPrice, newLine, scheduleDates, unitPriceForTotal } from './purchase-logic';

describe('linhas da compra', () => {
  it('filamento em carretéis vira gramas e preço por carretel vira preço por grama', () => {
    const line = { ...newLine('a'), qtyMode: 'spools' as const, spoolCount: '3', spoolSize: '1000', price: '89.9' };
    expect(lineQty(line, true)).toBe('3000');
    expect(lineUnitPrice(line, true)).toBe('0.0899');
  });

  it('filamento em gramas usa preço por kg', () => {
    const line = { ...newLine('a'), qty: '2500', price: '96.63' };
    expect(lineQty(line, true)).toBe('2500');
    expect(lineUnitPrice(line, true)).toBe('0.09663');
  });

  it('preço total da linha reproduz o total com 6 casas', () => {
    expect(unitPriceForTotal('289.90', '3000')).toBe('0.096633');
    const unit = unitPriceForTotal('100', '3');
    expect(Math.round(3 * Number(unit) * 100) / 100).toBe(100);
  });

  it('restaura do rascunho em carretéis quando fecha inteiro', () => {
    const row = { id: 9, line_kind: 'ITEM', item_id: 1, item_kind: 'FILAMENT', expense_category_id: null, description: 'PLA', qty: 3000, unit_price: 0.0899, line_total: 269.7 } as PurchaseLineRow;
    const line = lineFromRow(row, 1000);
    expect(line).toMatchObject({ qtyMode: 'spools', spoolCount: '3', priceMode: 'unit', price: '89.9' });
    const odd = lineFromRow({ ...row, qty: 2500, unit_price: 0.096633, line_total: 241.58 }, 1000);
    expect(odd).toMatchObject({ qtyMode: 'units', qty: '2500', priceMode: 'total', price: '241.58' });
  });
});

describe('parcelas da compra (US-3.3)', () => {
  it('cronograma mensal a partir do 1º vencimento, ajustado no fim do mês', () => {
    expect(scheduleDates('CREDITO_PARCELADO', '2026-10-10', '2027-01-31', 3)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(scheduleDates('PIX', '2026-10-10', '2026-11-10', 5)).toEqual(['2026-10-10']);
    expect(scheduleDates('CREDITO_VISTA', '2026-10-10', '2026-11-15', 5)).toEqual(['2026-11-15']);
  });

  it('caso real: R$ 5.646,19 em 18x sem edição', () => {
    const dates = scheduleDates('CREDITO_PARCELADO', '2026-06-10', '2026-07-15', 18);
    const result = buildInstallments(dates, '5646.19', {});
    expect(result.error).toBeNull();
    expect(result.custom).toBe(false);
    expect(result.rows[0]!.amount).toBe('313.68');
    expect(result.rows[17]!.amount).toBe('313.63');
  });

  it('editar uma parcela recalcula a última para fechar a soma', () => {
    const dates = scheduleDates('BOLETO', '2026-10-10', '2026-11-10', 3);
    const result = buildInstallments(dates, '300', { 0: '120' });
    expect(result.rows.map((r) => r.amount)).toEqual(['120.00', '100.00', '80.00']);
    expect(result.rows[2]!.adjusted).toBe(true);
    expect(result.error).toBeNull();
    expect(result.custom).toBe(true);
  });

  it('bloqueia quando a última editada não fecha ou fica negativa', () => {
    const dates = scheduleDates('BOLETO', '2026-10-10', '2026-11-10', 2);
    expect(buildInstallments(dates, '200', { 1: '40' }).error).toMatch(/não bate com o total/);
    expect(buildInstallments(dates, '200', { 0: '250' }).error).toMatch(/passam do total/);
  });

  it('restaura as parcelas editadas do rascunho', () => {
    const custom = [{ amount: 120 }, { amount: 100 }, { amount: 80 }];
    expect(editedFromCustom(custom, 300)).toEqual({ 0: '120.00' });
  });

  it('ajusta as linhas ao total parcelado proporcionalmente', () => {
    const lines = [
      { ...newLine('a', 'EQUIPMENT'), price: '4000' },
      { ...newLine('b'), qty: '10000', price: '100' },
    ];
    const fitted = fitLinesToTotal(lines, ['4000.00', '1000.00'], '646.19');
    expect(fitted.map((l) => l.price)).toEqual(['4516.95', '1129.24']);
    expect(fitted.every((l) => l.priceMode === 'total')).toBe(true);
  });
});
