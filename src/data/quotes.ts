import { from, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';
import type { CustomItemPreview } from './sales';

/**
 * Orçamentos: o pedido de orçamento é anotado como um questionário, analisado (ficha, custo e
 * preço), enviado como proposta e, se aceito, vira pedido. Quem não responde fica na lista com a
 * data do próximo retorno. Leituras pela view v_quotes; toda escrita passa por RPC do dono.
 */

export type QuoteStatus = 'NOVO' | 'EM_ANALISE' | 'PROPOSTA_ENVIADA' | 'GANHO' | 'PERDIDO';
export type QuoteSource = 'WHATSAPP' | 'INSTAGRAM' | 'PRESENCIAL' | 'FEIRA' | 'INDICACAO' | 'OUTRO';
export type LostReason = 'PRECO' | 'PRAZO' | 'SUMIU' | 'ACHOU_PRONTO' | 'DESISTIU' | 'OUTRO';
export type QuoteEventKind = 'NOTA' | 'CONTATO' | 'STATUS' | 'PRECO';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  NOVO: 'Para analisar',
  EM_ANALISE: 'Em análise',
  PROPOSTA_ENVIADA: 'Proposta enviada',
  GANHO: 'Virou pedido',
  PERDIDO: 'Perdido',
};

export const OPEN_QUOTE_STATUSES: QuoteStatus[] = ['NOVO', 'EM_ANALISE', 'PROPOSTA_ENVIADA'];

export const QUOTE_SOURCE_LABELS: Record<QuoteSource, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  PRESENCIAL: 'Pessoalmente',
  FEIRA: 'Feira',
  INDICACAO: 'Indicação',
  OUTRO: 'Outro',
};

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  PRECO: 'Achou caro',
  PRAZO: 'Prazo não serviu',
  SUMIU: 'Sumiu (não respondeu)',
  ACHOU_PRONTO: 'Achou pronto em outro lugar',
  DESISTIU: 'Desistiu',
  OUTRO: 'Outro motivo',
};

/** Ficha simplificada guardada no orçamento (mesmo formato de preview_custom_item). */
export interface QuoteAnalysis {
  name?: string;
  units_per_plate?: number;
  est_print_minutes_per_plate?: number | null;
  default_equipment_id?: number | null;
  channel_id?: number | null;
  lines: Array<{ item_id: number; qty_per_unit: string }>;
}

