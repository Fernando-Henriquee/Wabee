import Big from 'big.js';
import { centsToDecimal, toCents, type Numeric } from './money';

/**
 * Espelhos das regras do banco para as PRÉVIAS nas telas (o banco recalcula e grava).
 * Mesmas regras e arredondamentos das funções SQL; os testes usam os exemplos da
 * especificação nos dois lados.
 */

Big.RM = Big.roundHalfUp;

/** RN-25: round(total ÷ n, 2) nas primeiras n − 1 parcelas; a última recebe o restante. */
export function splitAmount(total: Numeric, parts: number): string[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('Número de parcelas inválido');
  const totalCents = toCents(total);
  const each = Number(new Big(totalCents).div(parts).round(0, Big.roundHalfUp));
  const result: string[] = [];
  for (let i = 0; i < parts - 1; i += 1) result.push(centsToDecimal(each));
  result.push(centsToDecimal(totalCents - each * (parts - 1)));
  return result;
}

/** RN-02: rateio proporcional; a diferença de centavos vai para a linha de maior peso (a primeira, no empate). */
export function allocateMoney(total: Numeric, weights: Numeric[]): string[] {
  const totalCents = toCents(total);
  const w = weights.map((x) => new Big(x === null || x === undefined || x === '' ? 0 : x));
  const sum = w.reduce((acc, x) => acc.plus(x), new Big(0));
  if (w.length === 0) return [];
  if (sum.eq(0)) return w.map(() => '0.00');
  let maxIndex = 0;
  w.forEach((x, i) => {
    if (x.gt(w[maxIndex]!)) maxIndex = i;
  });
  const parts = w.map((x) => Number(new Big(totalCents).times(x).div(sum).round(0, Big.roundHalfUp)));
  const diff = totalCents - parts.reduce((a, b) => a + b, 0);
  parts[maxIndex] = parts[maxIndex]! + diff;
  return parts.map(centsToDecimal);
}

export interface PurchaseLineInput {
  qty: Numeric;
  unitPrice: Numeric;
}

export interface PurchaseLinePreview {
  lineTotal: string;
  freightAlloc: string;
  discountAlloc: string;
  landedTotal: string;
  landedUnitCost: string;
}

/** Custo de aquisição por linha (RN-02): (p × q + frete rateado − desconto rateado) ÷ q, 6 casas. */
export function previewPurchaseLines(lines: PurchaseLineInput[], freight: Numeric, discount: Numeric): PurchaseLinePreview[] {
  const totals = lines.map((l) => centsToDecimal(Number(new Big(l.qty || 0).times(l.unitPrice || 0).times(100).round(0, Big.roundHalfUp))));
  const freightParts = allocateMoney(freight || 0, totals);
  const discountParts = allocateMoney(discount || 0, totals);
  return lines.map((l, i) => {
    const landed = new Big(totals[i]!).plus(freightParts[i] ?? 0).minus(discountParts[i] ?? 0);
    const qty = new Big(l.qty || 0);
    return {
      lineTotal: totals[i]!,
      freightAlloc: freightParts[i] ?? '0.00',
      discountAlloc: discountParts[i] ?? '0.00',
      landedTotal: landed.toFixed(2),
      landedUnitCost: qty.gt(0) ? landed.div(qty).round(6, Big.roundHalfUp).toString() : '0',
    };
  });
}

/** 1º vencimento pelo cartão: compras a partir do dia de fechamento vão para a fatura seguinte. */
export function suggestFirstDueDate(purchasedAt: string, closingDay: number | null, dueDay: number | null): string {
  const [y, m, d] = purchasedAt.split('-').map(Number) as [number, number, number];
  if (!dueDay) {
    const date = new Date(Date.UTC(y, m, Math.min(d, daysInMonth(y, m))));
    return date.toISOString().slice(0, 10);
  }
  let closeMonth = m - 1; // 0-based
  let closeYear = y;
  if (d >= (closingDay ?? 1)) {
    closeMonth += 1;
    if (closeMonth > 11) {
      closeMonth = 0;
      closeYear += 1;
    }
  }
  let dueMonth = closeMonth;
  let dueYear = closeYear;
  if (dueDay <= (closingDay ?? 0)) {
    dueMonth += 1;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear += 1;
    }
  }
  const day = Math.min(dueDay, daysInMonth(dueYear, dueMonth));
  return new Date(Date.UTC(dueYear, dueMonth, day)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Parcelas mensais a partir do 1º vencimento (mesmo dia, ajustado em meses curtos). */
export function monthlyInstallments(total: Numeric, count: number, firstDue: string): Array<{ due_date: string; amount: string }> {
  const amounts = splitAmount(total, count);
  const [y, m, d] = firstDue.split('-').map(Number) as [number, number, number];
  return amounts.map((amount, i) => {
    const month0 = m - 1 + i;
    const year = y + Math.floor(month0 / 12);
    const mm = ((month0 % 12) + 12) % 12;
    const day = Math.min(d, daysInMonth(year, mm));
    return { due_date: new Date(Date.UTC(year, mm, day)).toISOString().slice(0, 10), amount };
  });
}

/**
 * Preço sugerido (RN-17): (custo + embalagem + taxa fixa) ÷ (1 − taxa canal − taxa pagamento − imposto − margem).
 * null quando a margem alvo é impossível com essas taxas.
 */
export function suggestedPrice(input: {
  unitCost: Numeric;
  packaging?: Numeric;
  feeFixed?: Numeric;
  feePct?: Numeric;
  paymentFeePct?: Numeric;
  taxPct?: Numeric;
  marginPct: Numeric;
}): string | null {
  const den = new Big(1)
    .minus(input.feePct || 0)
    .minus(input.paymentFeePct || 0)
    .minus(input.taxPct || 0)
    .minus(input.marginPct || 0);
  if (den.lte(0)) return null;
  return new Big(input.unitCost || 0)
    .plus(input.packaging || 0)
    .plus(input.feeFixed || 0)
    .div(den)
    .round(2, Big.roundHalfUp)
    .toFixed(2);
}

/** Margem de contribuição unitária (RN-13) para prévias: preço − custo − taxas − embalagem − imposto. */
export function unitContributionMargin(input: {
  price: Numeric;
  unitCost: Numeric;
  packaging?: Numeric;
  feeFixed?: Numeric;
  feePct?: Numeric;
  paymentFeePct?: Numeric;
  taxPct?: Numeric;
}): string {
  const price = new Big(input.price || 0);
  const fees = price.times(new Big(input.feePct || 0).plus(input.paymentFeePct || 0)).plus(input.feeFixed || 0);
  return price
    .minus(input.unitCost || 0)
    .minus(fees)
    .minus(input.packaging || 0)
    .minus(price.times(input.taxPct || 0))
    .round(2, Big.roundHalfUp)
    .toFixed(2);
}

/** Soma decimal exata de valores monetários (texto). */
export function sumMoney(values: Numeric[]): string {
  return values.reduce<Big>((acc, v) => acc.plus(v === null || v === undefined || v === '' ? 0 : v), new Big(0)).toFixed(2);
}
