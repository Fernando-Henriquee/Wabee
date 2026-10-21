/**
 * Datas de negócio são strings ISO "AAAA-MM-DD" (sem horário), interpretadas no
 * fuso horário operacional do negócio (padrão America/Sao_Paulo). Para aritmética
 * usamos Date em UTC, evitando efeitos de horário de verão do navegador.
 */

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(value: string | null | undefined): value is ISODate {
  if (!value) return false;
  const match = ISO_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

function toUTC(iso: ISODate): Date {
  if (!isValidISODate(iso)) throw new Error(`Data inválida: ${iso}`);
  return new Date(`${iso}T00:00:00Z`);
}

function fromUTC(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

/** "Hoje" no fuso informado. */
export function todayIn(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const date = toUTC(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUTC(date);
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Soma meses ajustando para o último dia do mês (igual ao PostgreSQL). */
export function addMonths(iso: ISODate, months: number): ISODate {
  const date = toUTC(iso);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const clamped = Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));
  target.setUTCDate(clamped);
  return fromUTC(target);
}

export function diffInDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86_400_000);
}

export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: ISODate): ISODate {
  const date = toUTC(iso);
  return fromUTC(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

/** Semana começa na segunda-feira (mesma regra dos relatórios no banco). */
export function startOfWeek(iso: ISODate): ISODate {
  const weekday = toUTC(iso).getUTCDay(); // 0 = domingo
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

export function endOfWeek(iso: ISODate): ISODate {
  return addDays(startOfWeek(iso), 6);
}

/**
 * Próxima data com o dia do mês indicado (ex.: 10), ajustada para o último dia em
 * meses curtos. `inclusive` aceita a própria data. Mesma regra de
 * private.next_day_of_month no banco.
 */
export function nextDayOfMonth(from: ISODate, day: number, inclusive: boolean): ISODate {
  const base = toUTC(from);
  for (let offset = 0; offset < 2; offset += 1) {
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth() + offset;
    const monthStart = new Date(Date.UTC(year, month, 1));
    const lastDay = daysInMonth(monthStart.getUTCFullYear(), monthStart.getUTCMonth());
    monthStart.setUTCDate(Math.min(day, lastDay));
    const candidate = fromUTC(monthStart);
    if (candidate > from || (inclusive && candidate === from)) return candidate;
  }
  throw new Error('Inalcançável');
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export function formatDateBR(iso: ISODate | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "DD/MM/AAAA" (ou "D/M/AA") → "AAAA-MM-DD". Anos com 2 dígitos viram 20AA. */
export function parseDateBR(input: string): ISODate | null {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(input.trim());
  if (!match) return null;
  const [, d = '', m = '', y = ''] = match;
  const year = y.length === 2 ? `20${y}` : y;
  const iso = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

/** Data e hora de um timestamp no fuso do negócio: "DD/MM/AAAA HH:mm". */
export function formatDateTimeBR(timestamp: string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', '');
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function monthLabel(iso: ISODate): string {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} de ${y}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type PeriodKind = 'day' | 'week' | 'month' | 'custom';

export interface Period {
  kind: PeriodKind;
  from: ISODate;
  to: ISODate;
}

export function periodFor(kind: Exclude<PeriodKind, 'custom'>, reference: ISODate): Period {
  switch (kind) {
    case 'day':
      return { kind, from: reference, to: reference };
    case 'week':
      return { kind, from: startOfWeek(reference), to: endOfWeek(reference) };
    case 'month':
      return { kind, from: startOfMonth(reference), to: endOfMonth(reference) };
  }
}

/** Período anterior/seguinte do mesmo tipo. */
export function shiftPeriod(period: Period, direction: -1 | 1): Period {
  switch (period.kind) {
    case 'day':
      return periodFor('day', addDays(period.from, direction));
    case 'week':
      return periodFor('week', addDays(period.from, 7 * direction));
    case 'month':
      return periodFor('month', addMonths(period.from, direction));
    case 'custom': {
      const length = diffInDays(period.to, period.from) + 1;
      return { kind: 'custom', from: addDays(period.from, length * direction), to: addDays(period.to, length * direction) };
    }
  }
}

export function describePeriod(period: Period): string {
  switch (period.kind) {
    case 'day':
      return formatDateBR(period.from);
    case 'month':
      return capitalize(monthLabel(period.from));
    default:
      return `${formatDateBR(period.from)} a ${formatDateBR(period.to)}`;
  }
}

/** Serial de data do Excel (sistema 1900) → ISO. */
export function excelSerialToISO(serial: number): ISODate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const whole = Math.floor(serial);
  // 25569 = dias entre 1899-12-30 e 1970-01-01 (inclui o falso 29/02/1900 do Excel).
  const date = new Date((whole - 25569) * 86_400_000);
  return fromUTC(date);
}
