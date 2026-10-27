import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { type ItemRow, useItems } from '@/data/inventory';
import { useEquipmentOptions } from '@/data/products';
import { type CustomItemInput, useCreateCustomItem, usePreviewCustomItem } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { useDebounced } from '@/features/production/use-now';
import { CostBreakdown, DurationInput } from '@/features/products/bits';
import { describeError } from '@/lib/errors';
import { formatBRL, formatQty, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';

/** Linha do pedido gerada pelo item pontual. */
export interface CustomItemAdded {
  variantId: number;
  itemId: number;
  name: string;
  unitCost: number;
  qty: string;
  price: string | null;
}

interface MaterialRow {
  uid: string;
  itemId: number | null;
  qty: string | null;
}

const uid = () => crypto.randomUUID();
const emptyRow = (): MaterialRow => ({ uid: uid(), itemId: null, qty: null });

/**
 * Item pontual de encomenda (US-4.9): ficha simplificada (filamentos, tempo, componentes)
 * só para calcular custo e preço e mandar para a produção. Não entra no catálogo de produtos,
 * a menos que o dono marque "salvar no catálogo".
 */
export function CustomItemDialog({ open, onOpenChange, channelId, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; channelId: number | null; onAdded: (line: CustomItemAdded) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <CustomItemForm channelId={channelId} onClose={() => onOpenChange(false)} onAdded={onAdded} /> : null}
    </Dialog>
  );
}

