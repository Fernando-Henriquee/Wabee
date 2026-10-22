import { ArrowLeft, Wand2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ColorDot } from '@/components/shared/item-bits';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  type ItemInput,
  type ItemKind,
  type ItemRow,
  type ItemUnit,
  KIND_LABELS,
  type Material,
  MATERIAL_LABELS,
  suggestSku,
  TOOL_CONDITION_LABELS,
  TYPICAL_DENSITY,
  useItem,
  useSaveItem,
  useSuppliers,
} from '@/data/inventory';
import { describeError } from '@/lib/errors';

const KINDS: ItemKind[] = ['FILAMENT', 'COMPONENT', 'PACKAGING', 'CONSUMABLE', 'TOOL'];
const COLORS = ['#141414', '#f4f2ec', '#f5b800', '#d62828', '#f77f00', '#2a9d8f', '#1d4ed8', '#7c3aed', '#ec4899', '#6b7280', '#8b5e34', '#16a34a'];

interface FormState {
  kind: ItemKind;
  name: string;
  sku: string;
  unit: ItemUnit;
  is_stock_tracked: boolean;
  is_sellable: boolean;
  min_qty: string | null;
  reorder_qty: string | null;
  location: string;
  default_supplier_id: string;
  notes: string;
  material: Material;
  brand: string;
  color_name: string;
  color_hex: string;
  diameter_mm: string | null;
  density_g_cm3: string | null;
  nominal_spool_g: string | null;
  empty_spool_tare_g: string | null;
  needs_drying: boolean;
  tool_condition: string;
  tool_acquired_at: string;
  tool_acquisition_value: string | null;
}

