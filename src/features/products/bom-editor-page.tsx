import { ArrowLeft, CheckCircle2, Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { EntityPicker } from '@/components/shared/entity-picker';
import { ColorDot } from '@/components/shared/item-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput, PercentInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type ItemRow, useItems } from '@/data/inventory';
import {
  BOM_STATUS_LABELS,
  type BomInput,
  type BomLine,
  type BomLineKind,
  type BomVersion,
  type ConsumedAt,
  CONSUMED_AT_LABELS,
  defaultLineFor,
  LINE_KIND_LABELS,
  useActivateBom,
  useBomLines,
  useBomVersion,
  useCopyBom,
  useDiscardBomDraft,
  useEquipmentOptions,
  usePreviewBomCost,
  useSaveBomDraft,
  useVariants,
  type VariantRow,
} from '@/data/products';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatQty, toNumber, unitLabel } from '@/lib/money';
import { CostBreakdown, DurationInput, UnitCost } from './bits';

interface LineDraft {
  key: string;
  item_id: number;
  item_name: string;
  item_kind: string;
  unit: string;
  color_hex: string | null;
  line_kind: BomLineKind;
  qty_per_unit: string | null;
  waste_pct: string | null;
  consumed_at: ConsumedAt;
}

interface EditorState {
  units_per_plate: number;
  minutes: number;
  post_minutes: number;
  equipment_id: string;
  notes: string;
  lines: LineDraft[];
}

type Group = 'filament' | 'component' | 'packaging';

const GROUPS: Array<{ key: Group; title: string; description: string; kinds: string[]; add: string }> = [
  { key: 'filament', title: 'Filamentos', description: 'Gramas da mesa no fatiador (peça, suporte e purga). O sistema divide pelas peças da mesa.', kinds: ['FILAMENT'], add: 'Adicionar filamento' },
  { key: 'component', title: 'Componentes e consumíveis', description: 'Argolas, ímãs, cola… por unidade. Componente na montagem manda a peça para o acabamento.', kinds: ['COMPONENT', 'CONSUMABLE'], add: 'Adicionar componente' },
  { key: 'packaging', title: 'Embalagem', description: 'Baixada na entrega da venda; entra na margem, não no custo de produção.', kinds: ['PACKAGING'], add: 'Adicionar embalagem' },
];

const groupOf = (kind: string): Group => (kind === 'FILAMENT' ? 'filament' : kind === 'PACKAGING' ? 'packaging' : 'component');

let lineKey = 0;
const nextKey = () => `l${++lineKey}`;

function fromBom(bom: BomVersion, lines: BomLine[]): EditorState {
  return {
    units_per_plate: bom.units_per_plate,
    minutes: bom.est_print_minutes_per_plate,
    post_minutes: bom.est_post_process_minutes_per_unit,
    equipment_id: bom.default_equipment_id ? String(bom.default_equipment_id) : '',
    notes: bom.notes ?? '',
    lines: lines.map((l) => ({
      key: nextKey(),
      item_id: l.item_id,
      item_name: l.item_name,
      item_kind: l.item_kind,
      unit: l.unit,
      color_hex: l.color_hex,
      line_kind: l.line_kind,
      qty_per_unit: String(l.qty_per_unit),
      waste_pct: toNumber(l.waste_pct) > 0 ? String(l.waste_pct) : null,
      consumed_at: l.consumed_at,
    })),
  };
}

const EMPTY: EditorState = { units_per_plate: 1, minutes: 0, post_minutes: 0, equipment_id: '', notes: '', lines: [] };

export function BomEditorPage() {
  const { id, bomId } = useParams();
  const [params] = useSearchParams();
  const productId = Number(id);
  const existingId = bomId && bomId !== 'nova' ? Number(bomId) : undefined;
  const variants = useVariants({ productId });
  const bom = useBomVersion(existingId);
  const lines = useBomLines(existingId);

  if (variants.isError || bom.isError || lines.isError) return <Page><ErrorState error={variants.error ?? bom.error ?? lines.error} /></Page>;
  if (!variants.data || (existingId && (bom.data === undefined || !lines.data))) return <Page><LoadingBlock /></Page>;
  if (existingId && !bom.data) return <Page><EmptyState title="Ficha não encontrada" /></Page>;
  const variantId = bom.data?.variant_id ?? Number(params.get('variacao'));
  const variant = variants.data.find((v) => v.id === variantId);
  if (!variant) return <Page><EmptyState title="Variação não encontrada" action={<Button asChild variant="outline"><Link to={`/produtos/${productId}`}>Voltar ao produto</Link></Button>} /></Page>;
  if (!existingId && variant.draft_bom_id) {
    return (
      <Page>
        <EmptyState
          title="Já existe um rascunho"
          description="Esta variação já tem uma ficha em rascunho. Continue por ela."
          action={
            <Button asChild>
              <Link to={`/produtos/${productId}/fichas/${variant.draft_bom_id}`}>Abrir rascunho</Link>
            </Button>
          }
        />
      </Page>
    );
  }
  return <BomEditor key={existingId ?? 'new'} variant={variant} bom={bom.data ?? null} initial={bom.data && lines.data ? fromBom(bom.data, lines.data) : EMPTY} />;
}

