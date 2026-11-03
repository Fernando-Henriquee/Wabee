import { LOST_REASON_LABELS, type QuoteRow } from '@/data/quotes';
import { diffInDays, formatDateBR } from '@/lib/dates';
import { formatBRL } from '@/lib/money';

/** "Retorno hoje", "Atrasado há 3 dias", "Retorno em 5 dias" (ou nada, se não há retorno marcado). */
export function followUpInfo(quote: Pick<QuoteRow, 'follow_up_at' | 'is_open'>, today: string): { label: string; tone: 'danger' | 'warning' | 'muted' } | null {
  if (!quote.is_open || !quote.follow_up_at) return null;
  const diff = diffInDays(quote.follow_up_at, today);
  if (diff < 0) return { label: `Atrasado há ${-diff} ${-diff === 1 ? 'dia' : 'dias'}`, tone: 'danger' };
  if (diff === 0) return { label: 'Retorno hoje', tone: 'warning' };
  return { label: diff === 1 ? 'Retorno amanhã' : `Retorno em ${diff} dias (${formatDateBR(quote.follow_up_at).slice(0, 5)})`, tone: 'muted' };
}

/** Resumo do pedido: "20 cm · vermelha · 2 un". */
export function quoteSummary(quote: Pick<QuoteRow, 'size_text' | 'color_text' | 'qty'>): string {
  return [quote.size_text, quote.color_text, quote.qty > 1 ? `${quote.qty} un` : null].filter(Boolean).join(' · ');
}

export function lostReasonText(quote: Pick<QuoteRow, 'lost_reason'>): string {
  return quote.lost_reason ? LOST_REASON_LABELS[quote.lost_reason] : '';
}

export function priceText(quote: Pick<QuoteRow, 'quoted_unit_price' | 'qty' | 'quoted_total'>): string | null {
  if (quote.quoted_unit_price === null) return null;
  return quote.qty > 1 ? `${formatBRL(quote.quoted_unit_price)} cada · ${formatBRL(quote.quoted_total)}` : formatBRL(quote.quoted_unit_price);
}
