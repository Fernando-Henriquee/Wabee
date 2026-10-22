import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocateMoney, monthlyInstallments, previewPurchaseLines, splitAmount, suggestedPrice, suggestFirstDueDate, unitContributionMargin } from './calc';

describe('splitAmount (RN-25, US-0.8)', () => {
  it('reproduz as parcelas reais da Wabee', () => {
    const a = splitAmount('5646.19', 18);
    expect(a.slice(0, 17).every((v) => v === '313.68')).toBe(true);
    expect(a[17]).toBe('313.63');
    const b = splitAmount('2863.11', 12);
    expect(b.slice(0, 11).every((v) => v === '238.59')).toBe(true);
    expect(b[11]).toBe('238.62');
  });

  it('soma sempre o total (propriedade)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50_000_000 }), fc.integer({ min: 1, max: 48 }), (cents, parts) => {
        const total = (cents / 100).toFixed(2);
        const sum = splitAmount(total, parts).reduce((acc, v) => acc + Math.round(Number(v) * 100), 0);
        expect(sum).toBe(cents);
      }),
    );
  });
});

describe('rateio e custo de aquisição (RN-02)', () => {
  it('centavos restantes na linha de maior valor', () => {
    expect(allocateMoney('10', [1, 1, 1])).toEqual(['3.34', '3.33', '3.33']);
    expect(allocateMoney('10', [1, 2, 1])).toEqual(['2.50', '5.00', '2.50']);
  });

  it('frete rateado entra no custo unitário', () => {
    const lines = previewPurchaseLines(
      [
        { qty: 1000, unitPrice: '0.1' },
        { qty: 100, unitPrice: '1' },
        { qty: 1, unitPrice: '100' },
      ],
      '10',
      '0',
    );
    expect(lines.map((l) => l.freightAlloc)).toEqual(['3.34', '3.33', '3.33']);
    expect(lines[0]!.landedUnitCost).toBe('0.10334');
    expect(lines[1]!.landedUnitCost).toBe('1.0333');
  });
});

describe('vencimento do cartão e parcelas mensais', () => {
  it('compras a partir do fechamento vão para a fatura seguinte (mesmos casos do banco)', () => {
    expect(suggestFirstDueDate('2026-10-03', 5, 15)).toBe('2026-10-15');
    expect(suggestFirstDueDate('2026-10-05', 5, 15)).toBe('2026-11-15');
    expect(suggestFirstDueDate('2026-10-10', 25, 5)).toBe('2026-11-05');
    expect(suggestFirstDueDate('2026-10-26', 25, 5)).toBe('2026-12-05');
  });

  it('parcelas mensais ajustam meses curtos', () => {
    const p = monthlyInstallments('300', 3, '2026-01-31');
    expect(p.map((x) => x.due_date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
});

describe('preço sugerido (RN-17) e margem (RN-13)', () => {
  it('mesmo valor do teste de banco', () => {
    expect(suggestedPrice({ unitCost: '1.425', packaging: '0.25', marginPct: '0.30' })).toBe('2.39');
    expect(suggestedPrice({ unitCost: 1, feePct: 0.6, paymentFeePct: 0.1, marginPct: 0.3 })).toBeNull();
    expect(unitContributionMargin({ price: 5, unitCost: '1.425', packaging: '0.25' })).toBe('3.33');
  });
});
