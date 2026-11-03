import { AtSign, MessageCircle } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type QuoteRow, QUOTE_STATUS_LABELS, type QuoteStatus } from '@/data/quotes';
import { instagramLink, whatsappLink } from '@/features/sales/sales-utils';
import { cn } from '@/lib/cn';
import { followUpInfo } from './quote-utils';

const STATUS_TONES: Record<QuoteStatus, Tone> = {
  NOVO: 'accent',
  EM_ANALISE: 'warning',
  PROPOSTA_ENVIADA: 'info',
  GANHO: 'success',
  PERDIDO: 'danger',
};

export function QuoteStatusBadge({ status, className }: { status: QuoteStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      {QUOTE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function FollowUpText({ quote, today, className }: { quote: Pick<QuoteRow, 'follow_up_at' | 'is_open'>; today: string; className?: string }) {
  const info = followUpInfo(quote, today);
  if (!info) return null;
  return <span className={cn('text-xs font-medium', info.tone === 'danger' ? 'text-danger' : info.tone === 'warning' ? 'text-warning' : 'text-muted', className)}>{info.label}</span>;
}

/** Botões de contato: WhatsApp (com texto pronto, se houver) e Instagram. */
export function ContactButtons({ phone, instagram, text, size = 'sm' }: { phone: string | null; instagram: string | null; text?: string; size?: 'sm' | 'md' }) {
  const wa = whatsappLink(phone, text);
  const ig = instagramLink(instagram);
  if (!wa && !ig) return null;
  return (
    <>
      {wa ? (
        <Button asChild variant="outline" size={size}>
          <a href={wa} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> WhatsApp
          </a>
        </Button>
      ) : null}
      {ig ? (
        <Button asChild variant="ghost" size={size}>
          <a href={ig} target="_blank" rel="noopener noreferrer" aria-label="Abrir Instagram">
            <AtSign /> Instagram
          </a>
        </Button>
      ) : null}
    </>
  );
}
