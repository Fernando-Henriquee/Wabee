import { useState } from 'react';
import { ColorDot } from '@/components/shared/item-bits';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { type ItemInput, type ItemKind, type ItemUnit, KIND_LABELS, type Material, MATERIAL_LABELS, useSaveItem } from '@/data/inventory';
import { describeError } from '@/lib/errors';
import { SPOOL_SIZES, spoolLabel } from './purchase-logic';

const KINDS: ItemKind[] = ['FILAMENT', 'COMPONENT', 'PACKAGING', 'CONSUMABLE', 'TOOL'];
const COLORS = ['#141414', '#f4f2ec', '#f5b800', '#d62828', '#f77f00', '#2a9d8f', '#1d4ed8', '#7c3aed', '#ec4899', '#6b7280', '#8b5e34', '#16a34a'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  initialKind?: ItemKind;
  /** Item criado (ou o existente, quando já havia um filamento igual), com o tipo e o carretel nominal. */
  onSaved: (itemId: number, info: { kind: ItemKind; nominal: number | null }) => void;
}

/**
 * Cadastro rápido de item sem sair da compra (US-3.2): tipo e nome; filamento com material,
 * marca e cor. O resto do cadastro (mínimo, tara, local) pode ser completado depois no estoque.
 */
export function QuickItemDialog({ open, onOpenChange, initialName = '', initialKind = 'FILAMENT', onSaved }: Props) {
  const [kind, setKind] = useState<ItemKind>(initialKind);
  const [name, setName] = useState(initialName);
  const [nameTouched, setNameTouched] = useState(initialName.trim() !== '');
  const [material, setMaterial] = useState<Material>('PLA');
  const [brand, setBrand] = useState('');
  const [colorName, setColorName] = useState('');
  const [colorHex, setColorHex] = useState('#141414');
  const [spool, setSpool] = useState('1000');
  const [unit, setUnit] = useState<ItemUnit>('UN');
  const [untracked, setUntracked] = useState(false);
  const [error, setError] = useState<{ message: string; existingId?: number } | null>(null);
  const save = useSaveItem();
  const filament = kind === 'FILAMENT';
  const suggested = [MATERIAL_LABELS[material], colorName.trim()].filter(Boolean).join(' ') + (brand.trim() ? ` — ${brand.trim()}` : '');
  const effectiveName = filament && !nameTouched ? suggested : name;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!effectiveName.trim()) return setError({ message: 'Informe o nome do item.' });
    if (filament && !colorName.trim()) return setError({ message: 'Informe a cor do filamento.' });
    const payload: ItemInput = {
      kind,
      name: effectiveName.trim(),
      unit: kind === 'CONSUMABLE' ? unit : undefined,
      is_stock_tracked: kind === 'CONSUMABLE' ? !untracked : undefined,
      filament: filament ? { material, brand: brand.trim(), color_name: colorName.trim(), color_hex: colorHex, nominal_spool_g: spool } : undefined,
    };
    save.mutate(payload, {
      onSuccess: (id) => {
        onSaved(id, { kind, nominal: filament ? Number(spool) : null });
        onOpenChange(false);
      },
      onError: (e) => {
        const hint = (e as { hint?: string }).hint ?? '';
        const existing = /^item:(\d+)$/.exec(hint);
        setError({ message: describeError(e), existingId: existing ? Number(existing[1]) : undefined });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Cadastrar item"
        description="Cadastro rápido, sem sair da compra. Complete os detalhes depois em Estoque."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="quick-item-form" loading={save.isPending}>
              Cadastrar e usar
            </Button>
          </>
        }
      >
        <form id="quick-item-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tipo" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          {filament ? (
            <Field label="Material" required>
              <Select value={material} onChange={(e) => setMaterial(e.target.value as Material)}>
                {(Object.keys(MATERIAL_LABELS) as Material[]).map((m) => (
                  <option key={m} value={m}>
                    {MATERIAL_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : kind === 'CONSUMABLE' ? (
            <Field label="Unidade">
              <Select value={unit} onChange={(e) => setUnit(e.target.value as ItemUnit)}>
                <option value="UN">Unidade</option>
                <option value="ML">Mililitro (ml)</option>
                <option value="G">Grama (g)</option>
                <option value="M">Metro (m)</option>
              </Select>
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          {filament ? (
            <>
              <Field label="Cor" required>
                <Input value={colorName} onChange={(e) => setColorName(e.target.value)} placeholder="preto, amarelo…" />
              </Field>
              <Field label="Marca">
                <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
              </Field>
              <Field label="Cor na interface" className="sm:col-span-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColorHex(c)}
                      aria-label={`Cor ${c}`}
                      aria-pressed={colorHex.toLowerCase() === c}
                      className={`grid size-8 place-items-center rounded-full ${colorHex.toLowerCase() === c ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                    >
                      <ColorDot hex={c} className="size-6" />
                    </button>
                  ))}
                  <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} aria-label="Outra cor" className="size-8 cursor-pointer rounded-full border border-line" />
                </div>
              </Field>
              <Field label="Carretel nominal">
                <Select value={spool} onChange={(e) => setSpool(e.target.value)}>
                  {SPOOL_SIZES.map((g) => (
                    <option key={g} value={g}>
                      {spoolLabel(g)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <Field label="Nome" required className={filament ? '' : 'sm:col-span-2'} hint={filament && !nameTouched ? 'Sugerido pelo material, cor e marca.' : undefined}>
            <Input
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              maxLength={120}
            />
          </Field>
          {kind === 'CONSUMABLE' ? (
            <label className="inline-flex min-h-10 items-center gap-2 text-sm text-ink-soft sm:col-span-2">
              <Checkbox checked={untracked} onChange={(e) => setUntracked(e.target.checked)} /> Não controlar saldo (vira despesa na compra)
            </label>
          ) : null}
          {kind === 'TOOL' ? <p className="text-xs text-muted sm:col-span-2">Ferramentas pequenas viram despesa na data da compra e entram no estoque sem valor.</p> : null}
          {error ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">
              <span className="flex-1">{error.message}</span>
              {error.existingId ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-10 sm:h-8"
                  variant="danger-outline"
                  onClick={() => {
                    onSaved(error.existingId!, { kind: 'FILAMENT', nominal: null });
                    onOpenChange(false);
                  }}
                >
                  Usar o existente
                </Button>
              ) : null}
            </div>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
