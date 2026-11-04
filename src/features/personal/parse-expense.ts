import { addDays } from '@/lib/dates';

/**
 * Interpretador de gastos falados ou digitados em português ("gastei 45 reais no mercado e 20 de
 * uber ontem"). Roda no aparelho, sem enviar nada a ninguém. O resultado é sempre um rascunho
 * que a pessoa confere antes de salvar; o que ficou duvidoso vem marcado em `uncertain`.
 */

export interface ParseCategory {
  id: number;
  name: string;
  kind: 'GASTO' | 'ENTRADA';
  keywords: string[];
}

export interface ParseAccount {
  id: number;
  name: string;
  kind: 'CONTA' | 'CARTEIRA' | 'POUPANCA' | 'INVESTIMENTO' | 'CARTAO';
}

export interface ParseContext {
  /** Hoje (AAAA-MM-DD) no fuso da empresa. */
  today: string;
  categories: ParseCategory[];
  accounts: ParseAccount[];
  /** Palavras que o dono já corrigiu antes (têm prioridade sobre as palavras-chave). */
  learned?: Array<{ word: string; category_id: number }>;
}

export type Uncertain = 'amount' | 'category' | 'date';

export interface ParsedEntry {
  kind: 'GASTO' | 'ENTRADA';
  amount: number | null;
  date: string;
  description: string;
  categoryId: number | null;
  accountId: number | null;
  /** "em 3x de 100": vira um parcelado (a parcela é o valor do lançamento). */
  installments: { count: number; amount: number | null } | null;
  uncertain: Uncertain[];
  /** Trecho do texto de onde saiu este lançamento. */
  source: string;
}

// -----------------------------------------------------------------------------
// Texto e números por extenso
// -----------------------------------------------------------------------------

/** Minúsculas, sem acentos, e separa números, palavras e símbolos em tokens. */
export function tokenize(text: string): string[] {
  const clean = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(segunda|terca|quarta|quinta|sexta)[\s-]*feira/g, '$1')
    .replace(/r\s*\$/g, ' r$ ')
    .replace(/(\d)\s*x\b/g, '$1 x ');
  return clean.match(/\d[\d.,]*\d|\d|r\$|[a-z]+|[^\s\da-z]/g) ?? [];
}

const ONES: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
};
const TENS: Record<string, number> = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

const CURRENCY = new Set(['real', 'reais', 'pila', 'pilas', 'conto', 'contos', 'pratas', 'prata', 'paus']);

/** Valor e "etapa" (centenas 3, dezenas 2, unidades 1) de uma palavra numérica; "mil" é tratado à parte. */
function wordNumber(word: string): { value: number; stage: number } | null {
  if (word in HUNDREDS) return { value: HUNDREDS[word]!, stage: 3 };
  if (word in TENS) return { value: TENS[word]!, stage: 2 };
  if (word in ONES) {
    const value = ONES[word]!;
    return { value, stage: value >= 10 ? 2 : 1 };
  }
  return null;
}

/**
 * Troca números por extenso por dígitos ("quarenta e cinco" → "45", "mil e duzentos" → "1200").
 * "um" e "uma" só viram número antes de "real"/"mil" ou dentro de um número maior (são artigos).
 */
export function digitize(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const first = tokens[i]!;
    const startsNumber = wordNumber(first) !== null || first === 'mil';
    const isArticle = first === 'um' || first === 'uma';
    if (!startsNumber || (isArticle && !(CURRENCY.has(tokens[i + 1] ?? '') || tokens[i + 1] === 'mil'))) {
      out.push(first);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let stage = 4;
    let j = i;
    let consumed = false;
    while (j < tokens.length) {
      let word = tokens[j]!;
      let skip = 0;
      if (word === 'e' && j > i && (wordNumber(tokens[j + 1] ?? '') !== null || tokens[j + 1] === 'mil')) {
        word = tokens[j + 1]!;
        skip = 1;
      }
      if (word === 'mil') {
        total += (current || 1) * 1000;
        current = 0;
        stage = 4;
      } else {
        const n = wordNumber(word);
        if (!n || n.stage >= stage) break;
        // Quem segue unidades com dezenas ("quarenta e cinco e noventa") começou outro número.
        current += n.value;
        stage = n.stage;
      }
      consumed = true;
      j += 1 + skip;
    }
    if (!consumed) {
      out.push(first);
      i++;
      continue;
    }
    out.push(String(total + current));
    i = j;
  }
  return out;
}

