import { AlertTriangle, ArrowLeft, Calculator, CheckCircle2, Layers, Play, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LayerBar } from '@/components/charts/chart';
import { Page, PageHeader } from '@/components/layout/page';
import { EntityPicker } from '@/components/shared/entity-picker';
import { ColorDot } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock, Skeleton, Spinner } from '@/components/ui/states';
import { useItems } from '@/data/inventory';
import {
  type PrintJobInput,
  type PrintPreview,
  type RateSet,
  usePlannableVariants,
  usePlanPrintJob,
  usePrintPreview,
  useBomLines,
  useEquipmentList,
  useRates,
  useStartPrintJob,
  type VariantRow,
} from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatCost, formatMinutes, formatNumber, formatQty, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { DurationInput, Notice, QtyStepper } from './bits';
import { bomFilamentGrams, bomMinutes, fromLocalInput } from './helpers';
import { useDebounced } from './use-now';

interface OutputDraft {
  variantId: number;
  qty: number;
  weight: string | null;
}

interface MaterialDraft {
  item_id: number;
  grams: string | null;
}

export function PlanPage() {
  const { can } = useMember();
  if (!can('production')) {
    return (
      <Page>
        <EmptyState title="Sem acesso ao planejamento" description="Seu perfil não registra impressões." />
      </Page>
    );
  }
  return <PlanForm />;
}

function initialOutputs(params: URLSearchParams): OutputDraft[] {
  const variant = Number(params.get('variante'));
  const qty = Number(params.get('qtd'));
  return Number.isInteger(variant) && variant > 0 ? [{ variantId: variant, qty: Number.isInteger(qty) && qty > 0 ? qty : 1, weight: null }] : [];
}

