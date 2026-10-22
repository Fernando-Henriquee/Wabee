/**
 * Valores em reais (seção 1.4): dinheiro com 2 casas na tela, custos unitários com
 * até 6 casas, quantidades com até 3. O banco calcula e grava tudo em numeric; aqui
 * só formatamos e interpretamos o que a pessoa digita. Para enviar ao banco usamos
 * texto decimal canônico ("1234.56"), nunca o resultado de contas em ponto flutuante.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export type Numeric = number | string | null | undefined;

export function toNumber(value: Numeric): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function isBlank(value: Numeric): boolean {
  return value === null || value === undefined || value === '';
}

/** "R$ 1.234,56"; nulo vira "—". */
export function formatBRL(value: Numeric): string {
  if (isBlank(value)) return '—';
  return brl.format(toNumber(value));
}

/** Custo unitário com até 6 casas: "R$ 1,388889" (mínimo 2). */
export function formatCost(value: Numeric, maxDecimals = 6): string {
  if (isBlank(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: maxDecimals }).format(
    toNumber(value),
  );
}

/** "1.234,56" sem símbolo (campos editáveis, CSV). */
export function formatDecimal(value: Numeric, decimals = 2): string {
  if (isBlank(value)) return '';
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(toNumber(value));
}

/** Número com até N casas, sem zeros à direita: 1234.5 → "1.234,5". */
export function formatNumber(value: Numeric, maxDecimals = 3): string {
  if (isBlank(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: maxDecimals }).format(toNumber(value));
}

const UNIT_LABEL: Record<string, string> = { G: 'g', UN: 'un', ML: 'ml', M: 'm' };

export function unitLabel(unit: string | null | undefined): string {
  return UNIT_LABEL[unit ?? ''] ?? (unit ?? '').toLowerCase();
}

/** Quantidade com unidade: "1.234,5 g", "3 un". Gramas acima de 1 kg ficam em gramas (o banco usa gramas). */
export function formatQty(value: Numeric, unit?: string | null): string {
  if (isBlank(value)) return '—';
  const label = unitLabel(unit);
  return `${formatNumber(value, 3)}${label ? ` ${label}` : ''}`;
}

/** Percentual a partir de fração: 0.668 → "66,8%". */
export function formatPercent(fraction: Numeric, decimals = 1): string {
  if (isBlank(fraction)) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: decimals }).format(toNumber(fraction) * 100)}%`;
}

/** Minutos (banco) em h:min (tela): 90 → "1h30", 45 → "45 min". */
export function formatMinutes(minutes: Numeric): string {
  if (isBlank(minutes)) return '—';
  const total = Math.round(toNumber(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Interpreta números digitados no formato brasileiro ("1.234,56", "12,5", "R$ 3")
 * ou com ponto decimal ("12.50"). Devolve texto decimal canônico ("1234.56") ou null.
 */
export function parseDecimal(input: string | number | null | undefined, maxDecimals = 6): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? String(input) : null;
  let text = input.replace(/R\$/gi, '').replace(/\s|\u00a0/g, '').trim();
  if (text === '') return null;
  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  let intPart: string;
  let fracPart = '';
  if (text.includes(',')) {
    const [int, frac, ...rest] = text.split(',');
    if (rest.length > 0 || int === undefined) return null;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$|^$/.test(int)) return null;
    intPart = int.replace(/\./g, '') || '0';
    fracPart = frac ?? '';
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    intPart = text.replace(/\./g, '');
  } else if (/^\d+\.\d+$/.test(text)) {
    [intPart = '0', fracPart = ''] = text.split('.');
  } else if (/^\d+$/.test(text)) {
    intPart = text;
  } else {
    return null;
  }
  if (!/^\d*$/.test(fracPart) || fracPart.length > maxDecimals) return null;
  const normalized = `${intPart.replace(/^0+(?=\d)/, '')}${fracPart ? `.${fracPart}` : ''}`;
  return negative && Number(normalized) !== 0 ? `-${normalized}` : normalized;
}

/** Valor monetário digitado → centavos inteiros (para contas exatas de prévia). */
export function toCents(value: Numeric): number {
  // Texto canônico (vindo do banco ou de parseDecimal) é lido direto; o resto passa pelo parser pt-BR.
  const text =
    typeof value === 'string'
      ? /^-?\d+(\.\d+)?$/.test(value.trim())
        ? value.trim()
        : (parseDecimal(value, 6) ?? '0')
      : String(toNumber(value));
  const negative = text.startsWith('-');
  const [int = '0', frac = ''] = text.replace('-', '').split('.');
  const third = Number(frac.charAt(2) || '0');
  let cents = Number(int) * 100 + Number(frac.slice(0, 2).padEnd(2, '0'));
  if (third >= 5) cents += 1; // meio para cima, como o ROUND_HALF_UP do banco
  return negative ? -cents : cents;
}

export function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
