import type { PfAmortization } from '@/data/personal';

/**
 * Prévia das parcelas de um financiamento (o banco calcula de novo ao salvar, com a mesma regra).
 * PRICE: parcelas iguais; SAC: amortização igual e parcelas decrescentes; FIXA: valor informado.
 * A última parcela absorve o arredondamento e zera o saldo devedor.
 */
export interface Installment {
  number: number;
  payment: number;
  interest: number | null;
  /** Saldo devedor depois de pagar esta parcela (só Price e SAC). */
  balance: number | null;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function amortize(system: PfAmortization, principal: number, rateMonth: number, count: number, fixed = 0): Installment[] {
  if (!(principal > 0) || !Number.isInteger(count) || count < 1) return [];
  const rate = Math.max(rateMonth, 0);
  const pmt = system === 'PRICE' ? (rate === 0 ? principal / count : (principal * rate) / (1 - (1 + rate) ** -count)) : 0;
  const result: Installment[] = [];
  let balance = principal;
  for (let number = 1; number <= count; number++) {
    if (system === 'FIXA') {
      result.push({ number, payment: cents(fixed), interest: null, balance: null });
      continue;
    }
    const interest = cents(balance * rate);
    let payment: number;
    if (system === 'PRICE') payment = number === count ? cents(balance + interest) : cents(pmt);
    else payment = cents((number === count ? balance : cents(principal / count)) + interest);
    balance = cents(balance - (payment - interest));
    result.push({ number, payment, interest, balance: Math.max(balance, 0) });
  }
  return result;
}

export function totals(rows: Installment[]) {
  const paid = rows.reduce((sum, r) => sum + r.payment, 0);
  const interest = rows.every((r) => r.interest === null) ? null : rows.reduce((sum, r) => sum + (r.interest ?? 0), 0);
  return { paid: cents(paid), interest: interest === null ? null : cents(interest) };
}
