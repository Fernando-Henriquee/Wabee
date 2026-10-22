import Big from 'big.js';
import type { BomLineRow, CostRateRow, RateType, VariantRow } from '@/data/production';
import { DEFAULT_TIMEZONE, todayIn } from '@/lib/dates';
import { formatMinutes, formatNumber, type Numeric, toNumber } from '@/lib/money';

/**
 * Contas das PRÉVIAS da produção (o banco recalcula e grava): minutos decorridos,
 * gramas e minutos pela ficha, rateio dos gramas por saída e datas locais.
 */

/** Minutos inteiros entre o início e agora (nunca negativo). */
export function elapsedMinutes(startedAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.round((now - start) / 60_000));
}

/** Total de minutos → partes h e min. */
export function splitMinutes(total: number | null | undefined): { h: number; m: number } | null {
  if (total === null || total === undefined || !Number.isFinite(total)) return null;
  const value = Math.max(0, Math.round(total));
  return { h: Math.floor(value / 60), m: value % 60 };
}

/** Horas decimais: 121.5 → "121,5 h". */
export function formatHours(hours: Numeric, decimals = 1): string {
  if (hours === null || hours === undefined || hours === '') return '—';
  return `${formatNumber(toNumber(hours), decimals)} h`;
}

/** Linhas de filamento consumidas na impressão (modelo, suporte, purga). */
export function isPrintFilament(line: Pick<BomLineRow, 'line_kind' | 'consumed_at'>): boolean {
  return line.line_kind.startsWith('FILAMENT_') && line.consumed_at === 'PRODUCTION';
}

/**
 * Gramas por filamento pela ficha ativa: Σ qty × gramas por unidade × (1 + desperdício),
 * como private.plan_details (3 casas).
 */
export function bomFilamentGrams(lines: BomLineRow[], outputs: Array<{ bomId: number | null; qty: number }>): Array<{ item_id: number; grams: string }> {
  const totals = new Map<number, Big>();
  for (const output of outputs) {
    if (!output.bomId || output.qty <= 0) continue;
    for (const line of lines) {
      if (line.bom_version_id !== output.bomId || !isPrintFilament(line)) continue;
      const needed = new Big(output.qty).times(line.qty_per_unit).times(new Big(1).plus(line.waste_pct));
      totals.set(line.item_id, (totals.get(line.item_id) ?? new Big(0)).plus(needed));
    }
  }
  return [...totals.entries()].map(([item_id, grams]) => ({ item_id, grams: grams.round(3, Big.roundHalfUp).toString() }));
}

/** Minutos pela ficha: Σ qty ÷ unidades por mesa × minutos por mesa (arredondado). */
export function bomMinutes(variants: Array<Pick<VariantRow, 'units_per_plate' | 'est_print_minutes_per_plate' | 'active_bom_id'>>, quantities: number[]): number {
  let total = 0;
  variants.forEach((variant, index) => {
    const qty = quantities[index] ?? 0;
    if (!variant.active_bom_id || !variant.units_per_plate || qty <= 0) return;
    total += (qty / variant.units_per_plate) * toNumber(variant.est_print_minutes_per_plate);
  });
  return Math.round(total);
}

/**
 * Divide gramas entre as saídas pelos pesos (peso estimado × quantidade), com 1 casa;
 * a última recebe o restante para a soma bater. Sem pesos, divide igualmente.
 */
export function splitByWeight(total: Numeric, weights: Numeric[]): string[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce<Big>((acc, w) => acc.plus(toNumber(w)), new Big(0));
  const amount = new Big(toNumber(total));
  const parts: string[] = [];
  let used = new Big(0);
  weights.forEach((w, i) => {
    if (i === n - 1) {
      parts.push(amount.minus(used).round(1, Big.roundHalfUp).toString());
      return;
    }
    const share = sum.gt(0) ? amount.times(toNumber(w)).div(sum) : amount.div(n);
    const part = share.round(1, Big.roundHalfUp);
    used = used.plus(part);
    parts.push(part.toString());
  });
  return parts;
}

/** Estimativa dos gramas gastos numa falha: proporcional ao tempo até a falha (máx. 100%). */
export function gramsUntilFailure(estimated: Numeric, minutes: number | null, estMinutes: number): string {
  const est = toNumber(estimated);
  if (!minutes || estMinutes <= 0) return '0';
  const fraction = Math.min(1, minutes / estMinutes);
  return new Big(est).times(fraction).round(1, Big.roundHalfUp).toString();
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** Date → valor de <input type="datetime-local"> no horário do aparelho. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Valor de <input type="datetime-local"> → ISO (UTC). Vazio/ inválido → null. */
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Data local (AAAA-MM-DD) de um timestamp no fuso da empresa. */
export function localDateOf(timestamp: string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : todayIn(timeZone, date);
}

/** "14:35" no fuso da empresa. */
export function formatTimeBR(timestamp: string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(date);
}

/** "hoje 14:35", "ontem 09:10" ou "19/10 14:35" no fuso da empresa. */
export function formatWhen(timestamp: string | null | undefined, today: string, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!timestamp) return '—';
  const day = localDateOf(timestamp, timeZone);
  if (!day) return '—';
  const time = formatTimeBR(timestamp, timeZone);
  if (day === today) return `hoje ${time}`;
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return `ontem ${time}`;
  const [, m, d] = day.split('-');
  return `${d}/${m} ${time}`;
}

/** "1h10 de 2h00" e quanto falta / passou. */
export function describeProgress(elapsed: number | null, estimated: number): string {
  if (elapsed === null) return `previsto ${formatMinutes(estimated)}`;
  if (estimated <= 0) return `${formatMinutes(elapsed)} imprimindo`;
  const diff = estimated - elapsed;
  if (diff > 0) return `${formatMinutes(elapsed)} de ${formatMinutes(estimated)} · faltam ~${formatMinutes(diff)}`;
  if (diff === 0) return `${formatMinutes(elapsed)} · deve estar terminando`;
  return `${formatMinutes(elapsed)} · ${formatMinutes(-diff)} além do previsto`;
}

/** Vigência atual (ou futura mais recente) de um tipo de taxa num escopo. */
export function latestRate(rates: CostRateRow[], type: RateType, equipmentId: number | null): CostRateRow | undefined {
  return rates
    .filter((r) => r.rate_type === type && (r.equipment_id ?? null) === equipmentId && r.valid_to === null)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
}
