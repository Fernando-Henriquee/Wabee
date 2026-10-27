import { AlertTriangle, CheckCircle2, ChevronDown, PackageCheck, Plus, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ColorDot } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/money-input';
import { LoadingBlock } from '@/components/ui/states';
import { LOT_STATUS_LABELS, useItems, useLots } from '@/data/inventory';
import {
  type CloseResult,
  errorHint,
  FAILURE_REASON_LABELS,
  FAILURE_REASONS,
  type FailureReason,
  type PrintJobMaterialRow,
  type PrintJobOutputRow,
  type PrintJobRow,
  useCancelPrintJob,
  useFailPrintJob,
  useFinishPrintJob,
  useJobMaterials,
  useJobOutputs,
  useReplanPrintJob,
  useStartPrintJob,
} from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatMinutes, formatQty, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { DurationInput, Notice, QtyStepper } from './bits';
import { useNow } from './use-now';
import { formatTimeBR, fromLocalInput, gramsUntilFailure, splitByWeight, toLocalInput } from './helpers';

interface JobDialogProps {
  job: PrintJobRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// -----------------------------------------------------------------------------
// Iniciar (US-5.3)
// -----------------------------------------------------------------------------

export function StartJobDialog({ job, open, onOpenChange }: JobDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open ? <StartContent job={job} onClose={() => onOpenChange(false)} /> : null}</Dialog>;
}

