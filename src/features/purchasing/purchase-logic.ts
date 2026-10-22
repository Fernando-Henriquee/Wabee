import Big from 'big.js';
import type { OwnerFundingType, PaymentAccount } from '@/data/finance';
import type { LineKind, PaymentMethod, PurchaseLineRow } from '@/data/purchasing';
import { allocateMoney, splitAmount, sumMoney } from '@/lib/calc';
import { addMonths } from '@/lib/dates';
import { formatBRL, type Numeric } from '@/lib/money';

/**
 * Regras da tela de compra (prévia): quantidades em carretéis, preço por kg/carretel/total,
 * cronograma e edição das parcelas. O banco recalcula tudo ao salvar e confirmar.
 */

export const CASH_METHODS: PaymentMethod[] = ['PIX', 'DINHEIRO', 'DEBITO'];
export const SPOOL_SIZES = [250, 500, 750, 1000, 2000, 3000, 5000];

export function isCashMethod(method: PaymentMethod): boolean {
  return CASH_METHODS.includes(method);
}

export function isCardMethod(method: PaymentMethod): boolean {
  return method === 'CREDITO_VISTA' || method === 'CREDITO_PARCELADO';
}

/** Crédito parcelado e boleto: N parcelas e total parcelado (com juros). */
export function hasInstallments(method: PaymentMethod): boolean {
  return method === 'CREDITO_PARCELADO' || method === 'BOLETO';
}

export const FUNDING_HINTS: Record<OwnerFundingType, string> = {
  CAPITAL_CONTRIBUTION: 'O dono investe na empresa: aumenta o capital e não precisa ser devolvido.',
  OWNER_LOAN: 'A empresa fica devendo ao dono e devolve depois.',
  OWNER_PAID_EXPENSE: 'O dono adiantou o pagamento e a empresa reembolsa.',
};

/** Contas que servem para a forma de pagamento: cartões no crédito; contas e dinheiro no resto. */
export function accountsFor(method: PaymentMethod, accounts: PaymentAccount[]): PaymentAccount[] {
  return accounts.filter((a) => (isCardMethod(method) ? a.kind === 'CARTAO_CREDITO' : a.kind !== 'CARTAO_CREDITO'));
}

export function spoolLabel(grams: Numeric): string {
  const g = Number(grams);
  return g >= 1000 && g % 1000 === 0 ? `${g / 1000} kg` : `${g} g`;
}

/** Linha do formulário de compra (valores em texto decimal canônico). */
export interface LineDraft {
  key: string;
  kind: LineKind;
  itemId: number | null;
  categoryId: number | null;
  description: string;
  /** Filamento: "spools" = carretéis × tamanho; "units" = gramas (preço por kg). */
  qtyMode: 'units' | 'spools';
  qty: string | null;
  spoolCount: string | null;
  spoolSize: string;
  /** "unit": preço por unidade (por kg ou por carretel no filamento); "total": valor total da linha. */
  priceMode: 'unit' | 'total';
  price: string | null;
}

export function newLine(key: string, kind: LineKind = 'ITEM'): LineDraft {
  return { key, kind, itemId: null, categoryId: null, description: '', qtyMode: 'units', qty: kind === 'ITEM' ? null : '1', spoolCount: '1', spoolSize: '1000', priceMode: 'unit', price: null };
}

function big(value: Numeric): Big | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    return new Big(value);
  } catch {
    return null;
  }
}

/** Fator entre o preço digitado e o preço por unidade do banco (g ou un). */
export function priceFactor(line: LineDraft, filament: boolean): number {
  if (!filament || line.kind !== 'ITEM') return 1;
  return line.qtyMode === 'spools' ? Number(line.spoolSize) || 1000 : 1000;
}

/** Quantidade na unidade do item (gramas no filamento). */
export function lineQty(line: LineDraft, filament: boolean): string | null {
  if (filament && line.kind === 'ITEM' && line.qtyMode === 'spools') {
    const count = big(line.spoolCount);
    const size = big(line.spoolSize);
    return count && size ? count.times(size).toFixed() : null;
  }
  return line.qty;
}

/**
 * Preço unitário (6 casas) que reproduz o total digitado: round(qtd × preço, 2) = total.
 * Com quantidades muito grandes nem sempre existe; fica o mais próximo.
 */
export function unitPriceForTotal(total: Numeric, qty: Numeric): string | null {
  const q = big(qty);
  const t = big(total);
  if (!q || !t || q.lte(0)) return null;
  const target = t.round(2, Big.roundHalfUp);
  const base = target.div(q).round(6, Big.roundHalfUp);
  for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
    const unit = base.plus(new Big(delta).times('0.000001'));
    if (unit.lt(0)) continue;
    if (q.times(unit).round(2, Big.roundHalfUp).eq(target)) return unit.toFixed();
  }
  return base.toFixed();
}

export function lineUnitPrice(line: LineDraft, filament: boolean): string | null {
  const price = big(line.price);
  if (!price) return null;
  if (line.priceMode === 'total') return unitPriceForTotal(line.price, lineQty(line, filament));
  return price.div(priceFactor(line, filament)).round(6, Big.roundHalfUp).toFixed();
}