/** "1.200,50" → 1200.5; "45.90" → 45.9; "1.200" → 1200. */
export function parseBrNumber(raw: string): number | null {
  let text = raw;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// -----------------------------------------------------------------------------
// Valores, parcelas, datas
// -----------------------------------------------------------------------------

interface Amount {
  /** Índices dos tokens (inclusive) que formam o valor, com moeda e centavos. */
  start: number;
  end: number;
  value: number;
  score: number;
}

const NOT_MONEY_AFTER = new Set(['x', 'vezes', 'parcelas', 'parcela', 'dias', 'dia', 'horas', 'hora', 'h', 'min', 'minutos', 'km', 'kg', 'litros', 'anos', 'meses', '%']);
const MONEY_VERBS = new Set(['por', 'de', 'valor', 'custou', 'foi', 'deu', 'paguei', 'gastei', 'comprei', 'recebi', 'ganhei', 'pago', 'gasto']);
/** Conectores que abrem o próximo gasto de uma lista ("20 no pão e 50 de uber"). */
const CONNECTORS = new Set(['e', ',', 'depois', 'tambem', 'mais']);
/** Palavras que podem vir logo depois de um valor ("45 no mercado"); outra palavra sugere quantidade ("2 camisas"). */
const AFTER_AMOUNT = new Set(['de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'num', 'numa', 'em', 'para', 'pra', 'com', 'por', 'e', 'ate', 'ontem', 'hoje', 'anteontem']);

const isNumberToken = (t: string | undefined) => t !== undefined && /^\d[\d.,]*$/.test(t);

/** Valores monetários do texto, com a confiança de cada um (moeda ao lado vale mais). */
function findAmounts(tokens: string[]): Amount[] {
  const found: Amount[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!isNumberToken(token)) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    // Dia do mês, quantidade de parcelas, horas, quilômetros…
    if (prev === 'dia' || NOT_MONEY_AFTER.has(next ?? '')) continue;
    let value = parseBrNumber(token);
    if (value === null) continue;
    let end = i;
    let score = 0;
    if (prev === 'r$') score = 3;
    if (CURRENCY.has(next ?? '')) {
      score = 3;
      end = i + 1;
      // "45 reais e 90 centavos" / "45 reais e 90"
      if (tokens[end + 1] === 'e' && isNumberToken(tokens[end + 2]) && Number(tokens[end + 2]) < 100 && !CURRENCY.has(tokens[end + 3] ?? '')) {
        value += Number(tokens[end + 2]) / 100;
        end += 2;
        if (tokens[end + 1] === 'centavos' || tokens[end + 1] === 'centavo') end++;
      }
    } else if (tokens[i + 1] === 'e' && isNumberToken(tokens[i + 2]) && (tokens[i + 3] === 'centavos' || tokens[i + 3] === 'centavo')) {
      value += Number(tokens[i + 2]) / 100;
      end = i + 3;
      score = 3;
    }
    if (token.includes(',') || /\.\d{1,2}$/.test(token)) score = Math.max(score, 2);
    if (score === 0 && prev && (MONEY_VERBS.has(prev) || CONNECTORS.has(prev))) score = 1;
    // "comprei 2 camisas por 80": o 2 é quantidade, não valor.
    const after = tokens[end + 1];
    if (score < 3 && after !== undefined && /^[a-z]+$/.test(after) && !AFTER_AMOUNT.has(after)) score = 0;
    found.push({ start: prev === 'r$' ? i - 1 : i, end, value: Math.round(value * 100) / 100, score });
    i = end;
  }
  return found;
}

/** "em 3x de 100", "3 vezes de 100", "parcelado em 10x". */
function findInstallments(tokens: string[]): { count: number; amount: number | null; start: number; end: number } | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!isNumberToken(tokens[i])) continue;
    if (!['x', 'vezes', 'parcelas', 'parcela'].includes(tokens[i + 1] ?? '')) continue;
    const count = Number(tokens[i]);
    if (!Number.isInteger(count) || count < 2 || count > 120) continue;
    let end = i + 1;
    let amount: number | null = null;
    let j = i + 2;
    if (tokens[j] === 'de') j++;
    if (tokens[j] === 'r$') j++;
    if (isNumberToken(tokens[j])) {
      amount = parseBrNumber(tokens[j]!);
      end = j;
      if (CURRENCY.has(tokens[end + 1] ?? '')) end++;
    }
    return { count, amount, start: tokens[i - 1] === 'em' ? i - 1 : i, end };
  }
  return null;
}

const WEEKDAYS: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

/** Dia da semana (0 = domingo) de uma data ISO. */
function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