function StartContent({ job, onClose }: { job: PrintJobRow; onClose: () => void }) {
  const { settings } = useMember();
  const [requestId, renew] = useRequestId();
  const [custom, setCustom] = useState(false);
  const [startedAt, setStartedAt] = useState(() => toLocalInput(new Date()));
  const [needsConfirm, setNeedsConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useStartPrintJob();
  const now = useNow(30_000);
  const startIso = custom ? fromLocalInput(startedAt) : null;
  const expectedEnd = new Date((startIso ? new Date(startIso).getTime() : now) + job.est_minutes * 60_000).toISOString();

  const submit = () => {
    setError(null);
    start.mutate(
      { requestId, jobId: job.id, startedAt: startIso, confirmShortage: needsConfirm !== null },
      {
        onSuccess: () => {
          renew();
          onClose();
        },
        onError: (e) => {
          // Pedido recusado: o mesmo identificador pode ser reutilizado.
          if (errorHint(e) === 'confirmacao_necessaria') setNeedsConfirm(describeError(e));
          else setError(describeError(e));
        },
      },
    );
  };

  return (
    <DialogContent
      title={`Iniciar ${job.code}`}
      description={`${job.equipment_name} · ${job.outputs_summary ?? ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button size="lg" onClick={submit} loading={start.isPending} variant={needsConfirm ? 'danger' : 'primary'}>
            {needsConfirm ? 'Iniciar mesmo assim' : custom ? 'Iniciar' : 'Iniciar agora'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">
          Tempo previsto <strong className="num">{formatMinutes(job.est_minutes)}</strong> · termina por volta de{' '}
          <strong className="num">{formatTimeBR(expectedEnd, settings.timezone)}</strong>.
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
          <Checkbox checked={custom} onChange={(e) => setCustom(e.target.checked)} /> Começou em outro horário
        </label>
        {custom ? (
          <Field label="Início da impressão">
            <Input type="datetime-local" value={startedAt} max={toLocalInput(new Date())} onChange={(e) => setStartedAt(e.target.value)} />
          </Field>
        ) : null}
        {needsConfirm ? (
          <Notice tone="warning" icon={<AlertTriangle />}>
            {needsConfirm}
            <span className="mt-1 block text-xs">Ao finalizar, se o filamento não der, nada é gravado até você ajustar o estoque.</span>
          </Notice>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </DialogContent>
  );
}

// -----------------------------------------------------------------------------
// Filamento usado (finalizar e falha)
// -----------------------------------------------------------------------------

interface MaterialState {
  item_id: number;
  name: string;
  color_hex: string | null;
  est_g: number;
  grams: string | null;
  lot: string;
  perOutput: Record<number, string | null>;
}

function initialMaterials(materials: PrintJobMaterialRow[], gramsFor: (m: PrintJobMaterialRow) => string): MaterialState[] {
  return materials.map((m) => ({
    item_id: m.item_id,
    name: m.item_name,
    color_hex: m.color_hex,
    est_g: toNumber(m.est_g),
    grams: gramsFor(m),
    lot: '',
    perOutput: {},
  }));
}

function LotPicker({ itemId, value, onChange }: { itemId: number; value: string; onChange: (lot: string) => void }) {
  const [open, setOpen] = useState(value !== '');
  const lots = useLots(itemId, true);
  if (!open) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setOpen(true)}>
        Carretel: automático (o aberto primeiro) <ChevronDown className="size-3" aria-hidden />
      </button>
    );
  }
  return (
    <Select aria-label="Carretel usado" className="h-9 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Automático (o aberto primeiro)</option>
      {(lots.data ?? []).map((lot) => (
        <option key={lot.id} value={lot.id}>
          {lot.lot_code} — {formatQty(lot.qty_remaining, 'G')} ({LOT_STATUS_LABELS[lot.status]?.toLowerCase()})
        </option>
      ))}
    </Select>
  );
}

function AddFilament({ exclude, onAdd }: { exclude: number[]; onAdd: (item: { id: number; name: string; color_hex: string | null }) => void }) {
  const [adding, setAdding] = useState(false);
  const filaments = useItems({ kind: 'FILAMENT' });
  if (!adding) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)}>
        <Plus /> Outro filamento
      </Button>
    );
  }
  return (
    <Select
      aria-label="Adicionar filamento"
      value=""
      onChange={(e) => {
        const item = filaments.data?.find((f) => String(f.id) === e.target.value);
        if (item) onAdd({ id: item.id, name: item.name, color_hex: item.color_hex });
        setAdding(false);
      }}
    >
      <option value="">Escolha o filamento…</option>
      {(filaments.data ?? [])
        .filter((f) => !exclude.includes(f.id))
        .map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} — {formatQty(f.qty_available, 'G')} livres
          </option>
        ))}
    </Select>
  );
}

function sumGrams(values: Array<string | null | undefined>): string {
  const total = values.reduce((sum, v) => sum + toNumber(v ?? 0), 0);
  return String(Math.round(total * 1000) / 1000);
}

// -----------------------------------------------------------------------------
// Finalizar (US-5.4) — o fluxo diário principal
// -----------------------------------------------------------------------------

export function FinishJobDialog({ job, open, onOpenChange }: JobDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open ? <FinishLoader job={job} onClose={() => onOpenChange(false)} /> : null}</Dialog>;
}

function FinishLoader({ job, onClose }: { job: PrintJobRow; onClose: () => void }) {
  const outputs = useJobOutputs(job.id);
  const materials = useJobMaterials(job.id);
  if (!outputs.data || !materials.data) {
    return (
      <DialogContent title={`Finalizar ${job.code}`} size="lg">
        <LoadingBlock rows={3} />
      </DialogContent>
    );
  }
  return <FinishForm job={job} outputs={outputs.data} materials={materials.data} onClose={onClose} />;
}

interface OutputCount {
  good: number;
  reason: FailureReason | '';
}

function FinishForm({ job, outputs, materials, onClose }: { job: PrintJobRow; outputs: PrintJobOutputRow[]; materials: PrintJobMaterialRow[]; onClose: () => void }) {
  const { can } = useMember();
  const [requestId, renew] = useRequestId();
  const [openedAt] = useState(() => Date.now());
  // Tempo de máquina vem da ficha (previsto ao planejar), nunca do tempo em que o cartão ficou no quadro.
  const [minutes, setMinutes] = useState<number | null>(job.est_minutes);
  const [customEnd, setCustomEnd] = useState(false);
  const [finishedAt, setFinishedAt] = useState(() => toLocalInput(new Date(openedAt)));
  const [rows, setRows] = useState<MaterialState[]>(() => initialMaterials(materials, (m) => String(toNumber(m.est_g))));
  const [perOutput, setPerOutput] = useState(false);
  const [counts, setCounts] = useState<Record<number, OutputCount>>(() => Object.fromEntries(outputs.map((o) => [o.id, { good: o.qty_planned, reason: '' }])));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloseResult | null>(null);
  const finish = useFinishPrintJob();
  const multi = outputs.length > 1;
  const weights = outputs.map((o) => toNumber(o.est_weight_g_per_unit) * o.qty_planned);

  const setRow = (itemId: number, patch: Partial<MaterialState>) => setRows((list) => list.map((r) => (r.item_id === itemId ? { ...r, ...patch } : r)));

  const togglePerOutput = (on: boolean) => {
    setPerOutput(on);
    if (on) {
      // Ponto de partida: os gramas de cada filamento divididos pelo peso previsto de cada peça.
      setRows((list) =>
        list.map((r) => {
          const parts = splitByWeight(r.grams ?? 0, weights);
          return { ...r, perOutput: Object.fromEntries(outputs.map((o, i) => [o.id, parts[i] ?? '0'])) };
        }),
      );
    }
  };

  const totalGood = outputs.reduce((s, o) => s + (counts[o.id]?.good ?? 0), 0);
  const totalPlanned = outputs.reduce((s, o) => s + o.qty_planned, 0);
  const toFinishing = outputs.filter((o) => o.needs_finishing && (counts[o.id]?.good ?? 0) > 0);

  const submit = () => {
    setError(null);
    if (minutes === null) return setError('Informe quanto tempo a impressão levou.');
    const missingReason = outputs.find((o) => {
      const c = counts[o.id]!;
      return c.good < o.qty_planned && !c.reason;
    });
    if (missingReason) return setError(`Escolha o motivo das falhas de "${missingReason.variant_name}".`);
    if (rows.length === 0) return setError('Informe os gramas de filamento usados.');
    finish.mutate(
      {
        requestId,
        jobId: job.id,
        result: {
          finished_at: customEnd ? fromLocalInput(finishedAt) : null,
          actual_minutes: minutes,
          materials: rows.map((r) => {
            const per = perOutput && multi ? Object.fromEntries(outputs.map((o) => [String(o.id), r.perOutput[o.id] ?? '0'])) : undefined;
            return {
              item_id: r.item_id,
              actual_g: per ? sumGrams(Object.values(per)) : (r.grams ?? '0'),
              lot_id: r.lot ? Number(r.lot) : null,
              per_output: per,
            };
          }),
          outputs: outputs.map((o) => {
            const c = counts[o.id]!;
            const failed = o.qty_planned - c.good;
            return { output_id: o.id, qty_good: c.good, qty_failed: failed, failure_reason: failed > 0 ? (c.reason as FailureReason) : null };
          }),
          notes: notes.trim() || null,
        },
      },
      {
        onSuccess: (r) => {
          renew();
          setResult(r);
        },
        onError: (e) => setError(describeError(e)),
      },
    );
  };

  if (result) return <FinishSummary job={job} outputs={outputs} counts={counts} result={result} onClose={onClose} showCosts={can('costs')} />;

  return (
    <DialogContent
      title={`Finalizar ${job.code}`}
      description={`${job.equipment_name} · ${job.outputs_summary ?? ''}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button size="lg" onClick={submit} loading={finish.isPending}>
            <CheckCircle2 /> Finalizar impressão
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2" aria-label="Tempo">
          <Field label="Tempo de máquina" hint={`Previsto pela ficha: ${formatMinutes(job.est_minutes)} · altere se souber o tempo real da impressora`}>
            <DurationInput value={minutes} onChange={setMinutes} />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
            <Checkbox checked={customEnd} onChange={(e) => setCustomEnd(e.target.checked)} /> Terminou antes de agora
          </label>
          {customEnd ? (
            <Field label="Horário do término">
              <Input type="datetime-local" value={finishedAt} max={toLocalInput(new Date())} onChange={(e) => setFinishedAt(e.target.value)} />
            </Field>
          ) : null}
        </section>

        <section className="space-y-2" aria-label="Filamento usado">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Filamento usado (modelo + suporte + purga)</h3>
            {multi ? (
              <label className="inline-flex items-center gap-2 text-xs text-ink-soft">
                <Checkbox checked={perOutput} onChange={(e) => togglePerOutput(e.target.checked)} /> Gramas por peça (mesa multicor)
              </label>
            ) : null}
          </div>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.item_id} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-3">
                  <ColorDot hex={r.color_hex} className="size-5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted">previsto {formatQty(r.est_g, 'G')}</p>
                  </div>
                  {perOutput && multi ? (
                    <span className="num text-sm font-semibold">{formatQty(sumGrams(Object.values(r.perOutput)), 'G')}</span>
                  ) : (
                    <div className="w-32">
                      <DecimalInput aria-label={`Gramas de ${r.name}`} decimals={3} suffix="g" className="h-11 text-base" value={r.grams} onValueChange={(grams) => setRow(r.item_id, { grams })} />
                    </div>
                  )}
                  {r.est_g === 0 ? (
                    <Button variant="ghost" size="icon-sm" aria-label="Remover filamento" onClick={() => setRows((list) => list.filter((x) => x.item_id !== r.item_id))}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                {perOutput && multi ? (
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {outputs.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 text-xs text-ink-soft">
                        <span className="min-w-0 flex-1 truncate">{o.variant_name}</span>
                        <span className="w-28">
                          <DecimalInput
                            aria-label={`Gramas de ${r.name} em ${o.variant_name}`}
                            decimals={3}
                            suffix="g"
                            className="h-9"
                            value={r.perOutput[o.id] ?? null}
                            onValueChange={(v) => setRow(r.item_id, { perOutput: { ...r.perOutput, [o.id]: v } })}
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="mt-1.5">
                  <LotPicker itemId={r.item_id} value={r.lot} onChange={(lot) => setRow(r.item_id, { lot })} />
                </div>
              </li>
            ))}
          </ul>
          <AddFilament
            exclude={rows.map((r) => r.item_id)}
            onAdd={(item) => setRows((list) => [...list, { item_id: item.id, name: item.name, color_hex: item.color_hex, est_g: 0, grams: null, lot: '', perOutput: {} }])}
          />
        </section>

        <section className="space-y-2" aria-label="Peças">
          <h3 className="text-sm font-semibold">
            Peças <span className="font-normal text-muted">· boas + falhas = planejado</span>
          </h3>
          <ul className="space-y-2">
            {outputs.map((o) => {
              const c = counts[o.id]!;
              const failed = o.qty_planned - c.good;
              return (
                <li key={o.id} className={cn('rounded-lg border p-3', failed > 0 ? 'border-danger/30 bg-danger-soft/40' : 'border-line')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{o.variant_name}</p>
                      <p className="text-xs text-muted">
                        {o.qty_planned} planejada(s) · {o.needs_finishing ? 'vai para o acabamento' : 'entra no estoque ao finalizar'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <p className="mb-0.5 text-xs text-muted">Boas</p>
                        <QtyStepper label={`boas de ${o.variant_name}`} value={c.good} min={0} max={o.qty_planned} onChange={(good) => setCounts((all) => ({ ...all, [o.id]: { ...c, good } }))} />
                      </div>
                      <div className="w-14 text-center">
                        <p className="mb-0.5 text-xs text-muted">Falhas</p>
                        <p className={cn('num grid h-11 place-items-center text-lg font-semibold', failed > 0 ? 'text-danger' : 'text-muted')}>{failed}</p>
                      </div>
                    </div>
                  </div>
                  {failed > 0 ? (
                    <Field label="Motivo das falhas" required className="mt-2">
                      <Select value={c.reason} onChange={(e) => setCounts((all) => ({ ...all, [o.id]: { ...c, reason: e.target.value as FailureReason } }))}>
                        <option value="">Escolha…</option>
                        {FAILURE_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {FAILURE_REASON_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <Field label="Observações">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="min-h-14" />
        </Field>

        <Notice tone="info" icon={<Sparkles />}>
          {totalGood} de {totalPlanned} peça(s) boas.{' '}
          {toFinishing.length > 0
            ? `${toFinishing.map((o) => o.variant_name).join(', ')} vai(ão) para a fila de acabamento; o resto entra no estoque agora.`
            : 'Todas as peças boas entram no estoque agora.'}{' '}
          O material é baixado do carretel e o custo é calculado numa única gravação.
        </Notice>
        {error ? (
          <Notice tone="danger" icon={<XCircle />}>
            {error}
            {/saldo/i.test(error) ? <span className="mt-1 block text-xs">Nada foi gravado. Ajuste os gramas ou registre o filamento no estoque e tente de novo.</span> : null}
          </Notice>
        ) : null}
      </div>
    </DialogContent>
  );
}

function FinishSummary({
  job,
  outputs,
  counts,
  result,
  onClose,
  showCosts,
}: {
  job: PrintJobRow;
  outputs: PrintJobOutputRow[];
  counts: Record<number, OutputCount>;
  result: CloseResult;
  onClose: () => void;
  showCosts: boolean;
}) {
  const released = new Map((result.released ?? []).map((r) => [r.output_id, r]));
  const totalFailed = outputs.reduce((s, o) => s + (o.qty_planned - (counts[o.id]?.good ?? 0)), 0);
  const finishing = outputs.filter((o) => !released.has(o.id) && (counts[o.id]?.good ?? 0) > 0);
  return (
    <DialogContent
      title={`${result.code} finalizada`}
      description={`${formatMinutes(result.minutes)} de impressão${result.time_estimated ? ' (tempo estimado)' : ''}`}
      size="lg"
      footer={
        <>
          {finishing.length > 0 ? (
            <Button asChild variant="outline">
              <Link to="/producao?status=ACABAMENTO" onClick={onClose}>
                Ir para o acabamento
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to={`/producao/impressoes/${job.id}`} onClick={onClose}>
              Ver impressão
            </Link>
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="success" icon={<CheckCircle2 />}>
          Tudo gravado: filamento baixado, tempo de máquina registrado e peças distribuídas.
        </Notice>
        {showCosts ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line p-3">
              <p className="text-xs text-muted">Custo da impressão</p>
              <Money value={result.cost_total} className="text-lg font-semibold" />
            </div>
            <div className={cn('rounded-lg border p-3', toNumber(result.cost_scrap) > 0 ? 'border-danger/30 bg-danger-soft/40' : 'border-line')}>
              <p className="text-xs text-muted">Custo de falhas</p>
              <Money value={result.cost_scrap} className={cn('text-lg font-semibold', toNumber(result.cost_scrap) > 0 && 'text-danger')} />
              <p className="text-xs text-muted">{totalFailed} peça(s) com falha</p>
            </div>
          </div>
        ) : totalFailed > 0 ? (
          <p className="text-sm text-danger">{totalFailed} peça(s) com falha registradas.</p>
        ) : null}
        <ul className="divide-y divide-line rounded-lg border border-line">
          {outputs.map((o) => {
            const good = counts[o.id]?.good ?? 0;
            const rel = released.get(o.id);
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-medium">{o.variant_name}</span>
                {good === 0 ? (
                  <Badge tone="danger">todas falharam</Badge>
                ) : rel ? (
                  <>
                    <Badge tone="success">
                      <PackageCheck className="size-3" /> {rel.qty_released} no estoque
                    </Badge>
                    {showCosts && rel.unit_cost !== null ? <Money value={rel.unit_cost} cost className="text-xs text-muted" /> : null}
                  </>
                ) : (
                  <Badge tone="info">{good} no acabamento</Badge>
                )}
              </li>
            );
          })}
        </ul>
        {showCosts ? (
          <p className="text-xs text-muted">
            Custo = gramas × custo médio do filamento + horas × taxa por hora, dividido entre as peças pelo peso previsto. O custo das peças com falha vai para
            “custo de falhas”.
          </p>
        ) : null}
      </div>
    </DialogContent>
  );
}

// -----------------------------------------------------------------------------
// Falha total (US-5.5)
// -----------------------------------------------------------------------------

export function FailJobDialog({ job, open, onOpenChange, onReplanned }: JobDialogProps & { onReplanned?: (jobId: number) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <FailLoader job={job} onClose={() => onOpenChange(false)} onReplanned={onReplanned} /> : null}
    </Dialog>
  );
}

function FailLoader({ job, onClose, onReplanned }: { job: PrintJobRow; onClose: () => void; onReplanned?: (jobId: number) => void }) {
  const materials = useJobMaterials(job.id);
  if (!materials.data) {
    return (
      <DialogContent title={`Falha em ${job.code}`}>
        <LoadingBlock rows={2} />
      </DialogContent>
    );
  }
  return <FailForm job={job} materials={materials.data} onClose={onClose} onReplanned={onReplanned} />;
}

function FailForm({ job, materials, onClose, onReplanned }: { job: PrintJobRow; materials: PrintJobMaterialRow[]; onClose: () => void; onReplanned?: (jobId: number) => void }) {
  const { can } = useMember();
  const [requestId, renew] = useRequestId();
  const [replanId, renewReplan] = useRequestId();
  // Sem o tempo real da impressora, parte do previsto pela ficha (editável); o tempo no quadro não conta.
  const initialMinutes = job.est_minutes;
  const [minutes, setMinutes] = useState<number | null>(initialMinutes);
  const [reason, setReason] = useState<FailureReason | ''>('');
  const [rows, setRows] = useState<MaterialState[]>(() => initialMaterials(materials, (m) => gramsUntilFailure(m.est_g, initialMinutes, job.est_minutes)));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloseResult | null>(null);
  const fail = useFailPrintJob();
  const replan = useReplanPrintJob((r) => {
    renewReplan();
    onClose();
    onReplanned?.(r.print_job_id);
  });

  const submit = () => {
    setError(null);
    if (!reason) return setError('Escolha o motivo da falha.');
    if (minutes === null) return setError('Informe quanto tempo imprimiu até falhar.');
    fail.mutate(
      {
        requestId,
        jobId: job.id,
        result: {
          actual_minutes: minutes,
          failure_reason: reason,
          materials: rows.map((r) => ({ item_id: r.item_id, actual_g: r.grams ?? '0', lot_id: r.lot ? Number(r.lot) : null })),
          notes: notes.trim() || null,
        },
      },
      {
        onSuccess: (r) => {
          renew();
          setResult(r);
        },
        onError: (e) => setError(describeError(e)),
      },
    );
  };

  if (result) {
    return (
      <DialogContent
        title={`${result.code}: falha registrada`}
        description={`${formatMinutes(result.minutes)} de máquina · motivo: ${reason ? FAILURE_REASON_LABELS[reason] : '—'}`}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Button onClick={() => replan.mutate({ requestId: replanId, jobId: job.id })} loading={replan.isPending}>
              Replanejar a mesma impressão
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Notice tone="warning" icon={<AlertTriangle />}>
            O filamento gasto foi baixado do estoque e as horas contam no horímetro da impressora. Nenhuma peça entrou no estoque.
          </Notice>
          {can('costs') ? (
            <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
              <p className="text-xs text-muted">Custo de falhas (despesa de produção do mês)</p>
              <Money value={result.cost_scrap} className="text-lg font-semibold text-danger" />
            </div>
          ) : null}
          <p className="text-sm text-ink-soft">“Replanejar” cria uma nova impressão planejada com as mesmas peças e quantidades.</p>
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent
      title={`Falha total em ${job.code}`}
      description="Nada aproveitável na mesa: o filamento gasto e o tempo vão para o custo de falhas."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" size="lg" onClick={submit} loading={fail.isPending}>
            Registrar falha
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Motivo da falha" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value as FailureReason)}>
            <option value="">Escolha…</option>
            {FAILURE_REASONS.map((r) => (
              <option key={r} value={r}>
                {FAILURE_REASON_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tempo até a falha" hint={`Previsto para a impressão inteira: ${formatMinutes(job.est_minutes)}`}>
          <DurationInput value={minutes} onChange={setMinutes} />
        </Field>
        <section className="space-y-2" aria-label="Filamento gasto">
          <h3 className="text-sm font-semibold">Filamento gasto até a falha</h3>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.item_id} className="flex items-center gap-3 rounded-lg border border-line p-3">
                <ColorDot hex={r.color_hex} className="size-5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted">previsto para a mesa inteira {formatQty(r.est_g, 'G')}</p>
                </div>
                <div className="w-32">
                  <DecimalInput
                    aria-label={`Gramas de ${r.name}`}
                    decimals={3}
                    suffix="g"
                    className="h-11 text-base"
                    value={r.grams}
                    onValueChange={(grams) => setRows((list) => list.map((x) => (x.item_id === r.item_id ? { ...x, grams } : x)))}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Sugestão proporcional ao tempo impresso. Pese o que sobrou na mesa, se puder.</p>
        </section>
        <Field label="Observações">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="min-h-14" />
        </Field>
        {error ? (
          <Notice tone="danger" icon={<XCircle />}>
            {error}
          </Notice>
        ) : null}
      </div>
    </DialogContent>
  );
}

// -----------------------------------------------------------------------------
// Cancelar (planejada ou em andamento)
// -----------------------------------------------------------------------------

export function CancelJobDialog({ job, open, onOpenChange, onDone }: JobDialogProps & { onDone?: () => void }) {
  const [requestId, renew] = useRequestId();
  const [reason, setReason] = useState('');
  const cancel = useCancelPrintJob(() => {
    renew();
    setReason('');
    onDone?.();
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Cancelar ${job.code}?`}
      description={
        job.status === 'IMPRIMINDO'
          ? 'A impressão sai do quadro sem baixar material nem contar horas. Se ela chegou a gastar filamento, use “Falha total”.'
          : 'A impressão planejada sai do quadro. Nada foi baixado do estoque.'
      }
      confirmLabel="Cancelar impressão"
      onConfirm={() => cancel.mutateAsync({ requestId, jobId: job.id, reason: reason.trim() || null })}
    >
      <Field label="Motivo (opcional)">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-14" />
      </Field>
    </ConfirmDialog>
  );
}