function PlanForm() {
  const { can, today } = useMember();
  const showCosts = can('costs');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const salesOrderId = Number(params.get('pedido')) > 0 ? Number(params.get('pedido')) : null;
  const equipment = useEquipmentList();
  const variants = usePlannableVariants();
  const filaments = useItems({ kind: 'FILAMENT' });
  const printers = useMemo(() => (equipment.data ?? []).filter((e) => e.kind === 'PRINTER' && e.status === 'ATIVO'), [equipment.data]);

  const [equipmentId, setEquipmentId] = useState<number | null>(null);
  const [outputs, setOutputs] = useState<OutputDraft[]>(() => initialOutputs(params));
  const [materials, setMaterials] = useState<MaterialDraft[] | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [plannedFor, setPlannedFor] = useState('');
  const [notes, setNotes] = useState('');
  const [picker, setPicker] = useState(false);
  const [addingFilament, setAddingFilament] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmShortage, setConfirmShortage] = useState(false);
  const [requestId, renew] = useRequestId();
  const [startId, renewStart] = useRequestId();
  const plan = usePlanPrintJob();
  const start = useStartPrintJob();

  const printerId = equipmentId ?? (printers.length === 1 ? printers[0]!.id : null);
  const printer = printers.find((p) => p.id === printerId) ?? null;
  const rates = useRates(printerId ?? undefined, today(), showCosts && printerId !== null);
  const variantById = useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v])), [variants.data]);
  const rows = outputs.map((o) => ({ ...o, variant: variantById.get(o.variantId) })).filter((r): r is OutputDraft & { variant: VariantRow } => Boolean(r.variant));
  const needsManual = rows.some((r) => !r.variant.active_bom_id);
  const bomLines = useBomLines(needsManual ? rows.map((r) => r.variant.active_bom_id).filter((id): id is number => Boolean(id)) : []);
  const bomDefaults = needsManual ? bomFilamentGrams(bomLines.data ?? [], rows.map((r) => ({ bomId: r.variant.active_bom_id, qty: r.qty }))) : [];
  const clientMinutes = bomMinutes(
    rows.map((r) => r.variant),
    rows.map((r) => r.qty),
  );
  const manualMaterials = materials ?? (needsManual ? bomDefaults : null);
  const usableMaterials = manualMaterials?.filter((m) => toNumber(m.grams) > 0) ?? null;

  const job: PrintJobInput | null =
    printerId && rows.length > 0 && rows.every((r) => r.qty > 0) && (!needsManual || (usableMaterials?.length ?? 0) > 0)
      ? {
          equipment_id: printerId,
          planned_for: fromLocalInput(plannedFor),
          est_minutes: minutes ?? (needsManual ? clientMinutes || null : null),
          outputs: rows.map((r) => ({ variant_id: r.variantId, qty_planned: r.qty, est_weight_g_per_unit: r.weight ?? undefined })),
          materials: usableMaterials ? usableMaterials.map((m) => ({ item_id: m.item_id, est_g: m.grams! })) : undefined,
        }
      : null;
  const debounced = useDebounced(job, 450);
  const preview = usePrintPreview(debounced);
  const data = job ? preview.data : undefined;
  const updating = job !== null && (preview.isFetching || JSON.stringify(job) !== JSON.stringify(debounced));
  const shownMinutes = minutes ?? data?.est_minutes ?? (clientMinutes || null);

  const filamentById = new Map((filaments.data ?? []).map((f) => [f.id, f]));
  const checkById = new Map((data?.materials ?? []).map((m) => [m.item_id, m]));
  const materialRows: Array<{ item_id: number; grams: string | null }> = manualMaterials ?? (data?.materials ?? []).map((m) => ({ item_id: m.item_id, grams: String(m.needed_g) }));

  const editGrams = (itemId: number, grams: string | null) => {
    const base = manualMaterials ?? (data?.materials ?? []).map((m) => ({ item_id: m.item_id, grams: String(m.needed_g) }));
    setMaterials(base.map((m) => (m.item_id === itemId ? { ...m, grams } : m)));
  };
  const removeMaterial = (itemId: number) => setMaterials(materialRows.filter((m) => m.item_id !== itemId));
  const addMaterial = (itemId: number) => {
    setMaterials([...materialRows, { item_id: itemId, grams: null }]);
    setAddingFilament(false);
  };
  const setOutput = (variantId: number, patch: Partial<OutputDraft>) => setOutputs((list) => list.map((o) => (o.variantId === variantId ? { ...o, ...patch } : o)));

  const buildJob = (): PrintJobInput | null => {
    if (!printerId) {
      setError('Escolha a impressora.');
      return null;
    }
    if (rows.length === 0) {
      setError('Adicione ao menos uma variação à mesa.');
      return null;
    }
    if (needsManual && (usableMaterials?.length ?? 0) === 0) {
      setError('Sem ficha técnica ativa: informe os filamentos e os gramas da mesa.');
      return null;
    }
    if (needsManual && !(minutes ?? clientMinutes)) {
      setError('Sem ficha técnica ativa: informe o tempo estimado da impressão.');
      return null;
    }
    return job ? { ...job, sales_order_id: salesOrderId, notes: notes.trim() || null } : null;
  };

  const submit = (andStart: boolean, shortageConfirmed = false) => {
    setError(null);
    const payload = buildJob();
    if (!payload) return;
    if (andStart && data?.shortage && !shortageConfirmed) {
      setConfirmShortage(true);
      return;
    }
    plan.mutate(
      { requestId, job: payload },
      {
        onSuccess: (r) => {
          renew();
          if (!andStart) return navigate(`/producao/impressoes/${r.print_job_id}`, { replace: true });
          start.mutate(
            { requestId: startId, jobId: r.print_job_id, confirmShortage: shortageConfirmed },
            {
              onSuccess: () => renewStart(),
              onError: (e) => toast.error(`${r.code} ficou planejada, mas não iniciou: ${describeError(e)}`),
              onSettled: () => navigate(`/producao/impressoes/${r.print_job_id}`, { replace: true }),
            },
          );
        },
        onError: (e) => setError(describeError(e)),
      },
    );
  };

  if (equipment.isError) return <Page><ErrorState error={equipment.error} onRetry={() => void equipment.refetch()} /></Page>;
  if (!equipment.data || !variants.data) return <Page><LoadingBlock /></Page>;

  const busy = printer?.printing_code;
  const plateWarnings = (data?.warnings ?? []).filter((w) => !/passam do que cabe/.test(w));
  const saving = plan.isPending || start.isPending;

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/producao" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Produção
          </Link>
        }
        title="Nova impressão"
        description="Monte a mesa: impressora, peças e quantidades. Gramas e tempo vêm da ficha técnica e podem ser ajustados."
      />
      {printers.length === 0 ? (
        <EmptyState
          title="Nenhuma impressora ativa"
          description="Cadastre a impressora (ou volte-a para “Ativo”) para planejar impressões."
          action={
            can('write') ? (
              <Button asChild>
                <Link to="/producao/equipamentos/novo">Cadastrar impressora</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <Card>
              <CardHeader title="Impressora" />
              <div className="space-y-2 p-4">
                {printers.length > 1 ? (
                  <Select aria-label="Impressora" value={printerId ?? ''} onChange={(e) => setEquipmentId(e.target.value ? Number(e.target.value) : null)} className="h-11">
                    <option value="">Escolha a impressora…</option>
                    {printers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.printing_code ? ` (imprimindo ${p.printing_code})` : ''}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-sm font-medium">{printers[0]!.name}</p>
                )}
                {busy ? <p className="text-xs text-warning">Imprimindo {busy} agora: dá para planejar, mas só inicia depois de finalizar a atual.</p> : null}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Peças nesta mesa"
                description="Uma mesa pode ter várias variações; o custo é dividido entre elas pelo peso."
                actions={
                  <Button size="sm" variant="outline" onClick={() => setPicker(true)}>
                    <Plus /> Adicionar
                  </Button>
                }
              />
              <div className="p-4">
                {rows.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setPicker(true)}
                    className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-line-strong px-4 py-8 text-sm text-muted hover:border-ink hover:text-ink"
                  >
                    <Plus className="size-6" aria-hidden />
                    Escolher a variação (produto + cor)
                  </button>
                ) : (
                  <ul className="space-y-3">
                    {rows.map((r) => {
                      const v = r.variant;
                      const out = data?.outputs.find((o) => o.variant_id === r.variantId);
                      const perPlate = v.units_per_plate ?? 0;
                      return (
                        <li key={r.variantId} className="rounded-lg border border-line p-3">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold">{v.full_name}</p>
                              <p className="text-xs text-muted">
                                {v.active_bom_id
                                  ? `${perPlate} por mesa · ${formatMinutes(v.est_print_minutes_per_plate)} por mesa${out?.est_weight_g_per_unit ? ` · ${formatQty(out.est_weight_g_per_unit, 'G')}/un` : ''}`
                                  : 'Sem ficha técnica ativa: informe gramas e tempo abaixo'}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {!v.active_bom_id ? <Badge tone="warning">sem ficha</Badge> : null}
                                {out ? out.needs_finishing ? <Badge tone="info">vai para o acabamento</Badge> : <Badge tone="success">direto para o estoque</Badge> : null}
                              </div>
                            </div>
                            <Button variant="ghost" size="icon-sm" aria-label={`Remover ${v.full_name}`} onClick={() => setOutputs((list) => list.filter((o) => o.variantId !== r.variantId))}>
                              <Trash2 />
                            </Button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <QtyStepper label={`quantidade de ${v.full_name}`} value={r.qty} min={1} onChange={(qty) => setOutput(r.variantId, { qty })} />
                            {showCosts && out?.est_unit_cost !== undefined ? (
                              <span className="text-right text-xs text-muted">
                                <Money value={out.est_unit_cost} cost estimated hint="Custo previsto por unidade (material + operacional)" className="text-sm font-semibold text-ink" />
                                <span className="block">por unidade</span>
                              </span>
                            ) : null}
                          </div>
                          {perPlate > 0 && r.qty > perPlate ? (
                            <p className="mt-2 inline-flex items-start gap-1 text-xs text-warning">
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                              Cabem {perPlate} por mesa: {r.qty} unidades pedem {Math.ceil(r.qty / perPlate)} mesas. Considere dividir em mais impressões.
                            </p>
                          ) : null}
                          {!v.active_bom_id ? (
                            <Field label="Peso por unidade (g)" hint="Opcional: usado para dividir o custo entre as peças da mesa." className="mt-2 sm:max-w-56">
                              <DecimalInput decimals={3} suffix="g" value={r.weight} onValueChange={(weight) => setOutput(r.variantId, { weight })} />
                            </Field>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Tempo e filamento"
                description={materials || minutes !== null ? 'Ajustado manualmente.' : 'Pela ficha técnica ativa (modelo + suporte + purga, com desperdício).'}
                actions={
                  (materials || minutes !== null) && !needsManual ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setMaterials(null);
                        setMinutes(null);
                      }}
                    >
                      <RotateCcw /> Voltar à ficha
                    </Button>
                  ) : undefined
                }
              />
              <div className="space-y-4 p-4">
                <Field
                  label="Tempo estimado da impressão"
                  required={needsManual}
                  hint={clientMinutes > 0 ? `Pela ficha: ${formatMinutes(clientMinutes)}${needsManual ? ' (só as variações com ficha)' : ''}` : undefined}
                >
                  <DurationInput value={shownMinutes} onChange={setMinutes} className="sm:max-w-72" />
                </Field>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink-soft">Filamentos</p>
                  {materialRows.length === 0 ? (
                    <p className="text-sm text-muted">{rows.length === 0 ? 'Adicione peças para ver os filamentos.' : needsManual ? 'Adicione o filamento usado e os gramas da mesa.' : job ? 'Calculando…' : '—'}</p>
                  ) : (
                    <ul className="space-y-2">
                      {materialRows.map((m) => {
                        const item = filamentById.get(m.item_id);
                        const check = checkById.get(m.item_id);
                        const short = check ? toNumber(check.available_g) < toNumber(check.needed_g) : false;
                        const spoolShort = check && !short && check.lot_remaining_g !== null && toNumber(check.lot_remaining_g) < toNumber(check.needed_g);
                        return (
                          <li key={m.item_id} className={cn('rounded-lg border p-3', short ? 'border-danger/40 bg-danger-soft/40' : spoolShort ? 'border-warning/40 bg-warning-soft/40' : 'border-line')}>
                            <div className="flex items-center gap-3">
                              <ColorDot hex={item?.color_hex} className="size-5" />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item?.name ?? check?.item_name ?? `Item ${m.item_id}`}</span>
                              <div className="w-32">
                                <DecimalInput aria-label={`Gramas de ${item?.name ?? 'filamento'}`} decimals={3} suffix="g" value={m.grams} onValueChange={(g) => editGrams(m.item_id, g)} />
                              </div>
                              {manualMaterials ? (
                                <Button variant="ghost" size="icon-sm" aria-label="Remover filamento" onClick={() => removeMaterial(m.item_id)}>
                                  <Trash2 />
                                </Button>
                              ) : null}
                            </div>
                            {check ? (
                              <p className={cn('mt-1.5 text-xs', short ? 'font-medium text-danger' : spoolShort ? 'text-warning' : 'text-muted')}>
                                {short
                                  ? `Falta: disponível ${formatQty(Math.max(0, toNumber(check.available_g)), 'G')}, necessário ${formatQty(check.needed_g, 'G')}.`
                                  : `Disponível ${formatQty(check.available_g, 'G')}`}
                                {check.lot_code ? ` · usa o carretel ${check.lot_code} (${formatQty(check.lot_remaining_g, 'G')})` : ''}
                                {spoolShort ? ': não cobre a mesa inteira, vai trocar de carretel no meio' : ''}
                                {showCosts && check.unit_cost !== null ? ` · ${formatCost(toNumber(check.unit_cost) * 1000, 2)}/kg${check.estimated ? ' (referência)' : ''}` : ''}
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {addingFilament ? (
                    <Select aria-label="Adicionar filamento" value="" onChange={(e) => e.target.value && addMaterial(Number(e.target.value))}>
                      <option value="">Escolha o filamento…</option>
                      {(filaments.data ?? [])
                        .filter((f) => !materialRows.some((m) => m.item_id === f.id))
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} — {formatQty(f.qty_available, 'G')} livres
                          </option>
                        ))}
                    </Select>
                  ) : rows.length > 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setAddingFilament(true)}>
                      <Plus /> Adicionar filamento
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Detalhes" />
              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                <Field label="Planejada para" hint="Em branco: agora.">
                  <Input type="datetime-local" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} />
                </Field>
                {salesOrderId ? (
                  <Field label="Pedido">
                    <Input value={`Pedido nº ${salesOrderId}`} disabled />
                  </Field>
                ) : (
                  <div className="hidden sm:block" />
                )}
                <Field label="Observações" className="sm:col-span-2">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
                </Field>
              </div>
            </Card>
          </div>

          <div className="space-y-4 lg:col-span-2">
            <div className="space-y-4 lg:sticky lg:top-4">
              <Card>
                <CardHeader
                  title="Verificação"
                  description={data ? `${formatMinutes(data.est_minutes)} de máquina · ${formatQty(data.materials.reduce((s, m) => s + toNumber(m.needed_g), 0), 'G')} de filamento` : undefined}
                  actions={updating ? <Spinner label="Atualizando…" /> : undefined}
                />
                <div className="space-y-3 p-4">
                  {!job ? (
                    <p className="text-sm text-muted">{rows.length === 0 ? 'Adicione as peças para conferir materiais e custo.' : 'Complete gramas e tempo para conferir.'}</p>
                  ) : preview.isError && !updating ? (
                    <Notice tone="danger">{describeError(preview.error)}</Notice>
                  ) : !data ? (
                    <Skeleton className="h-16" />
                  ) : (
                    <Verification data={data} warnings={plateWarnings} />
                  )}
                </div>
              </Card>

              {showCosts ? (
                <Card>
                  <CardHeader title="Custo previsto" description="Estimativa: o custo real é calculado ao finalizar." />
                  <div className="p-4">{data?.cost ? <CostPreview data={data} rates={rates.data} /> : <p className="text-sm text-muted">Aparece quando a mesa estiver completa.</p>}</div>
                </Card>
              ) : null}

              {error ? <Notice tone="danger">{error}</Notice> : null}
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                <Button size="lg" className="sm:flex-1 lg:flex-none" onClick={() => submit(true)} loading={saving && start.isPending} disabled={saving || Boolean(busy)}>
                  <Play /> Salvar e iniciar agora
                </Button>
                <Button size="lg" variant="outline" className="sm:flex-1 lg:flex-none" onClick={() => submit(false)} loading={plan.isPending && !start.isPending} disabled={saving}>
                  <Save /> Salvar como planejada
                </Button>
              </div>
              {busy ? <p className="text-xs text-muted">Para iniciar agora, finalize antes a impressão {busy}.</p> : null}
            </div>
          </div>
        </div>
      )}

      <EntityPicker
        open={picker}
        onOpenChange={setPicker}
        title="Variação"
        loading={!variants.data}
        options={(variants.data ?? [])
          .filter((v) => !outputs.some((o) => o.variantId === v.id))
          .map((v) => ({
            id: String(v.id),
            label: v.full_name,
            searchText: v.sku,
            description: v.active_bom_id
              ? `${v.sku} · ${v.units_per_plate} por mesa · ${formatMinutes(v.est_print_minutes_per_plate)} por mesa · ${formatNumber(v.qty_available, 0)} no estoque`
              : `${v.sku} · sem ficha técnica ativa`,
          }))}
        onSelect={(option) => {
          const v = variantById.get(Number(option.id));
          if (!v) return;
          setOutputs((list) => [...list, { variantId: v.id, qty: v.units_per_plate ?? 1, weight: null }]);
        }}
        emptyText="Nenhuma variação ativa. Cadastre o produto e a ficha técnica em Produtos."
      />
      <ConfirmDialog
        open={confirmShortage}
        onOpenChange={setConfirmShortage}
        tone="primary"
        title="Falta material para esta mesa"
        description="O estoque livre não cobre todo o filamento previsto. Dá para iniciar mesmo assim (por exemplo, se o saldo do sistema estiver desatualizado), mas ao finalizar o consumo real precisa caber no estoque."
        confirmLabel="Iniciar mesmo assim"
        onConfirm={() => submit(true, true)}
      />
    </Page>
  );
}

function Verification({ data, warnings }: { data: PrintPreview; warnings: string[] }) {
  return (
    <>
      {data.shortage ? (
        <Notice tone="danger" icon={<AlertTriangle />}>
          Falta filamento. Dá para salvar como planejada; para iniciar será pedida uma confirmação.
        </Notice>
      ) : (
        <Notice tone="success" icon={<CheckCircle2 />}>
          Filamento suficiente no estoque livre.
        </Notice>
      )}
      {warnings.length > 0 ? (
        <ul className="space-y-1.5">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      ) : null}
      {data.components.length > 0 ? (
        <div className="space-y-1.5">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <Layers className="size-3.5" aria-hidden /> Componentes da montagem
          </p>
          <ul className="space-y-1">
            {data.components.map((c) => {
              const short = toNumber(c.available) < toNumber(c.needed);
              return (
                <li key={c.item_id} className={cn('flex items-center justify-between gap-2 text-sm', short && 'font-medium text-danger')}>
                  <span className="min-w-0 truncate">{c.item_name}</span>
                  <span className="num shrink-0 text-xs">
                    {formatNumber(c.needed)} de {formatNumber(Math.max(0, toNumber(c.available)))} {short ? '(falta)' : 'disponíveis'}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">Baixados na liberação, depois do acabamento.</p>
        </div>
      ) : null}
    </>
  );
}

function CostPreview({ data, rates }: { data: PrintPreview; rates: RateSet | undefined }) {
  const cost = data.cost!;
  const hours = toNumber(data.est_minutes) / 60;
  let rateLine: ReactNode;
  if (data.rate_mode === 'COMBINED') rateLine = <>Taxa combinada {formatCost(rates?.operational_h ?? toNumber(cost.operational) / (hours || 1), 2)}/h × {formatMinutes(data.est_minutes)}</>;
  else if (data.rate_mode === 'SPLIT')
    rateLine = (
      <>
        Energia {formatCost(rates?.energy_h ?? 0, 4)}/h + depreciação {formatCost(rates?.depreciation_h ?? 0, 4)}/h × {formatMinutes(data.est_minutes)}
      </>
    );
  else rateLine = <span className="text-warning">Sem taxa por hora vigente: o custo operacional fica zero. Cadastre em Produção → Taxas.</span>;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">Total da mesa</span>
        <Money value={cost.total} estimated hint="Estimativa pelo custo médio atual e pela taxa vigente" className="text-2xl font-semibold" />
      </div>
      <LayerBar values={{ material: toNumber(cost.material), energy: toNumber(cost.energy), depreciation: toNumber(cost.depreciation), operational: toNumber(cost.operational) }} />
      <p className="text-xs text-muted">{rateLine}</p>
      {data.outputs.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="pb-1 font-medium">Peça</th>
              <th className="pb-1 text-right font-medium">Qtd</th>
              <th className="pb-1 text-right font-medium">Parte</th>
              <th className="pb-1 text-right font-medium">Por un.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.outputs.map((o) => (
              <tr key={o.variant_id}>
                <td className="py-1.5 pr-2">{o.variant_name}</td>
                <td className="num py-1.5 text-right">{o.qty_planned}</td>
                <td className="py-1.5 text-right">
                  <Money value={toNumber(o.est_material) + toNumber(o.est_operational)} />
                </td>
                <td className="py-1.5 text-right">
                  <Money value={o.est_unit_cost} cost />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="space-y-1 rounded-lg bg-subtle p-3 text-xs text-ink-soft">
        <p className="inline-flex items-center gap-1 font-semibold text-ink">
          <Calculator className="size-3.5" aria-hidden /> Como é calculado
        </p>
        <p>Custo da impressão = Σ gramas × custo médio por grama do filamento + horas × taxa por hora.</p>
        <p>Peças da mesma mesa dividem o custo pelo peso previsto × quantidade planejada.</p>
        <p>Peças com falha não entram no estoque: o custo delas vai para “custo de falhas”.</p>
        <p>Peças com montagem ou acabamento na ficha esperam o acabamento; as outras entram no estoque ao finalizar.</p>
      </div>
    </div>
  );
}
