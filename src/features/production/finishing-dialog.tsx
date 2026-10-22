import { CheckCircle2, Clock, PackageCheck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { LayerBar } from '@/components/charts/chart';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/states';
import {
  POST_PROCESS_KINDS,
  POST_PROCESS_LABELS,
  type PostProcessKind,
  type PrintJobOutputRow,
  type ReleaseResult,
  useBomLines,
  useOutput,
  usePostProcessEntries,
  useRecordPostProcess,
  useReleaseOutput,
} from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { formatCost, formatMinutes, formatQty, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { ChoiceChips, DurationInput, Notice, QtyStepper } from './bits';
import { formatWhen } from './helpers';

interface FinishingDialogProps {
  output: PrintJobOutputRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Acabamento e liberação de uma saída (US-5.6): minutos de trabalho por tipo e entrada no estoque. */
export function FinishingDialog({ output, open, onOpenChange }: FinishingDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open ? <FinishingContent output={output} onClose={() => onOpenChange(false)} /> : null}</Dialog>;
}

/** Custo unitário final por camada (LayerBar com as cores fixas do sistema). */
export function UnitCostLayers({ output }: { output: PrintJobOutputRow }) {
  if (output.unit_total === null) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        Custo unitário final <Money value={output.unit_total} cost className="font-semibold" />
      </p>
      <LayerBar
        format={(v) => formatCost(v, 4)}
        values={{
          material: toNumber(output.unit_material),
          energy: toNumber(output.unit_energy),
          depreciation: toNumber(output.unit_depreciation),
          operational: toNumber(output.unit_operational),
          labor: toNumber(output.unit_labor),
        }}
      />
      <p className="text-xs text-muted">Material inclui os componentes montados. Trabalho = minutos de acabamento × taxa de trabalho, dividido pelas aprovadas.</p>
    </div>
  );
}

function FinishingContent({ output, onClose }: { output: PrintJobOutputRow; onClose: () => void }) {
  const { can, today, settings } = useMember();
  const showCosts = can('costs');
  const good = output.qty_good ?? 0;
  const entries = usePostProcessEntries([output.id]);
  const bom = useBomLines(output.bom_version_id ? [output.bom_version_id] : []);
  const assembly = (bom.data ?? []).filter((l) => l.consumed_at === 'ASSEMBLY');
  const [workId, renewWork] = useRequestId();
  const [releaseId, renewRelease] = useRequestId();
  const [kind, setKind] = useState<PostProcessKind>(assembly.length > 0 ? 'MONTAGEM' : 'REMOCAO_SUPORTE');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [workNotes, setWorkNotes] = useState('');
  const [unvalued, setUnvalued] = useState(false);
  const [approved, setApproved] = useState(good);
  const [rejectReason, setRejectReason] = useState('');
  const [assembled, setAssembled] = useState(false);
  const [released, setReleased] = useState<ReleaseResult | null>(null);
  const record = useRecordPostProcess();
  const release = useReleaseOutput();
  const rejected = good - approved;
  const list = entries.data ?? [];
  const totalMinutes = list.reduce((s, e) => s + e.minutes, 0);
  const totalLabor = list.reduce((s, e) => s + toNumber(e.labor_cost), 0);

  const addWork = () => {
    if (!minutes || minutes <= 0) return;
    record.mutate(
      { requestId: workId, outputId: output.id, minutes, kind, notes: workNotes.trim() || null },
      {
        onSuccess: (r) => {
          renewWork();
          setMinutes(null);
          setWorkNotes('');
          setUnvalued(!r.labor_valued);
        },
      },
    );
  };

  const doRelease = () => {
    release.mutate(
      { requestId: releaseId, outputId: output.id, qtyApproved: approved, rejectReason: rejected > 0 ? rejectReason.trim() : null, rejectedAssembled: rejected > 0 && assembled },
      {
        onSuccess: (r) => {
          renewRelease();
          setReleased(r);
        },
      },
    );
  };

  if (released) return <ReleasedSummary output={output} result={released} onClose={onClose} showCosts={showCosts} />;

  return (
    <DialogContent
      title={`Acabamento — ${output.variant_name}`}
      description={`${output.print_job_code} · ${good} peça(s) boa(s) aguardando`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button size="lg" onClick={doRelease} loading={release.isPending} disabled={rejected > 0 && rejectReason.trim().length < 3}>
            <PackageCheck /> {approved > 0 ? `Liberar ${approved} peça(s)` : 'Encerrar sem aprovar'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3" aria-label="Trabalho de acabamento">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Wrench className="size-4 text-muted" aria-hidden /> Trabalho registrado
            </h3>
            <span className="text-xs text-muted">
              {formatMinutes(totalMinutes)} no total{showCosts && totalLabor > 0 ? ` · ` : ''}
              {showCosts && totalLabor > 0 ? <Money value={totalLabor} cost /> : null}
            </span>
          </div>
          {!entries.data ? (
            <Skeleton className="h-10" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted">Nenhum registro ainda. Registre os minutos de cada etapa (vários registros são somados).</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {list.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 font-medium">{POST_PROCESS_LABELS[e.kind]}</span>
                  <span className="num">{formatMinutes(e.minutes)}</span>
                  {showCosts ? <Money value={e.labor_cost} cost className="text-xs text-muted" /> : null}
                  <span className="w-full text-xs text-muted">
                    {formatWhen(e.performed_at, today(), settings.timezone)}
                    {e.notes ? ` · ${e.notes}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-3 rounded-lg bg-subtle p-3">
            <ChoiceChips label="Tipo de trabalho" options={POST_PROCESS_KINDS.map((k) => ({ value: k, label: POST_PROCESS_LABELS[k] }))} value={kind} onChange={setKind} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Minutos de trabalho" className="sm:w-56">
                <DurationInput value={minutes} onChange={setMinutes} />
              </Field>
              <Field label="Observação" className="flex-1">
                <Input value={workNotes} onChange={(e) => setWorkNotes(e.target.value)} maxLength={300} className="h-11" />
              </Field>
              <Button variant="outline" className="h-11" onClick={addWork} loading={record.isPending} disabled={!minutes}>
                <Clock /> Registrar
              </Button>
            </div>
            {unvalued && showCosts ? (
              <p className="text-xs text-warning">Sem taxa de trabalho vigente: os minutos ficam registrados, mas sem custo. Cadastre a taxa em Produção → Taxas.</p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3" aria-label="Liberar para o estoque">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <PackageCheck className="size-4 text-muted" aria-hidden /> Liberar para o estoque
          </h3>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Peças aprovadas</p>
              <p className="text-xs text-muted">de {good} boa(s) da impressão</p>
            </div>
            <QtyStepper label="peças aprovadas" value={approved} min={0} max={good} onChange={setApproved} />
          </div>
          {assembly.length > 0 ? (
            <p className="text-xs text-muted">
              Ao liberar, baixa do estoque para as aprovadas:{' '}
              {assembly.map((l) => `${formatQty(approved * toNumber(l.qty_per_unit) * (1 + toNumber(l.waste_pct)), l.unit)} de ${l.item_name}`).join(', ')}.
            </p>
          ) : null}
          {rejected > 0 ? (
            <div className="space-y-3 rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
              <Field label={`Motivo das ${rejected} reprovada(s)`} required hint="O custo de impressão delas vai para o custo de falhas.">
                <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} maxLength={300} className="min-h-14" />
              </Field>
              {assembly.length > 0 ? (
                <label className="flex items-start gap-2 text-sm text-ink-soft">
                  <Checkbox className="mt-0.5" checked={assembled} onChange={(e) => setAssembled(e.target.checked)} />
                  <span>Os componentes já estavam montados nas reprovadas (saem do estoque como perda)</span>
                </label>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </DialogContent>
  );
}

function ReleasedSummary({ output, result, onClose, showCosts }: { output: PrintJobOutputRow; result: ReleaseResult; onClose: () => void; showCosts: boolean }) {
  const fresh = useOutput(output.id);
  return (
    <DialogContent title={`${output.variant_name} liberada`} description={output.print_job_code} footer={<Button onClick={onClose}>Fechar</Button>}>
      <div className="space-y-4">
        <Notice tone="success" icon={<CheckCircle2 />}>
          {result.qty_released > 0 ? `${result.qty_released} peça(s) entraram no estoque de produtos prontos.` : 'Nenhuma peça aprovada: o custo foi para falhas.'}
          {result.qty_rejected > 0 ? ` ${result.qty_rejected} reprovada(s) no acabamento.` : ''}
        </Notice>
        {showCosts && result.qty_released > 0 ? fresh.data && fresh.data.status === 'LIBERADA' ? <UnitCostLayers output={fresh.data} /> : <Skeleton className="h-16" /> : null}
      </div>
    </DialogContent>
  );
}