export interface QuoteRow {
  id: number;
  number: string;
  status: QuoteStatus;
  source: QuoteSource | null;
  customer_id: number | null;
  /** Nome do cliente cadastrado ou, na falta dele, o nome anotado. */
  display_name: string | null;
  phone: string | null;
  instagram: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_instagram: string | null;
  item_wanted: string;
  size_text: string | null;
  color_text: string | null;
  qty: number;
  desired_date: string | null;
  notes: string | null;
  reference_links: string | null;
  reference_photo_paths: string[];
  analysis: QuoteAnalysis | null;
  cost_estimate: CustomItemPreview | null;
  proposal_description: string | null;
  quoted_unit_price: number | null;
  quoted_at: string | null;
  valid_until: string | null;
  quoted_total: number | null;
  follow_up_at: string | null;
  follow_up_count: number;
  last_contact_at: string | null;
  is_open: boolean;
  follow_up_due: boolean;
  age_days: number;
  lost_reason: LostReason | null;
  lost_note: string | null;
  closed_at: string | null;
  order_id: number | null;
  order_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteEvent {
  id: number;
  quote_id: number;
  kind: QuoteEventKind;
  text: string;
  created_at: string;
}

export function useQuotes() {
  return useAppQuery(['quotes'], () => unwrap<QuoteRow[]>(from('v_quotes').select('*').order('created_at', { ascending: false })));
}

export function useQuote(id: number | undefined) {
  return useAppQuery(
    ['quotes', 'detail', id],
    async () => {
      const rows = await unwrap<QuoteRow[]>(from('v_quotes').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

export function useQuoteEvents(id: number | undefined) {
  return useAppQuery(
    ['quotes', 'events', id],
    () => unwrap<QuoteEvent[]>(from('quote_events').select('*').eq('quote_id', id!).order('id', { ascending: false })),
    { enabled: Boolean(id) },
  );
}

export interface QuoteInput {
  id?: number;
  item_wanted: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_instagram?: string | null;
  customer_id?: number | null;
  source?: QuoteSource | null;
  size_text?: string | null;
  color_text?: string | null;
  qty?: number;
  desired_date?: string | null;
  notes?: string | null;
  reference_links?: string | null;
  reference_photo_paths?: string[];
}

export function useSaveQuote(onSaved?: (id: number) => void) {
  return useWrite<QuoteInput, number>({
    mutationFn: (quote) => rpc<number>('save_quote', { p_quote: quote }),
    success: (_id, q) => (q.id ? 'Orçamento atualizado.' : 'Orçamento anotado.'),
    onSuccess: (id) => onSaved?.(id),
  });
}

export function useAnalyzeQuote(onDone?: (preview: CustomItemPreview | null) => void) {
  return useWrite<{ quoteId: number; analysis: QuoteAnalysis }, { preview: CustomItemPreview | null }>({
    mutationFn: (v) => rpc('analyze_quote', { p_quote_id: v.quoteId, p_analysis: v.analysis }),
    success: 'Análise salva.',
    onSuccess: (r) => onDone?.(r.preview),
  });
}

export function useSendQuote(onDone?: () => void) {
  return useWrite<{ quoteId: number; unitPrice: string; validUntil: string | null; description: string | null; followUpAt?: string | null }>({
    mutationFn: (v) =>
      rpc('send_quote', { p_quote_id: v.quoteId, p_unit_price: v.unitPrice, p_valid_until: v.validUntil, p_description: v.description, p_follow_up_at: v.followUpAt ?? null }),
    success: 'Proposta registrada. O sistema avisa quando for hora de procurar o cliente.',
    onSuccess: () => onDone?.(),
  });
}

export function useLogQuoteContact(onDone?: () => void) {
  return useWrite<{ quoteId: number; note?: string | null; nextFollowUp?: string | null }>({
    mutationFn: (v) => rpc('log_quote_contact', { p_quote_id: v.quoteId, p_note: v.note ?? null, p_next_follow_up: v.nextFollowUp ?? null }),
    success: 'Contato registrado.',
    onSuccess: () => onDone?.(),
  });
}

export function useSetQuoteFollowUp(onDone?: () => void) {
  return useWrite<{ quoteId: number; date: string }>({
    mutationFn: (v) => rpc('set_quote_follow_up', { p_quote_id: v.quoteId, p_date: v.date }),
    success: 'Retorno marcado.',
    onSuccess: () => onDone?.(),
  });
}

export function useAddQuoteNote(onDone?: () => void) {
  return useWrite<{ quoteId: number; text: string }>({
    mutationFn: (v) => rpc('add_quote_note', { p_quote_id: v.quoteId, p_text: v.text }),
    success: 'Anotação salva.',
    onSuccess: () => onDone?.(),
  });
}

export function useSetQuoteStatus(onDone?: () => void) {
  return useWrite<{ quoteId: number; status: QuoteStatus; reason?: LostReason | null; note?: string | null }>({
    mutationFn: (v) => rpc('set_quote_status', { p_quote_id: v.quoteId, p_status: v.status, p_reason: v.reason ?? null, p_note: v.note ?? null }),
    success: (_r, v) => (v.status === 'PERDIDO' ? 'Orçamento encerrado como perdido.' : v.status === 'GANHO' ? 'Orçamento marcado como ganho.' : 'Orçamento reaberto.'),
    onSuccess: () => onDone?.(),
  });
}