function dateFromTokens(tokens: string[], today: string): { date: string; certain: boolean } {
  if (tokens.includes('anteontem')) return { date: addDays(today, -2), certain: true };
  if (tokens.includes('ontem')) return { date: addDays(today, -1), certain: true };
  if (tokens.includes('hoje')) return { date: today, certain: true };
  const dayIndex = tokens.findIndex((t, i) => t === 'dia' && isNumberToken(tokens[i + 1]));
  if (dayIndex >= 0) {
    const day = Number(tokens[dayIndex + 1]);
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      const [year, month, todayDay] = today.split('-').map(Number) as [number, number, number];
      let y = year;
      let m = month;
      if (day > todayDay) {
        m -= 1;
        if (m === 0) {
          m = 12;
          y -= 1;
        }
      }
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { date: `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`, certain: true };
    }
  }
  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    const at = tokens.findIndex((t) => t === name || t === `${name}-feira`);
    if (at < 0) continue;
    let back = (weekdayOf(today) - weekday + 7) % 7;
    if (back === 0 && (tokens.includes('passada') || tokens.includes('passado'))) back = 7;
    return { date: addDays(today, -back), certain: true };
  }
  return { date: today, certain: false };
}

// -----------------------------------------------------------------------------
// Conta, categoria e descrição
// -----------------------------------------------------------------------------

const ENTRY_WORDS = new Set(['recebi', 'ganhei', 'entrou', 'caiu', 'salario', 'vendi', 'reembolso', 'freela', 'deposito', 'depositaram', 'pagaram', 'recebimento']);
const FILLER = new Set([
  'gastei', 'gasto', 'gastou', 'paguei', 'pago', 'pagamento', 'comprei', 'compra', 'foi', 'deu', 'fiz', 'fui', 'tive', 'recebi', 'ganhei', 'entrou', 'caiu', 'saiu', 'custou',
  'lancar', 'lance', 'registre', 'registrar', 'anote', 'anota', 'ai', 'entao', 'tambem', 'mais', 'depois', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'um',
  'uma', 'o', 'a', 'os', 'as', 'com', 'pra', 'para', 'por', 'pelo', 'pela', 'e', 'hoje', 'ontem', 'anteontem', 'dia', 'passada', 'passado', 'x', 'vezes', 'parcelas', 'parcela',
  'parcelado', 'r$', 'centavos', 'centavo', 'meu', 'minha', 'la', 'ao', 'as', 'foram', 'que', 'ja',
]);

const singular = (word: string) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);

/** A palavra (ou frase) aparece nos tokens? Aceita o plural simples. */
function hasPhrase(tokens: string[], phrase: string): boolean {
  const words = phrase.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (words.every((w, k) => singular(tokens[i + k]!) === singular(w))) return true;
  }
  return false;
}

function pickCategory(tokens: string[], kind: 'GASTO' | 'ENTRADA', ctx: ParseContext): number | null {
  const own = ctx.categories.filter((c) => c.kind === kind);
  for (const rule of ctx.learned ?? []) {
    if (hasPhrase(tokens, rule.word) && own.some((c) => c.id === rule.category_id)) return rule.category_id;
  }
  let best: { id: number; size: number } | null = null;
  for (const category of own) {
    const candidates = [...category.keywords, category.name];
    for (const word of candidates) {
      if (hasPhrase(tokens, word) && (!best || word.length > best.size)) best = { id: category.id, size: word.length };
    }
  }
  return best?.id ?? null;
}

function pickAccount(tokens: string[], accounts: ParseAccount[]): number | null {
  const skip = new Set(['conta', 'principal', 'de', 'do', 'da', 'banco']);
  for (const account of accounts) {
    const words = tokenize(account.name).filter((w) => w.length >= 3 && !skip.has(w));
    if (words.length > 0 && words.every((w) => hasPhrase(tokens, w))) return account.id;
  }
  const byKind = (kind: ParseAccount['kind']) => accounts.find((a) => a.kind === kind)?.id ?? null;
  if (hasPhrase(tokens, 'cartao') || hasPhrase(tokens, 'credito')) return byKind('CARTAO');
  if (hasPhrase(tokens, 'dinheiro') || hasPhrase(tokens, 'especie')) return byKind('CARTEIRA');
  return null;
}