/** Valor com atraso curto, para recalcular o custo sem chamar o banco a cada tecla. */
function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function toPayload(state: EditorState): Omit<BomInput, 'variant_id' | 'id'> {
  return {
    units_per_plate: Math.max(1, state.units_per_plate || 1),
    est_print_minutes_per_plate: state.minutes,
    est_post_process_minutes_per_unit: state.post_minutes,
    default_equipment_id: state.equipment_id ? Number(state.equipment_id) : null,
    notes: state.notes.trim() || null,
    lines: state.lines
      .filter((l) => toNumber(l.qty_per_unit) > 0)
      .map((l) => ({ item_id: l.item_id, line_kind: l.line_kind, qty_per_unit: l.qty_per_unit!, waste_pct: l.waste_pct ?? '0', consumed_at: l.consumed_at })),
  };
}

function BomEditor({ variant, bom, initial }: { variant: VariantRow; bom: BomVersion | null; initial: EditorState }) {
  const { can } = useMember();
  const navigate = useNavigate();
  const editable = can('write') && (!bom || bom.status === 'RASCUNHO');
  const [state, setState] = useState<EditorState>(initial);
  const [picking, setPicking] = useState<Group | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useItems();
  const equipment = useEquipmentOptions();
  const payload = useMemo(() => toPayload(state), [state]);
  const debounced = useDebounced(payload);
  const preview = usePreviewBomCost(debounced, can('costs'));
  const productHref = `/produtos/${variant.product_id}?variacao=${variant.id}`;

  const save = useSaveBomDraft((savedId) => {
    if (!bom) navigate(`/produtos/${variant.product_id}/fichas/${savedId}`, { replace: true });
  });
  const activate = useActivateBom(() => navigate(productHref, { replace: true }));
  const discard = useDiscardBomDraft(() => navigate(productHref, { replace: true }));
  const newVersion = useCopyBom((newId) => navigate(`/produtos/${variant.product_id}/fichas/${newId}`));

  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) => setState((s) => ({ ...s, [key]: value }));
  const setLine = (key: string, patch: Partial<LineDraft>) => setState((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key: string) => setState((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));
  const addItem = (item: ItemRow) => {
    const defaults = defaultLineFor(item.kind);
    setState((s) => ({
      ...s,
      lines: [
        ...s.lines,
        { key: nextKey(), item_id: item.id, item_name: item.name, item_kind: item.kind, unit: item.unit, color_hex: item.color_hex, line_kind: defaults.line_kind, consumed_at: defaults.consumed_at, qty_per_unit: item.kind === 'FILAMENT' ? null : '1', waste_pct: null },
      ],
    }));
  };

  // Custo de cada linha vem da prévia, na mesma ordem das linhas válidas.
  const lineCost = useMemo(() => {
    const map = new Map<string, number>();
    const valid = state.lines.filter((l) => toNumber(l.qty_per_unit) > 0);
    valid.forEach((l, index) => {
      const cost = preview.data?.lines[index];
      if (cost && cost.item_id === l.item_id) map.set(l.key, toNumber(cost.cost));
    });
    return map;
  }, [state.lines, preview.data]);

  const validate = (forActivation: boolean): string | null => {
    if (state.units_per_plate < 1) return 'Informe quantas peças saem por mesa.';
    if (state.lines.some((l) => toNumber(l.qty_per_unit) <= 0)) return 'Há linhas sem quantidade. Preencha ou remova.';
    if (forActivation && !state.lines.some((l) => l.line_kind.startsWith('FILAMENT'))) return 'A ficha precisa de ao menos um filamento para ser ativada.';
    if (forActivation && state.minutes <= 0) return 'Informe o tempo de impressão da mesa (está no fatiador).';
    return null;
  };

  const run = (mode: 'save' | 'activate') => {
    setError(null);
    const problem = validate(mode === 'activate');
    if (problem) return setError(problem);
    const input: BomInput = { ...payload, id: bom?.id ?? null, variant_id: variant.id };
    const onError = (e: Error) => setError(describeError(e));
    if (mode === 'save') save.mutate(input, { onError });
    else activate.mutate(input, { onError });
  };

  const printers = (equipment.data ?? []).filter((e) => e.kind === 'PRINTER' && e.status !== 'BAIXADO');
  const pickerGroup = GROUPS.find((g) => g.key === picking);
  const usedIds = new Set(state.lines.filter((l) => groupOf(l.item_kind) === picking).map((l) => l.item_id));

  return (
    <Page>
      <PageHeader
        back={
          <Link to={productHref} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {variant.full_name}
          </Link>
        }
        title={bom ? `Ficha técnica · versão ${bom.version}` : 'Nova ficha técnica'}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {variant.full_name} · {variant.sku}
            {bom ? <Badge tone={bom.status === 'ATIVA' ? 'success' : bom.status === 'RASCUNHO' ? 'accent' : 'neutral'}>{BOM_STATUS_LABELS[bom.status]}</Badge> : <Badge tone="accent">Rascunho</Badge>}
          </span>
        }
      />

      {bom && bom.status !== 'RASCUNHO' ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-subtle px-4 py-3 text-sm">
          <p className="text-ink-soft">
            {bom.status === 'ATIVA' ? 'Esta é a versão ativa.' : 'Versão arquivada.'} Fichas usadas não mudam: para alterar, crie uma nova versão (as impressões antigas mantêm o custo da época).
          </p>
          {can('write') ? (
            variant.draft_bom_id ? (
              <Button asChild size="sm">
                <Link to={`/produtos/${variant.product_id}/fichas/${variant.draft_bom_id}`}>Abrir o rascunho existente</Link>
              </Button>
            ) : (
              <Button size="sm" loading={newVersion.isPending} onClick={() => newVersion.mutate({ bomId: bom.id })}>
                <Copy /> Nova versão a partir desta
              </Button>
            )
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Mesa de impressão" description="Valores do fatiador para a mesa cheia." />
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              <Field label="Peças por mesa" required>
                <Input
                  inputMode="numeric"
                  className="num w-28 text-right"
                  value={state.units_per_plate || ''}
                  disabled={!editable}
                  onChange={(e) => set('units_per_plate', Math.min(999, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)))}
                />
              </Field>
              <Field label="Tempo de impressão da mesa" required>
                <DurationInput value={state.minutes} disabled={!editable} onChange={(m) => set('minutes', m)} />
              </Field>
              <Field label="Acabamento por peça" hint="Lixar, pintar, montar. Zero = vai direto ao estoque ao finalizar.">
                <DurationInput value={state.post_minutes} disabled={!editable} onChange={(m) => set('post_minutes', m)} />
              </Field>
              <Field label="Impressora padrão">
                <Select value={state.equipment_id} disabled={!editable} onChange={(e) => set('equipment_id', e.target.value)}>
                  <option value="">Qualquer impressora</option>
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          {GROUPS.map((group) => {
            const groupLines = state.lines.filter((l) => groupOf(l.item_kind) === group.key);
            return (
              <Card key={group.key}>
                <CardHeader
                  title={group.title}
                  description={group.description}
                  actions={
                    editable ? (
                      <Button size="sm" variant="outline" onClick={() => setPicking(group.key)}>
                        <Plus /> {group.add}
                      </Button>
                    ) : undefined
                  }
                />
                {groupLines.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted">{group.key === 'filament' ? 'Nenhum filamento ainda.' : 'Nenhum.'}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {groupLines.map((line) => (
                      <LineRow
                        key={line.key}
                        line={line}
                        unitsPerPlate={state.units_per_plate || 1}
                        editable={editable}
                        cost={can('costs') ? lineCost.get(line.key) : undefined}
                        onChange={(patch) => setLine(line.key, patch)}
                        onRemove={() => removeLine(line.key)}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}

          <Card>
            <div className="p-4">
              <Field label="Observações" hint="Configuração do fatiador, perfil de impressão, cuidados.">
                <Textarea value={state.notes} disabled={!editable} onChange={(e) => set('notes', e.target.value)} maxLength={1000} className="min-h-16" />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:h-fit">
          {can('costs') ? (
            <Card>
              <CardHeader title="Custo estimado por unidade" description="Recalcula enquanto você edita." />
              <div className="p-4">{preview.isError ? <ErrorState error={preview.error} /> : <CostBreakdown estimate={preview.data} loading={preview.isFetching} unitsPerPlate={state.units_per_plate} />}</div>
            </Card>
          ) : null}
          {editable ? (
            <Card className="space-y-3 p-4">
              {error ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <Button className="w-full" size="lg" loading={activate.isPending} onClick={() => run('activate')}>
                <CheckCircle2 /> Ativar ficha
              </Button>
              <Button className="w-full" variant="outline" loading={save.isPending} onClick={() => run('save')}>
                Salvar rascunho
              </Button>
              {bom ? (
                <Button className="w-full" variant="ghost" onClick={() => setDiscarding(true)}>
                  <Trash2 /> Descartar rascunho
                </Button>
              ) : null}
              <p className="text-xs text-muted">Ao ativar, a versão anterior vai para o histórico. Próximas impressões e estimativas passam a usar esta.</p>
            </Card>
          ) : null}
        </div>
      </div>

      {pickerGroup ? (
        <EntityPicker
          open
          onOpenChange={(open) => !open && setPicking(null)}
          title={pickerGroup.add}
          loading={!items.data}
          options={(items.data ?? [])
            .filter((i) => pickerGroup.kinds.includes(i.kind) && !usedIds.has(i.id))
            .map((i) => ({ id: String(i.id), label: i.name, description: `${i.sku} · saldo ${formatQty(i.qty_on_hand, i.unit)}`, searchText: `${i.sku} ${i.color_name ?? ''}` }))}
          onSelect={(option) => {
            const item = items.data?.find((i) => String(i.id) === option.id);
            if (item) addItem(item);
          }}
          emptyText="Nenhum item. Cadastre em Estoque → Novo item."
        />
      ) : null}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Descartar este rascunho?"
        description="As alterações desta versão são apagadas. A versão ativa (se houver) continua valendo."
        confirmLabel="Descartar"
        onConfirm={() => (bom ? discard.mutateAsync(bom.id) : undefined)}
      />
    </Page>
  );
}

function LineRow({
  line,
  unitsPerPlate,
  editable,
  cost,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  unitsPerPlate: number;
  editable: boolean;
  cost: number | undefined;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  const filament = line.item_kind === 'FILAMENT';
  const unit = unitLabel(line.unit);
  const perPlate = line.qty_per_unit === null ? null : String(Math.round(toNumber(line.qty_per_unit) * unitsPerPlate * 1000) / 1000);
  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2">
          <ColorDot hex={line.color_hex} className="size-4" />
          <span className="truncate text-sm font-medium">{line.item_name}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          {cost !== undefined ? <UnitCost value={cost} className="text-sm text-muted" /> : null}
          {editable ? (
            <Button variant="ghost" size="icon-sm" aria-label={`Remover ${line.item_name}`} onClick={onRemove}>
              <Trash2 />
            </Button>
          ) : null}
        </span>
      </div>
      <div className={cn('grid grid-cols-2 gap-3', filament ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        {filament ? (
          <>
            <Field label="Uso">
              <Select value={line.line_kind} disabled={!editable} onChange={(e) => onChange({ line_kind: e.target.value as BomLineKind })}>
                {(['FILAMENT_MODEL', 'FILAMENT_SUPPORT', 'FILAMENT_PURGE'] as BomLineKind[]).map((k) => (
                  <option key={k} value={k}>
                    {LINE_KIND_LABELS[k].replace('Filamento ', '').replace(/[()]/g, '')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Na mesa" required>
              <DecimalInput
                decimals={3}
                suffix={unit}
                value={perPlate}
                disabled={!editable}
                onValueChange={(v) => onChange({ qty_per_unit: v === null ? null : String(Math.round((toNumber(v) / unitsPerPlate) * 1000) / 1000) })}
              />
            </Field>
            <Field label="Por peça">
              <DecimalInput decimals={3} suffix={unit} value={line.qty_per_unit} disabled={!editable} onValueChange={(v) => onChange({ qty_per_unit: v })} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Por peça" required>
              <DecimalInput decimals={3} suffix={unit} value={line.qty_per_unit} disabled={!editable} onValueChange={(v) => onChange({ qty_per_unit: v })} />
            </Field>
            {line.item_kind === 'PACKAGING' ? (
              <Field label="Quando sai">
                <Input value={CONSUMED_AT_LABELS.DELIVERY} disabled />
              </Field>
            ) : (
              <Field label="Quando sai">
                <Select value={line.consumed_at} disabled={!editable} onChange={(e) => onChange({ consumed_at: e.target.value as ConsumedAt })}>
                  <option value="ASSEMBLY">{CONSUMED_AT_LABELS.ASSEMBLY}</option>
                  <option value="PRODUCTION">{CONSUMED_AT_LABELS.PRODUCTION}</option>
                </Select>
              </Field>
            )}
          </>
        )}
        <Field label="Perda" hint={filament ? 'Sobra, teste, troca de cor' : undefined}>
          <PercentInput value={line.waste_pct} disabled={!editable} onValueChange={(v) => onChange({ waste_pct: v })} />
        </Field>
      </div>
    </li>
  );
}

