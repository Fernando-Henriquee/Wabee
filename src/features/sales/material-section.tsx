import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/money-input';
import type { ItemRow } from '@/data/inventory';
import { formatQty } from '@/lib/money';
import { emptyMaterialRow, type MaterialRow } from './material-rows';

export function MaterialSection({
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
        <Button variant="ghost" size="sm" onClick={() => onChange([...rows, emptyMaterialRow()])}>
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
