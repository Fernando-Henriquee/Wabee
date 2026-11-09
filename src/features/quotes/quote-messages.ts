import type { QuoteRow } from '@/data/quotes';
import { formatDateBR } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { PIX_KEY_TYPE_LABELS, type PixKeyType, pixKeyForPayment } from '@/lib/pix';

/** Textos prontos do WhatsApp: a proposta (com o PIX) e as mensagens para retomar quem não respondeu. */

export interface PixInfo {
  key: string;
  type: PixKeyType;
  holder: string | null;
}

export interface QuoteMessageContext {
  /** Nome de quem pediu (pode estar vazio). */
  name: string | null;
  item: string;
  qty: number;
  size: string | null;
  color: string | null;
  /** Descrição escrita na proposta. */
  description: string | null;
  unitPrice: number | null;
  /** Data (AAAA-MM-DD) até quando o valor vale. */
  validUntil: string | null;
  company: string;
  pix: PixInfo | null;
}

/** Valor em reais com espaço comum (o formatador usa espaço sem quebra; NFKC o troca pelo espaço normal). */
const money = (value: number) => formatBRL(value).normalize('NFKC');

/** Contexto das mensagens a partir do orçamento (o PIX só entra na proposta). */
export function quoteMessageContext(quote: QuoteRow, company: string, pix: PixInfo | null): QuoteMessageContext {
  return {
    name: quote.display_name,
    item: quote.item_wanted,
    qty: quote.qty,
    size: quote.size_text,
    color: quote.color_text,
    description: quote.proposal_description,
    unitPrice: quote.quoted_unit_price,
    validUntil: quote.valid_until,
    company,
    pix,
  };
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

const greeting = (name: string | null) => {
  const first = firstName(name);
  return first ? `Oi, ${first}!` : 'Oi!';
};

/** Valor da proposta: "R$ 35,50" ou "R$ 35,50 cada (2 peças = R$ 71,00)". */
export function priceLine(unitPrice: number, qty: number): string {
  if (qty <= 1) return money(unitPrice);
  return `${money(unitPrice)} cada (${qty} peças = ${money(Math.round(unitPrice * qty * 100) / 100)})`;
}

/** Bloco de pagamento: a chave numa linha só, para copiar com um toque. */
export function pixBlock(pix: PixInfo | null): string | null {
  if (!pix || !pix.key.trim()) return null;
  const lines = ['Pagamento via PIX:', pixKeyForPayment(pix.type, pix.key)];
  lines.push(pix.holder?.trim() ? `(${PIX_KEY_TYPE_LABELS[pix.type]} · titular: ${pix.holder.trim()})` : `(${PIX_KEY_TYPE_LABELS[pix.type]})`);
  return lines.join('\n');
}

const details = (ctx: QuoteMessageContext) =>
  [ctx.size ? `Tamanho: ${ctx.size}` : null, ctx.color ? `Cor: ${ctx.color}` : null, ctx.qty > 1 ? `Quantidade: ${ctx.qty}` : null].filter(Boolean).join(' · ');

/** Texto da proposta enviada ao cliente. */
export function proposalMessage(ctx: QuoteMessageContext): string {
  const parts: Array<string | null> = [
    `${greeting(ctx.name)} Aqui é da ${ctx.company}.`,
    `Segue o orçamento: ${ctx.item}.`,
    ctx.description?.trim() || null,
    details(ctx) || null,
    ctx.unitPrice !== null ? `Valor combinado: ${priceLine(ctx.unitPrice, ctx.qty)}` : null,
    ctx.validUntil ? `Válido até ${formatDateBR(ctx.validUntil)}.` : null,
    pixBlock(ctx.pix),
    'Se estiver tudo certo, é só me avisar que já começo a produzir!',
  ];
  return parts.filter((part): part is string => Boolean(part)).join('\n\n');
}

export interface FollowUpTemplate {
  id: string;
  label: string;
  text: string;
}

/** Mensagens para procurar o cliente de novo (as de valor só aparecem quando já há proposta). */
export function followUpTemplates(ctx: QuoteMessageContext): FollowUpTemplate[] {
  const hi = greeting(ctx.name);
  if (ctx.unitPrice === null) {
    return [
      { id: 'info', label: 'Pedir detalhes', text: `${hi} Sobre ${ctx.item}: ainda tem interesse? Me confirma tamanho e cor para eu fechar o valor certinho.` },
      { id: 'interest', label: 'Ainda tem interesse?', text: `${hi} Tudo bem? Passando para saber se ainda tem interesse em ${ctx.item}. Qualquer dúvida é só falar!` },
    ];
  }
  const price = priceLine(ctx.unitPrice, ctx.qty);
  const validity = ctx.validUntil ? ` (válido até ${formatDateBR(ctx.validUntil)})` : '';
  return [
    { id: 'interest', label: 'Ainda tem interesse?', text: `${hi} Tudo bem? Passando para saber se ainda tem interesse em ${ctx.item}. O valor era ${price}${validity}. Qualquer dúvida é só falar!` },
    { id: 'hold', label: 'Segurar o valor', text: `${hi} Consigo segurar o valor de ${price} para ${ctx.item} por mais alguns dias. Quer que eu já separe uma vaga na produção?` },
    { id: 'cheaper', label: 'Versão mais em conta', text: `${hi} Sobre ${ctx.item}: consigo pensar numa versão mais em conta (outro acabamento ou tamanho). Quer que eu faça uma nova proposta?` },
  ];
}