function describe(tokens: string[], skipIndexes: Set<number>, accountWords: string[]): string {
  const words = tokens.filter((t, i) => {
    if (skipIndexes.has(i) || FILLER.has(t) || CURRENCY.has(t) || /^\d/.test(t) || /^[^a-z]$/.test(t)) return false;
    if (t in WEEKDAYS || accountWords.includes(t)) return false;
    return true;
  });
  const text = words.join(' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

// -----------------------------------------------------------------------------
// Interpretador
// -----------------------------------------------------------------------------

function interpret(tokens: string[], source: string, amount: Amount | null, ctx: ParseContext): ParsedEntry {
  const kind: ParsedEntry['kind'] = tokens.some((t) => ENTRY_WORDS.has(t)) ? 'ENTRADA' : 'GASTO';
  const installments = findInstallments(tokens);
  const date = dateFromTokens(tokens, ctx.today);
  const categoryId = pickCategory(tokens, kind, ctx);
  const accountId = pickAccount(tokens, ctx.accounts);
  const skip = new Set<number>();
  if (amount) for (let i = amount.start; i <= amount.end; i++) skip.add(i);
  if (installments) for (let i = installments.start; i <= installments.end; i++) skip.add(i);
  const account = ctx.accounts.find((a) => a.id === accountId);
  const accountWords = account ? [...tokenize(account.name), 'cartao', 'credito', 'dinheiro', 'especie'] : [];
  const description = describe(tokens, skip, accountWords);
  const category = ctx.categories.find((c) => c.id === categoryId);
  const value = amount?.value ?? installments?.amount ?? null;
  const uncertain: Uncertain[] = [];
  if (value === null) uncertain.push('amount');
  if (categoryId === null) uncertain.push('category');
  return {
    kind,
    amount: value,
    date: date.date,
    description: description || category?.name || '',
    categoryId,
    accountId,
    installments: installments ? { count: installments.count, amount: installments.amount ?? (amount ? Math.round((amount.value / installments.count) * 100) / 100 : null) } : null,
    uncertain,
    source,
  };
}

/** Quebra em um trecho por valor: no conector ("e", "depois", vírgula) entre dois valores, ou logo antes do segundo. */
function splitSegments(tokens: string[], amounts: Amount[]): Array<{ from: number; to: number; amount: Amount }> {
  const segments: Array<{ from: number; to: number; amount: Amount }> = [];
  let from = 0;
  amounts.forEach((amount, k) => {
    const nextAmount = amounts[k + 1];
    let to = tokens.length;
    if (nextAmount) {
      to = nextAmount.start;
      // Recua até um conector entre os dois valores; se não houver, corta antes do segundo valor.
      for (let i = nextAmount.start - 1; i > amount.end; i--) {
        if (['e', 'depois', ',', 'tambem', 'mais'].includes(tokens[i]!)) {
          to = i;
          break;
        }
      }
      // O verbo que abre o segundo trecho ("e gastei 50") acompanha o segundo valor.
      while (to > amount.end + 1 && ['e', 'depois', ',', 'tambem', 'mais'].includes(tokens[to - 1]!)) to--;
    }
    segments.push({ from, to, amount });
    from = to;
    if (nextAmount && ['e', 'depois', ',', 'tambem', 'mais'].includes(tokens[from] ?? '')) from++;
  });
  return segments;
}

/** Interpreta uma frase falada ou digitada. Devolve um rascunho por valor encontrado. */
export function parseSpoken(text: string, ctx: ParseContext): ParsedEntry[] {
  const tokens = digitize(tokenize(text));
  if (tokens.length === 0) return [];
  const installments = findInstallments(tokens);
  let amounts = findAmounts(tokens);
  // O valor "de" cada parcela pertence ao parcelado, não é outro gasto.
  if (installments) amounts = amounts.filter((a) => a.start > installments.end || a.end < installments.start || installments.amount === null);
  // Havendo valores com moeda, números soltos (quantidade, endereço…) ficam de fora.
  const confident = amounts.filter((a) => a.score >= 1);
  if (confident.length > 0) amounts = confident;
  if (amounts.length === 0) return [interpret(tokens, text.trim(), null, ctx)];
  return splitSegments(tokens, amounts).map(({ from, to, amount }) => {
    const part = tokens.slice(from, to);
    return interpret(part, part.join(' '), { ...amount, start: amount.start - from, end: amount.end - from }, ctx);
  });
}

/** Palavras da descrição que vale ensinar ao interpretador (até duas, sem as de ligação). */
export function learnableWords(description: string): string[] {
  return tokenize(description)
    .filter((t) => /^[a-z]{3,}$/.test(t) && !FILLER.has(t) && !CURRENCY.has(t))
    .slice(0, 2);
}