/** Restaura a linha salva no rascunho (carretéis quando a quantidade fecha em carretéis inteiros). */
export function lineFromRow(row: PurchaseLineRow, nominal: number | null): LineDraft {
  const line = newLine(`l${row.id}`, row.line_kind);
  const filament = row.item_kind === 'FILAMENT';
  line.itemId = row.item_id;
  line.categoryId = row.expense_category_id;
  line.description = row.line_kind === 'ITEM' ? '' : row.description;
  const qty = new Big(row.qty);
  const size = nominal && nominal > 0 ? nominal : 1000;
  if (filament && qty.mod(size).eq(0)) {
    line.qtyMode = 'spools';
    line.spoolCount = qty.div(size).toFixed();
    line.spoolSize = String(size);
  } else {
    line.qtyMode = 'units';
    line.qty = qty.toFixed();
    line.spoolSize = String(size);
  }
  const factor = priceFactor(line, filament);
  const unit = new Big(row.unit_price).times(factor);
  // Preço por kg/carretel, equipamento e despesa em centavos; preço unitário de item aceita até 4 casas.
  if (unit.round(factor > 1 || row.line_kind !== 'ITEM' ? 2 : 4, Big.roundHalfUp).eq(unit)) {
    line.priceMode = 'unit';
    line.price = unit.toFixed();
  } else {
    line.priceMode = 'total';
    line.price = new Big(row.line_total).toFixed(2);
  }
  return line;
}

/** Vencimentos (mesma regra do banco): à vista na data da compra; parcelado mês a mês a partir do 1º. */
export function scheduleDates(method: PaymentMethod, purchasedAt: string, firstDue: string, count: number): string[] {
  if (isCashMethod(method)) return [purchasedAt];
  if (method === 'CREDITO_VISTA') return [firstDue];
  const n = Math.min(Math.max(Math.trunc(count) || 1, 1), 48);
  return Array.from({ length: n }, (_, i) => addMonths(firstDue, i));
}

export interface InstallmentPreview {
  due_date: string;
  amount: string;
  edited: boolean;
  /** Recalculada para fechar a soma (última parcela). */
  adjusted: boolean;
}

/**
 * Parcelas da prévia (RN-25): divisão padrão; valores editados substituem os calculados e a
 * última parcela absorve a diferença. Se a própria última foi editada, a soma pode não fechar.
 */
export function buildInstallments(dates: string[], total: Numeric, edited: Record<number, string>) {
  const n = dates.length;
  const totalText = new Big(big(total) ?? 0).round(2, Big.roundHalfUp).toFixed(2);
  const base = splitAmount(totalText, Math.max(n, 1));
  const editedIdx = new Set(
    Object.keys(edited)
      .map(Number)
      .filter((i) => i < n && n > 1 && big(edited[i]) !== null),
  );
  const amounts = base.map((a, i) => (editedIdx.has(i) ? new Big(edited[i]!).toFixed(2) : a));
  const adjustLast = n > 1 && editedIdx.size > 0 && !editedIdx.has(n - 1);
  if (adjustLast) amounts[n - 1] = new Big(totalText).minus(sumMoney(amounts.slice(0, n - 1))).toFixed(2);
  const sum = sumMoney(amounts);
  let error: string | null = null;
  if (amounts.some((a) => new Big(a).lt(0))) error = 'As parcelas editadas passam do total: ajuste os valores.';
  else if (!new Big(sum).eq(totalText)) error = `A soma das parcelas (${formatBRL(sum)}) não bate com o total (${formatBRL(totalText)}).`;
  const rows: InstallmentPreview[] = dates.map((due_date, i) => ({ due_date, amount: amounts[i]!, edited: editedIdx.has(i), adjusted: adjustLast && i === n - 1 }));
  return { rows, sum, error, custom: editedIdx.size > 0 };
}

/** Parcelas editadas salvas no rascunho → índices editados (a última é recalculada). */
export function editedFromCustom(custom: Array<{ amount: Numeric }> | null | undefined, total: Numeric): Record<number, string> {
  if (!custom || custom.length < 2) return {};
  const base = splitAmount(new Big(big(total) ?? 0).toFixed(2), custom.length);
  const edited: Record<number, string> = {};
  custom.forEach((c, i) => {
    if (i < custom.length - 1 && !new Big(c.amount ?? 0).eq(base[i]!)) edited[i] = new Big(c.amount ?? 0).toFixed(2);
  });
  return edited;
}

/**
 * "Não sei o valor à vista": distribui a diferença entre o total parcelado e a soma atual
 * proporcionalmente ao valor de cada linha (vira preço total da linha).
 */
export function fitLinesToTotal(lines: LineDraft[], lineTotals: string[], diff: Numeric): LineDraft[] {
  const parts = allocateMoney(diff, lineTotals);
  return lines.map((line, i): LineDraft => {
    const next = new Big(lineTotals[i] ?? 0).plus(parts[i] ?? 0);
    return next.gt(0) ? { ...line, priceMode: 'total', price: next.toFixed(2) } : line;
  });
}
