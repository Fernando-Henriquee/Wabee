import { ArrowLeft, MinusCircle, Scale } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { EntityPicker } from '@/components/shared/entity-picker';
import { ColorDot, Qty } from '@/components/shared/item-bits';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { KIND_LABELS, type ItemRow, useItems } from '@/data/inventory';
import { useMember } from '@/features/member/member-context';
import { AdjustStockDialog, StockIssueDialog } from './stock-dialogs';

/** Atalho "Ajuste de estoque" do botão "+": escolhe o item e registra ajuste ou saída. */
export function AdjustPage() {
  const { can } = useMember();
  const items = useItems();
  const [pickerOpen, setPickerOpen] = useState(true);
  const [item, setItem] = useState<ItemRow | null>(null);
  const [dialog, setDialog] = useState<'adjust' | 'issue' | null>(null);
  const options = (items.data ?? [])
    .filter((i) => i.is_stock_tracked)
    .map((i) => ({ id: String(i.id), label: i.name, description: `${KIND_LABELS[i.kind]} · ${i.sku}`, searchText: `${i.sku} ${i.color_name ?? ''}` }));
  return (
    <Page className="max-w-2xl">
      <PageHeader
        back={
          <Link to="/estoque" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Estoque
          </Link>
        }
        title="Ajuste ou saída"
        description="Contagem, pesagem do carretel, perda, brinde, amostra ou uso pessoal."
      />
      <Card className="p-4">
        {item ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {item.kind === 'FILAMENT' ? <ColorDot hex={item.color_hex} className="size-6" /> : null}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.name}</p>
                <p className="text-sm text-muted">
                  Saldo <Qty value={item.qty_on_hand} unit={item.unit} />
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
                Trocar
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {can('write') ? (
                <Button size="lg" variant="outline" onClick={() => setDialog('adjust')}>
                  <Scale /> {item.kind === 'FILAMENT' ? 'Pesar / ajustar' : 'Ajustar pela contagem'}
                </Button>
              ) : null}
              <Button size="lg" variant="outline" onClick={() => setDialog('issue')}>
                <MinusCircle /> Saída avulsa
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setPickerOpen(true)}>Escolher o item</Button>
        )}
      </Card>
      <EntityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Qual item?"
        loading={!items.data}
        options={options}
        selectedId={item ? String(item.id) : null}
        onSelect={(option) => setItem(items.data?.find((i) => String(i.id) === option.id) ?? null)}
      />
      {item ? (
        <>
          <AdjustStockDialog key={`a${item.id}`} item={item} open={dialog === 'adjust'} onOpenChange={(o) => setDialog(o ? 'adjust' : null)} />
          <StockIssueDialog key={`i${item.id}`} item={item} open={dialog === 'issue'} onOpenChange={(o) => setDialog(o ? 'issue' : null)} />
        </>
      ) : null}
    </Page>
  );
}