function CustomItemForm({ channelId, onClose, onAdded }: { channelId: number | null; onClose: () => void; onAdded: (line: CustomItemAdded) => void }) {
  const { can } = useMember();
  const showCosts = can('costs');
  const filaments = useItems({ kind: 'FILAMENT' });
  const components = useItems({ kind: 'COMPONENT' });
  const equipment = useEquipmentOptions();
  const [requestId, renew] = useRequestId();
  const [name, setName] = useState('');
  const [filamentRows, setFilamentRows] = useState<MaterialRow[]>(() => [emptyRow()]);
  const [componentRows, setComponentRows] = useState<MaterialRow[]>([]);
  const [minutes, setMinutes] = useState(0);
  const [unitsPerPlate, setUnitsPerPlate] = useState<string | null>('1');
  const [equipmentId, setEquipmentId] = useState<number | null>(null);
  const [qty, setQty] = useState<string | null>('1');
  const [price, setPrice] = useState<string | null>(null);
  const [saveToCatalog, setSaveToCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = [...filamentRows, ...componentRows]
    .filter((r) => r.itemId && toNumber(r.qty) > 0)
    .map((r) => ({ item_id: r.itemId!, qty_per_unit: r.qty! }));
  const input: CustomItemInput = {
    name: name.trim(),
    channel_id: channelId,
    units_per_plate: Math.max(1, Math.floor(toNumber(unitsPerPlate)) || 1),
    est_print_minutes_per_plate: minutes > 0 ? minutes : null,
    default_equipment_id: equipmentId,
    unit_price: price,
    save_to_catalog: saveToCatalog,
    lines,
  };
  // A prévia depende só dos números da ficha; a chave em texto evita recalcular a cada render.
  const previewKey = useDebounced(
    showCosts && lines.length > 0
      ? JSON.stringify({ lines, units_per_plate: input.units_per_plate, est_print_minutes_per_plate: input.est_print_minutes_per_plate, default_equipment_id: equipmentId, channel_id: channelId })
      : '',
  );
  const previewInput = useMemo(() => (previewKey ? ({ name: 'Item pontual', ...JSON.parse(previewKey) } as CustomItemInput) : null), [previewKey]);
  const preview = usePreviewCustomItem(previewInput);
  const suggested = preview.data?.suggested_price ?? null;

  const create = useCreateCustomItem((r) => {
    renew();
    onAdded({ variantId: r.variant_id, itemId: r.item_id, name: input.name, unitCost: toNumber(r.unit_cost), qty: qty ?? '1', price: price ?? (suggested === null ? null : String(suggested)) });
    onClose();
  });

  const submit = () => {
    setError(null);
    if (!input.name) return setError('Informe o nome do item.');
    if (!filamentRows.some((r) => r.itemId && toNumber(r.qty) > 0)) return setError('Informe ao menos um filamento com os gramas por peça.');
    if (minutes <= 0) return setError('Informe o tempo de impressão da mesa.');
    if (toNumber(qty) <= 0) return setError('Informe a quantidade do pedido.');
    create.mutate({ requestId, item: { ...input, unit_price: price ?? (suggested === null ? null : String(suggested)) } }, { onError: (e) => setError(describeError(e)) });
  };

  return (
    <DialogContent
      title="Item pontual"
      description="Encomenda que não vira produto do catálogo. A ficha simplificada calcula o custo e o preço sugerido e é usada na produção."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            <Plus /> Adicionar ao pedido
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Nome" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Troféu personalizado da escola" autoFocus />
        </Field>

        <MaterialSection
          title="Filamentos (gramas por peça)"
          addLabel="Filamento"
          rows={filamentRows}
          onChange={setFilamentRows}
          items={filaments.data}
          unit="g"
          emptyHint="Cadastre filamentos em Estoque → Novo item."
        />
        <MaterialSection title="Componentes por peça (opcional)" addLabel="Componente" rows={componentRows} onChange={setComponentRows} items={components.data} unit="un" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Tempo de impressão da mesa" required className="sm:col-span-2">
            <DurationInput value={minutes} onChange={setMinutes} />
          </Field>
          <Field label="Peças por mesa">
            <DecimalInput decimals={0} value={unitsPerPlate} onValueChange={setUnitsPerPlate} />
          </Field>
          <Field label="Impressora" hint="Define a taxa de custo por hora. Em branco: a primeira impressora ativa." className="sm:col-span-3">
            <Select value={equipmentId ?? ''} onChange={(e) => setEquipmentId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Padrão</option>
              {(equipment.data ?? [])
                .filter((e) => e.kind === 'PRINTER' && e.status !== 'BAIXADO')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        {showCosts ? (
          <section className="space-y-2 rounded-xl border border-line p-3" aria-label="Custo estimado">
            <h3 className="text-sm font-semibold">Custo por peça</h3>
            <CostBreakdown estimate={preview.data?.estimate} loading={preview.isFetching} unitsPerPlate={input.units_per_plate} />
            {suggested !== null ? (
              <p className="text-sm">
                Preço sugerido: <Money value={suggested} className="font-semibold" />{' '}
                <span className="text-xs text-muted">(margem alvo {Math.round(toNumber(preview.data?.margin_target_pct) * 100)}% depois das taxas do canal)</span>
              </p>
            ) : preview.data ? (
              <p className="text-xs text-warning">Margem alvo impossível com as taxas deste canal.</p>
            ) : null}
          </section>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantidade" required>
            <DecimalInput decimals={0} value={qty} onValueChange={setQty} />
          </Field>
          <Field label="Preço unitário" hint={price === null && suggested !== null ? `Em branco usa o sugerido (${formatBRL(suggested)}).` : undefined}>
            <MoneyInput value={price} onValueChange={setPrice} placeholder={suggested !== null ? formatBRL(suggested) : 'Preço'} />
          </Field>
        </div>

        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <Checkbox checked={saveToCatalog} onChange={(e) => setSaveToCatalog(e.target.checked)} className="mt-0.5" />
          <span>
            Salvar também no catálogo de produtos
            <span className="block text-xs text-muted">Deixe desmarcado para encomenda pontual: o item não aparece em Produtos nem na venda rápida.</span>
          </span>
        </label>

        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </DialogContent>
  );
}

function MaterialSection({
  title,
  addLabel,
  rows,
  onChange,
  items,
  unit,
  emptyHint,
}: {
  title: string;
  addLabel: string;
  rows: MaterialRow[];
  onChange: (rows: MaterialRow[]) => void;
  items: ItemRow[] | undefined;
  unit: 'g' | 'un';
  emptyHint?: string;
}) {
  const update = (rowUid: string, patch: Partial<MaterialRow>) => onChange(rows.map((r) => (r.uid === rowUid ? { ...r, ...patch } : r)));
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink-soft">{title}</h3>
        <Button variant="ghost" size="sm" onClick={() => onChange([...rows, emptyRow()])}>
          <Plus /> {addLabel}
        </Button>
      </div>
      {items && items.length === 0 && emptyHint ? <p className="text-xs text-warning">{emptyHint}</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.uid} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2">
            <Field label={addLabel}>
              <Select value={row.itemId ?? ''} onChange={(e) => update(row.uid, { itemId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Escolha…</option>
                {(items ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · saldo {formatQty(i.qty_on_hand, i.unit)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={unit === 'g' ? 'Gramas' : 'Qtd.'}>
              <DecimalInput decimals={unit === 'g' ? 3 : 0} suffix={unit} value={row.qty} onValueChange={(v) => update(row.uid, { qty: v })} />
            </Field>
            <Button variant="ghost" size="icon-sm" aria-label={`Remover ${addLabel.toLowerCase()}`} className="mb-1" onClick={() => onChange(rows.filter((r) => r.uid !== row.uid))}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
