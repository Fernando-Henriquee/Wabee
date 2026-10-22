import { useSyncExternalStore } from 'react';
import type { Tone } from '@/components/ui/badge';
import type { CustomerRef, OrderKind, OrderStatus } from '@/data/sales';
import { todayIn } from '@/lib/dates';

/** Utilitários do módulo de vendas (sem componentes). */

export const STATUS_TONES: Record<OrderStatus, Tone> = {
  RASCUNHO: 'neutral',
  CONFIRMADO: 'info',
  EM_PRODUCAO: 'warning',
  PRONTO: 'accent',
  ENTREGUE: 'success',
  CANCELADO: 'danger',
};

/** Data local (AAAA-MM-DD) de um timestamp, no fuso da empresa. */
export function localDate(timestamp: string | null | undefined, timeZone: string): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : todayIn(timeZone, date);
}

/** Início do dia no fuso operacional (mesma convenção do restante do app). */
export function dayStart(iso: string): string {
  return `${iso}T00:00:00-03:00`;
}

/** Data escolhida na tela → timestamp para a RPC (hoje = agora, para manter a hora real). */
export function dateToTimestamp(iso: string, today: string): string | null {
  return iso === today ? null : `${iso}T12:00:00-03:00`;
}

export type CustomerChoice =
  | { kind: 'none' }
  | { kind: 'existing'; id: number; name: string; detail?: string | null }
  | { kind: 'new'; name: string; phone: string; instagram: string };

export const NO_CUSTOMER: CustomerChoice = { kind: 'none' };

/** Cliente existente ou cadastro rápido junto com a venda (new_customer). */
export function customerRef(choice: CustomerChoice): CustomerRef {
  if (choice.kind === 'existing') return { customer_id: choice.id };
  if (choice.kind === 'new') return { new_customer: { name: choice.name.trim(), phone: choice.phone.trim() || null, instagram: choice.instagram.trim() || null } };
  return {};
}

/** Pré-preenchimento de /vendas/nova (ex.: venda rápida sem saldo virando encomenda). */
export interface OrderPrefill {
  kind?: OrderKind;
  channelId?: number | null;
  customer?: CustomerChoice;
  lines: Array<{ variantId?: number | null; itemId?: number | null; qty: string; unitPrice: string | null; isGift: boolean }>;
  orderDiscount?: string | null;
  shippingCharged?: string | null;
  reason?: string;
}

const FEIRA_KEY = 'wabee:feira';

export interface FeiraState {
  on: boolean;
  channelId: number | null;
  accountId: number | null;
}

/** Modo feira guardado no aparelho (pode faltar em janela anônima ou com armazenamento bloqueado). */
export function loadFeira(): FeiraState | null {
  try {
    const raw = window.localStorage.getItem(FEIRA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FeiraState>;
    return { on: Boolean(parsed.on), channelId: typeof parsed.channelId === 'number' ? parsed.channelId : null, accountId: typeof parsed.accountId === 'number' ? parsed.accountId : null };
  } catch {
    return null;
  }
}

export function saveFeira(state: FeiraState) {
  try {
    window.localStorage.setItem(FEIRA_KEY, JSON.stringify(state));
  } catch {
    // Sem armazenamento local: o modo feira vale só até fechar a tela.
  }
}

export function initials(name: string): string {
  const words = name
    .replace(/[—–-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(de|da|do|das|dos|e)$/i.test(w));
  const picked = words.length > 1 && /^chaveiros?$/i.test(words[0]!) ? words.slice(1) : words;
  if (picked.length === 1) return picked[0]!.slice(0, 2).toUpperCase();
  return (picked.slice(0, 2).map((w) => w.charAt(0)).join('') || name.slice(0, 2)).toUpperCase();
}

/** Só exibimos fotos com endereço completo; caminhos de armazenamento ficam com as iniciais. */
export function photoUrl(path: string | null | undefined): string | null {
  return path && /^(https?:|data:|blob:)/.test(path) ? path : null;
}

export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function instagramLink(handle: string | null | undefined): string | null {
  const clean = (handle ?? '').trim().replace(/^@/, '');
  return /^[\w.]{1,30}$/.test(clean) ? `https://instagram.com/${clean}` : null;
}

const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribeDesktop(callback: () => void) {
  const list = window.matchMedia(DESKTOP_QUERY);
  list.addEventListener('change', callback);
  return () => list.removeEventListener('change', callback);
}

/** Layout de computador (lg, ≥ 1024 px). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}
