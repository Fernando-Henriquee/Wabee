import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ColorDot, RemainingBar } from '@/components/shared/item-bits';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { LOT_STATUS_LABELS, useLots } from '@/data/inventory';
import { formatDateBR } from '@/lib/dates';
import { formatQty, toNumber } from '@/lib/money';

/** Carretéis com saldo, abertos primeiro (US-1.6). */
export function LotsPage() {
  const lots = useLots(undefined, true);
  const sorted = [...(lots.data ?? [])].sort((a, b) => (a.status === b.status ? toNumber(a.qty_remaining) - toNumber(b.qty_remaining) : a.status === 'ABERTO' ? -1 : 1));
  return (
    <Page>
      <PageHeader
        back={
          <Link to="/estoque" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Estoque
          </Link>
        }
        title="Carretéis"
        description="Quanto resta em cada carretel, abertos primeiro."
      />
      {lots.isError ? (
        <ErrorState error={lots.error} />
      ) : !lots.data ? (
        <LoadingBlock />
      ) : sorted.length === 0 ? (
        <EmptyState title="Nenhum carretel com saldo" description="Registre o saldo inicial dos filamentos ou receba uma compra." />
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((lot) => (
            <li key={lot.id}>
              <Link to={`/estoque/itens/${lot.item_id}`} className="block rounded-[var(--radius-card)] border border-line bg-panel p-3 hover:border-ink">
                <div className="flex items-center gap-2">
                  <ColorDot hex={lot.color_hex} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{lot.item_name}</span>
                  <Badge tone={lot.status === 'ABERTO' ? 'accent' : 'neutral'}>{LOT_STATUS_LABELS[lot.status]}</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <RemainingBar pct={lot.remaining_pct} />
                  <span className="num shrink-0 text-sm font-medium">{formatQty(lot.qty_remaining, 'G')}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {lot.lot_code} · recebido {formatDateBR(lot.received_at.slice(0, 10))}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
