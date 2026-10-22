import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge, type Tone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { FUNDING_LABELS, type OwnerFundingType, type Payer, PAYER_LABELS } from '@/data/finance';
import { type PurchaseStatus, STATUS_LABELS } from '@/data/purchasing';
import { cn } from '@/lib/cn';
import { formatNumber, formatQty, type Numeric, toNumber } from '@/lib/money';

const STATUS_TONES: Record<PurchaseStatus, Tone> = {
  RASCUNHO: 'neutral',
  CONFIRMADA: 'info',
  RECEBIDA_PARCIAL: 'warning',
  RECEBIDA: 'success',
  CANCELADA: 'danger',
};

export function StatusBadge({ status, className }: { status: PurchaseStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function PayerBadge({ payer, funding, className }: { payer: Payer; funding?: OwnerFundingType | null; className?: string }) {
  return (
    <Badge tone={payer === 'DONO' ? 'accent' : 'neutral'} className={className} title={payer === 'DONO' && funding ? FUNDING_LABELS[funding] : undefined}>
      {PAYER_LABELS[payer]}
      {payer === 'DONO' && funding ? <span className="font-normal">· {FUNDING_LABELS[funding].toLowerCase()}</span> : null}
    </Badge>
  );
}

/** Quantidade comprada; filamento também em carretéis/kg ("3.000 g · 3 kg"). */
export function PurchaseQty({ qty, unit, filament, className }: { qty: Numeric; unit: string | null | undefined; filament?: boolean; className?: string }) {
  const grams = toNumber(qty);
  return (
    <span className={cn('num whitespace-nowrap', className)}>
      {formatQty(qty, unit ?? 'UN')}
      {filament && grams >= 1000 ? <span className="text-xs text-muted"> · {formatNumber(grams / 1000, 3)} kg</span> : null}
    </span>
  );
}

/** Página de compras/fornecedores para quem não vê valores (Produção): os dados ficam ocultos pela RLS. */
export function NoPurchaseAccess({ title }: { title: string }) {
  return (
    <Page>
      <PageHeader title={title} />
      <EmptyState icon={<ShieldOff />} title="Sem acesso" description="Compras e fornecedores mostram valores financeiros e estão disponíveis só para o dono e para o perfil de leitura." />
    </Page>
  );
}

/** Aviso destacado (bloqueios, explicações de regra). */
export function Callout({ tone = 'info', title, children, className, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const tones = {
    info: 'bg-info-soft text-info',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    success: 'bg-success-soft text-success',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('flex flex-col gap-2 rounded-lg px-3 py-2.5 text-sm sm:flex-row sm:items-center', tones[tone], className)}>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5', 'leading-snug')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function InfoItem({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
