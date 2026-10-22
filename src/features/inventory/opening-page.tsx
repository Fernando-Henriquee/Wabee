import { ArrowLeft, Check } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ColorDot, Qty } from '@/components/shared/item-bits';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, LoadingBlock } from '@/components/ui/states';
import { type ItemKind, type ItemRow, KIND_TABS, useItems } from '@/data/inventory';
import { toNumber } from '@/lib/money';
import { OpeningBalanceDialog } from './stock-dialogs';

/** Saldo inicial em sequência (US-1.3): o que a Wabee já tem hoje, item por item. */
export function OpeningPage() {
  const [kind, setKind] = useState<ItemKind>('FILAMENT');
  const items = useItems({ kind });
  const [item, setItem] = useState<ItemRow | null>(null);
  const rows = items.data ?? [];
  return (
    <Page className="max-w-3xl">
      <PageHeader
        back={
          <Link to="/estoque" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Estoque
          </Link>
        }
        title="Saldo inicial"
        description="Informe o que você já tem hoje para começar o controle com o estoque real. Itens que já têm saldo usam o ajuste de inventário."
      />
      <Tabs value={kind} onValueChange={(v) => setKind(v as ItemKind)}>
        <TabsList className="mb-4">
          {KIND_TABS.map((tab) => (
            <TabsTrigger key={tab.kind} value={tab.kind}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!items.data ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhum item deste tipo"
          description="Cadastre primeiro o item."
          action={
            kind === 'FINISHED_GOOD' ? undefined : (
              <Button asChild>
                <Link to={`/estoque/itens/novo?tipo=${kind}`}>Cadastrar item</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-panel">
          {rows.map((row) => {
            const has = toNumber(row.qty_on_hand) !== 0 || row.last_movement_at !== null;
            return (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                {row.kind === 'FILAMENT' ? <ColorDot hex={row.color_hex} /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  <span className="text-xs text-muted">{row.sku}</span>
                </span>
                {has ? (
                  <span className="inline-flex items-center gap-1 text-sm text-success">
                    <Check className="size-4" /> <Qty value={row.qty_on_hand} unit={row.unit} />
                  </span>
                ) : (
                  <Button size="sm" onClick={() => setItem(row)}>
                    Informar saldo
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {item ? <OpeningBalanceDialog key={item.id} item={item} open onOpenChange={(o) => !o && setItem(null)} /> : null}
    </Page>
  );
}
