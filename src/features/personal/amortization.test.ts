import { describe, expect, it } from 'vitest';
import { amortize, totals } from './amortization';

describe('amortize', () => {
  it('Price: parcela fixa, juros decrescentes e saldo zerado na última (mesmos números do banco)', () => {
    const rows = amortize('PRICE', 10000, 0.01, 12);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ payment: 888.49, interest: 100 });
    expect(rows[1]!.interest!).toBeLessThan(rows[0]!.interest!);
    expect(rows[11]!.balance).toBe(0);
    expect(totals(rows).interest).toBeCloseTo(rows.reduce((s, r) => s + r.payment, 0) - 10000, 1);
  });

  it('SAC: amortização fixa e parcelas decrescentes', () => {
    const rows = amortize('SAC', 12000, 0.01, 12);
    expect(rows[0]!.payment).toBe(1120);
    expect(rows[11]!.payment).toBeCloseTo(1010, 2);
    expect(rows[11]!.balance).toBe(0);
  });

  it('sem juros divide igualmente', () => {
    const rows = amortize('PRICE', 1000, 0, 4);
    expect(rows.map((r) => r.payment)).toEqual([250, 250, 250, 250]);
  });

  it('valor informado repete a parcela e não calcula juros', () => {
    const rows = amortize('FIXA', 1000, 0, 10, 110);
    expect(rows.every((r) => r.payment === 110 && r.interest === null)).toBe(true);
    expect(totals(rows)).toEqual({ paid: 1100, interest: null });
  });

  it('entradas inválidas não geram parcelas', () => {
    expect(amortize('PRICE', 0, 0.01, 12)).toEqual([]);
    expect(amortize('PRICE', 1000, 0.01, 0)).toEqual([]);
  });
});