function emptyState(kind: ItemKind): FormState {
  return {
    kind,
    name: '',
    sku: '',
    unit: kind === 'FILAMENT' ? 'G' : 'UN',
    is_stock_tracked: true,
    is_sellable: false,
    min_qty: null,
    reorder_qty: null,
    location: '',
    default_supplier_id: '',
    notes: '',
    material: 'PLA',
    brand: '',
    color_name: '',
    color_hex: '#141414',
    diameter_mm: '1.75',
    density_g_cm3: String(TYPICAL_DENSITY.PLA),
    nominal_spool_g: '1000',
    empty_spool_tare_g: null,
    needs_drying: false,
    tool_condition: 'BOA',
    tool_acquired_at: '',
    tool_acquisition_value: null,
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function stateFromItem(it: ItemRow): FormState {
  return {
    kind: it.kind,
    name: it.name,
    sku: it.sku,
    unit: it.unit,
    is_stock_tracked: it.is_stock_tracked,
    is_sellable: it.is_sellable,
    min_qty: String(it.min_qty ?? ''),
    reorder_qty: String(it.reorder_qty ?? ''),
    location: it.location ?? '',
    default_supplier_id: it.default_supplier_id ? String(it.default_supplier_id) : '',
    notes: it.notes ?? '',
    material: it.material ?? 'PLA',
    brand: it.brand ?? '',
    color_name: it.color_name ?? '',
    color_hex: it.color_hex ?? '#141414',
    diameter_mm: it.diameter_mm === null ? null : String(it.diameter_mm),
    density_g_cm3: it.density_g_cm3 === null ? null : String(it.density_g_cm3),
    nominal_spool_g: it.nominal_spool_g === null ? null : String(it.nominal_spool_g),
    empty_spool_tare_g: it.empty_spool_tare_g === null ? null : String(it.empty_spool_tare_g),
    needs_drying: Boolean(it.needs_drying),
    tool_condition: it.tool_condition ?? 'BOA',
    tool_acquired_at: it.tool_acquired_at ?? '',
    tool_acquisition_value: it.tool_acquisition_value === null ? null : String(it.tool_acquisition_value),
  };
}

export function ItemFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const item = useItem(id ? Number(id) : undefined);
  if (id && item.isError) return <Page><ErrorState error={item.error} /></Page>;
  if (id && !item.data) return <Page><LoadingBlock /></Page>;
  const initialKind = (params.get('tipo') as ItemKind | null) ?? 'FILAMENT';
  return <ItemForm key={id ?? 'new'} id={id} initial={item.data ? stateFromItem(item.data) : emptyState(KINDS.includes(initialKind) ? initialKind : 'FILAMENT')} />;
}

function ItemForm({ id, initial }: { id?: string; initial: FormState }) {
  const editing = Boolean(id);
  const navigate = useNavigate();
  const suppliers = useSuppliers();
  const [form, setForm] = useState<FormState>(initial);
  const [nameTouched, setNameTouched] = useState(editing);
  const [skuTouched, setSkuTouched] = useState(editing);
  const [suggestedSku, setSuggestedSku] = useState('');
  const [error, setError] = useState<{ message: string; existingId?: number } | null>(null);
  const save = useSaveItem((savedId) => navigate(`/estoque/itens/${savedId}`, { replace: true }));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Nome sugerido para filamento: "PLA preto — Marca X" (US-1.2), calculado até a pessoa editar.
  const suggestedName =
    form.kind === 'FILAMENT'
      ? [MATERIAL_LABELS[form.material], form.color_name.trim()].filter(Boolean).join(' ') + (form.brand.trim() ? ` — ${form.brand.trim()}` : '')
      : form.name;
  const name = nameTouched ? form.name : suggestedName;
  const sku = skuTouched ? form.sku : suggestedSku;

  // SKU sugerido pelo banco (<PREFIXO>-<ABREV>-<NNN>), editável antes de salvar.
  useEffect(() => {
    if (skuTouched || !name.trim()) return;
    const handle = setTimeout(() => {
      suggestSku(form.kind, name, form.material, form.color_name)
        .then(setSuggestedSku)
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(handle);
  }, [form.kind, name, form.material, form.color_name, skuTouched]);

  const filament = form.kind === 'FILAMENT';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError({ message: 'Informe o nome do item.' });
    if (filament && !form.color_name.trim()) return setError({ message: 'Informe a cor do filamento.' });
    const payload: ItemInput = {
      id: editing ? Number(id) : undefined,
      kind: form.kind,
      name: name.trim(),
      sku: sku.trim() || undefined,
      unit: form.unit,
      is_stock_tracked: form.is_stock_tracked,
      is_sellable: form.is_sellable,
      min_qty: form.min_qty,
      reorder_qty: form.reorder_qty,
      location: form.location.trim() || null,
      default_supplier_id: form.default_supplier_id ? Number(form.default_supplier_id) : null,
      notes: form.notes.trim() || null,
      filament: filament
        ? {
            material: form.material,
            brand: form.brand.trim(),
            color_name: form.color_name.trim(),
            color_hex: form.color_hex,
            diameter_mm: form.diameter_mm,
            density_g_cm3: form.density_g_cm3,
            nominal_spool_g: form.nominal_spool_g,
            empty_spool_tare_g: form.empty_spool_tare_g,
            needs_drying: form.needs_drying,
          }
        : undefined,
      tool: form.kind === 'TOOL' ? { condition: form.tool_condition, acquired_at: form.tool_acquired_at || null, acquisition_value: form.tool_acquisition_value } : undefined,
    };
    save.mutate(payload, {
      onError: (e) => {
        const hint = (e as { hint?: string }).hint ?? '';
        const existing = /^item:(\d+)$/.exec(hint);
        setError({ message: describeError(e), existingId: existing ? Number(existing[1]) : undefined });
      },
    });
  };

  return (
    <Page className="max-w-3xl">
      <PageHeader
        back={
          <Link to={editing ? `/estoque/itens/${id}` : '/estoque'} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {editing ? 'Voltar ao item' : 'Estoque'}
          </Link>
        }
        title={editing ? `Editar ${KIND_LABELS[form.kind].toLowerCase()}` : 'Novo item'}
        description="Produtos prontos não são cadastrados aqui: eles nascem da variação do produto."
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Section title="Identificação">
          <Field label="Tipo" required hint={editing ? 'O tipo não muda depois de haver movimentações.' : undefined}>
            <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...emptyState(e.target.value as ItemKind), name: nameTouched ? f.name : '' }))} disabled={editing}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          {form.kind === 'CONSUMABLE' ? (
            <Field label="Unidade">
              <Select value={form.unit} onChange={(e) => set('unit', e.target.value as ItemUnit)} disabled={editing}>
                <option value="UN">Unidade</option>
                <option value="ML">Mililitro (ml)</option>
                <option value="G">Grama (g)</option>
                <option value="M">Metro (m)</option>
              </Select>
            </Field>
          ) : (
            <div />
          )}
          {filament ? (
            <>
              <Field label="Material" required>
                <Select
                  value={form.material}
                  onChange={(e) => {
                    const material = e.target.value as Material;
                    setForm((f) => ({ ...f, material, density_g_cm3: String(TYPICAL_DENSITY[material]) }));
                  }}
                >
                  {(Object.keys(MATERIAL_LABELS) as Material[]).map((m) => (
                    <option key={m} value={m}>
                      {MATERIAL_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Marca">
                <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} />
              </Field>
              <Field label="Cor" required>
                <Input value={form.color_name} onChange={(e) => set('color_name', e.target.value)} placeholder="preto, amarelo…" />
              </Field>
              <Field label="Cor na interface" hint="Bolinha de cor que aparece em todas as listas.">
                <div className="flex flex-wrap items-center gap-1.5">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set('color_hex', c)}
                      aria-label={`Cor ${c}`}
                      aria-pressed={form.color_hex.toLowerCase() === c}
                      className={`grid size-7 place-items-center rounded-full ${form.color_hex.toLowerCase() === c ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                    >
                      <ColorDot hex={c} className="size-6" />
                    </button>
                  ))}
                  <input type="color" value={form.color_hex} onChange={(e) => set('color_hex', e.target.value)} aria-label="Outra cor" className="size-7 cursor-pointer rounded-full border border-line" />
                </div>
              </Field>
            </>
          ) : null}
          <Field label="Nome" required className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                set('name', e.target.value);
              }}
            />
          </Field>
          <Field label="SKU" hint="Gerado automaticamente; pode ser editado antes de salvar.">
            <div className="flex gap-2">
              <Input
                value={sku}
                onChange={(e) => {
                  setSkuTouched(true);
                  set('sku', e.target.value.toUpperCase());
                }}
                className="font-mono"
              />
              {skuTouched && !editing ? (
                <Button type="button" variant="ghost" size="icon" aria-label="Sugerir de novo" onClick={() => setSkuTouched(false)}>
                  <Wand2 />
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Local" hint='Ex.: "Gaveta 2", "Caixa seca"'>
            <Input value={form.location} onChange={(e) => set('location', e.target.value)} />
          </Field>
        </Section>

        {filament ? (
          <Section title="Ficha do filamento" description="A densidade e o diâmetro convertem metros em gramas; a tara corrige o saldo na pesagem.">
            <Field label="Diâmetro (mm)">
              <DecimalInput decimals={2} value={form.diameter_mm} onValueChange={(v) => set('diameter_mm', v)} />
            </Field>
            <Field label="Densidade (g/cm³)" hint="Preenchida pelo material; ajuste se souber o valor da marca.">
              <DecimalInput decimals={3} value={form.density_g_cm3} onValueChange={(v) => set('density_g_cm3', v)} />
            </Field>
            <Field label="Carretel nominal (g)">
              <DecimalInput decimals={0} value={form.nominal_spool_g} onValueChange={(v) => set('nominal_spool_g', v)} />
            </Field>
            <Field label="Peso do carretel vazio (g)" hint="Pese um carretel vazio da marca uma vez.">
              <DecimalInput decimals={0} value={form.empty_spool_tare_g} onValueChange={(v) => set('empty_spool_tare_g', v)} />
            </Field>
            <label className="inline-flex items-center gap-2 text-sm text-ink-soft sm:col-span-2">
              <Checkbox checked={form.needs_drying} onChange={(e) => set('needs_drying', e.target.checked)} /> Precisa secar antes de imprimir (alerta no planejamento)
            </label>
          </Section>
        ) : null}

        {form.kind === 'TOOL' ? (
          <Section title="Ferramenta" description="O valor é informativo e nunca entra no custo das peças.">
            <Field label="Condição">
              <Select value={form.tool_condition} onChange={(e) => set('tool_condition', e.target.value)}>
                {Object.entries(TOOL_CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Comprada em">
              <Input type="date" value={form.tool_acquired_at} onChange={(e) => set('tool_acquired_at', e.target.value)} />
            </Field>
            <Field label="Valor de aquisição">
              <MoneyInput value={form.tool_acquisition_value} onValueChange={(v) => set('tool_acquisition_value', v)} />
            </Field>
          </Section>
        ) : null}

        <Section title="Reposição" description="Abaixo do mínimo, o item aparece nos alertas com a quantidade sugerida de recompra.">
          <Field label={`Estoque mínimo (${form.unit.toLowerCase()})`}>
            <DecimalInput decimals={3} value={form.min_qty} onValueChange={(v) => set('min_qty', v)} />
          </Field>
          <Field label={`Recompra sugerida (${form.unit.toLowerCase()})`}>
            <DecimalInput decimals={3} value={form.reorder_qty} onValueChange={(v) => set('reorder_qty', v)} />
          </Field>
          <Field label="Fornecedor padrão">
            <Select value={form.default_supplier_id} onChange={(e) => set('default_supplier_id', e.target.value)}>
              <option value="">—</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col justify-end gap-2">
            {form.kind === 'CONSUMABLE' ? (
              <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
                <Checkbox checked={!form.is_stock_tracked} onChange={(e) => set('is_stock_tracked', !e.target.checked)} disabled={editing} /> Não controlar saldo (vira despesa na compra)
              </label>
            ) : null}
            {form.kind === 'COMPONENT' ? (
              <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
                <Checkbox checked={form.is_sellable} onChange={(e) => set('is_sellable', e.target.checked)} /> Pode ser vendido avulso
              </label>
            ) : null}
          </div>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />
          </Field>
        </Section>

        {error ? (
          <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error.message}{' '}
            {error.existingId ? (
              <Link to={`/estoque/itens/${error.existingId}`} className="font-semibold underline">
                Abrir o existente
              </Link>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Salvar alterações' : 'Cadastrar item'}
          </Button>
        </div>
      </form>
    </Page>
  );
}
