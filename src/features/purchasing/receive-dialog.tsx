import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ColorDot } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import {
  EQUIPMENT_KIND_LABELS,
  type EquipmentKind,
  isReceivable,
  type PurchaseLineRow,
  type PurchaseRow,
  type ReceiveLineInput,
  useReceivePurchase,
} from '@/data/purchasing';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatQty, toNumber, unitLabel } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { Callout } from './purchase-bits';
import { Segmented } from './segmented';

interface EquipmentForm {
  name: string;
  kind: EquipmentKind;
  useful_life_hours: string | null;
  avg_power_w: string | null;
  initial_hours: string | null;
  maintenance_interval_hours: string | null;
  residual_value: string | null;
}

interface LineState {
  include: boolean;
  qty: string | null;
  spoolMode: 'count' | 'grams';
  spoolCount: string | null;
  spools: Array<string | null>;
  equipment: EquipmentForm;
}

function round3(n: number) {
  return String(Math.round(n * 1000) / 1000);
}

/** Tipo sugerido pela descrição da linha (editável). */
function guessEquipmentKind(description: string): EquipmentKind {
  if (/secador|secadora|dryer|desumidificador/i.test(description)) return 'DRYER';
  if (/impressora|printer|bambu|prusa|ender|creality|elegoo|anycubic/i.test(description)) return 'PRINTER';
  if (/lixadeira|esta[cç][aã]o de cura|cura uv|wash|lavadora|p[oó]s[- ]?process/i.test(description)) return 'POST_PROCESS';
  return 'OTHER';
}

function initialState(line: PurchaseLineRow, opening: boolean, pending: number): LineState {
  const nominal = toNumber(line.nominal_spool_g) || 1000;
  const count = Math.max(1, Math.round(pending / nominal));
  const each = pending / count;
  return {
    include: true,
    qty: round3(pending),
    // Compra antiga: cada carretel tem um resto diferente, então por padrão informa os gramas de cada um.
    spoolMode: opening ? 'grams' : 'count',
    spoolCount: String(count),
    spools: Array.from({ length: count }, () => round3(each)),
    equipment: {
      name: line.description.slice(0, 70),
      kind: guessEquipmentKind(line.description),
      useful_life_hours: null,
      avg_power_w: null,
      initial_hours: '0',
      maintenance_interval_hours: null,
      residual_value: null,
    },
  };
}

interface Props {
  purchase: PurchaseRow;
  lines: PurchaseLineRow[];
  /** "confirm": confirmar e receber numa transação (compra em rascunho). */
  mode: 'receive' | 'confirm';
  onOpenChange: (open: boolean) => void;
  /** Compra anterior ao sistema confirmada aqui: parcelas já pagas. */
  paidCount?: number;
  installmentsCount?: number;
  onPaidCountChange?: (value: number) => void;
}

/**
 * Recebimento (US-3.5): quantidade pendente já preenchida (parcial é permitido); filamento em
 * N carretéis (N lotes) ou gramas por carretel; equipamento com vida útil, potência e horas.
 * Despesas não passam por aqui. Monte com `key` para reiniciar.
 */
export function ReceiveDialog({ purchase, lines, mode, onOpenChange, paidCount, installmentsCount, onPaidCountChange }: Props) {
  const { today } = useMember();
  const [requestId, renew] = useRequestId();
  const opening = purchase.is_opening;
  const receivable = lines.filter((l) => isReceivable(l));
  const pendingOf = (l: PurchaseLineRow) => (mode === 'confirm' ? toNumber(l.qty) : toNumber(l.qty_pending));
  const open = receivable.filter((l) => pendingOf(l) > 0);
  const done = receivable.filter((l) => pendingOf(l) <= 0);
  const skipped = lines.filter((l) => !isReceivable(l));
  const [state, setState] = useState<Record<number, LineState>>(() => Object.fromEntries(open.map((l) => [l.id, initialState(l, opening, pendingOf(l))])));
  const [receivedOn, setReceivedOn] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const receive = useReceivePurchase(() => {
    renew();
    onOpenChange(false);
  });

  const patch = (id: number, next: Partial<LineState>) => setState((s) => ({ ...s, [id]: { ...s[id]!, ...next } }));
  const patchEquipment = (id: number, next: Partial<EquipmentForm>) => setState((s) => ({ ...s, [id]: { ...s[id]!, equipment: { ...s[id]!.equipment, ...next } } }));

  const lineQtyOf = (l: PurchaseLineRow, st: LineState) =>
    l.item_kind === 'FILAMENT' && st.spoolMode === 'grams' ? st.spools.reduce((sum, g) => sum + toNumber(g), 0) : toNumber(st.qty);

  const problems: string[] = [];
  const payload: ReceiveLineInput[] = [];
  for (const l of open) {
    const st = state[l.id];
    if (!st || !st.include) continue;
    const qty = lineQtyOf(l, st);
    const pending = pendingOf(l);
    const label = l.item_name ?? l.description;
    if (qty <= 0) problems.push(`${label}: informe a quantidade recebida.`);
    else if (!opening && qty > pending + 1e-9) problems.push(`${label}: só ${formatQty(pending, l.unit ?? 'UN')} pendente(s).`);
    if (l.line_kind === 'EQUIPMENT') {
      if (!Number.isInteger(qty)) problems.push(`${label}: equipamentos são recebidos em unidades inteiras.`);
      if (!st.equipment.name.trim()) problems.push(`${label}: dê um nome ao equipamento.`);
      if (toNumber(st.equipment.residual_value) > toNumber(l.landed_total) / Math.max(toNumber(l.qty), 1)) problems.push(`${label}: o valor residual passa do valor do bem.`);
      payload.push({
        line_id: l.id,
        qty: String(qty),
        equipment: {
          name: st.equipment.name.trim(),
          kind: st.equipment.kind,
          useful_life_hours: st.equipment.useful_life_hours,
          avg_power_w: st.equipment.avg_power_w,
          initial_hours: st.equipment.initial_hours,
          maintenance_interval_hours: st.equipment.maintenance_interval_hours,
          residual_value: st.equipment.residual_value,
        },
      });
    } else if (l.item_kind === 'FILAMENT') {
      if (st.spoolMode === 'grams') {
        if (st.spools.length === 0 || st.spools.some((g) => toNumber(g) <= 0)) problems.push(`${label}: informe os gramas de cada carretel.`);
        payload.push({ line_id: l.id, spools: st.spools.map((g) => g ?? '0') });
      } else {
        const count = toNumber(st.spoolCount);
        if (!Number.isInteger(count) || count < 1) problems.push(`${label}: informe o número de carretéis.`);
        payload.push({ line_id: l.id, qty: String(qty), spool_count: count });
      }
    } else {
      payload.push({ line_id: l.id, qty: String(qty) });
    }
  }
  if (payload.length === 0 && open.length > 0) problems.push('Marque ao menos uma linha para receber.');
  if (receivedOn > today()) problems.push('A data do recebimento não pode ser no futuro.');

  const submit = () => {
    setError(null);
    if (problems.length > 0) return setError(problems[0]!);
    receive.mutate(
      {
        requestId,
        purchaseId: purchase.id,
        lines: payload,
        // Hoje: horário do servidor. Outro dia: meio-dia (não muda de data em nenhum fuso do Brasil).
        receivedAt: receivedOn === today() ? null : `${receivedOn}T12:00:00-03:00`,
        confirm: mode === 'confirm',
        paidCount: paidCount ?? 0,
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  const title = mode === 'confirm' ? `Confirmar e receber ${purchase.number}` : `Receber ${purchase.number}`;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        title={title}
        description={mode === 'confirm' ? 'Cria a conta a pagar e dá entrada no estoque de uma vez (uma única operação).' : 'Quantidade pendente já preenchida; dá para receber só uma parte agora.'}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={receive.isPending} disabled={open.length === 0 && mode === 'receive'}>
              {mode === 'confirm' ? 'Confirmar e receber' : 'Registrar recebimento'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {opening ? (
            <Callout tone="info" title="Compra anterior ao sistema">
              Informe o que <strong>resta hoje</strong> de cada item — não o que foi comprado. O que já foi usado antes do sistema não entra no estoque e a linha fica totalmente
              recebida. Os carretéis entram como saldo inicial com o custo da compra.
            </Callout>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Data do recebimento" required>
              <Input type="date" value={receivedOn} max={today()} onChange={(e) => setReceivedOn(e.target.value)} />
            </Field>
            {mode === 'confirm' && opening && onPaidCountChange ? (
              <Field label="Parcelas já pagas" hint={`De ${installmentsCount ?? 0}; baixadas na data de cada vencimento.`}>
                <DecimalInput decimals={0} value={String(paidCount ?? 0)} onValueChange={(v) => onPaidCountChange(Math.trunc(toNumber(v)))} />
              </Field>
            ) : null}
          </div>

          {open.length === 0 ? <p className="text-sm text-muted">Nada pendente de recebimento nesta compra.</p> : null}

          <ul className="space-y-3">
            {open.map((l) => {
              const st = state[l.id]!;
              const pending = pendingOf(l);
              const filament = l.item_kind === 'FILAMENT';
              const qty = lineQtyOf(l, st);
              const unitValue = toNumber(l.landed_total) / Math.max(toNumber(l.qty), 1);
              return (
                <li key={l.id} className={cn('rounded-[var(--radius-card)] border border-line bg-panel p-3', !st.include && 'opacity-60')}>
                  <label className="flex min-h-10 items-start gap-2.5">
                    <Checkbox className="mt-1" checked={st.include} onChange={(e) => patch(l.id, { include: e.target.checked })} aria-label={`Receber ${l.item_name ?? l.description}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {filament ? <ColorDot hex={l.color_hex} /> : null}
                        <span className="truncate">{l.item_name ?? l.description}</span>
                      </span>
                      <span className="block text-xs text-muted">
                        {l.line_kind === 'EQUIPMENT' ? 'Equipamento' : l.sku} · comprado {formatQty(l.qty, l.unit ?? 'UN')}
                        {toNumber(l.qty_received) > 0 ? ` · já recebido ${formatQty(l.qty_received, l.unit ?? 'UN')}` : ''} · pendente {formatQty(pending, l.unit ?? 'UN')}
                      </span>
                    </span>
                  </label>

                  {st.include ? (
                    <div className="mt-3 space-y-3 sm:pl-7">
                      {filament ? (
                        <>
                          <Segmented
                            label="Como informar os carretéis"
                            value={st.spoolMode}
                            onChange={(mode) => patch(l.id, { spoolMode: mode })}
                            options={[
                              { value: 'count', label: 'Nº de carretéis' },
                              { value: 'grams', label: 'Gramas por carretel' },
                            ]}
                          />
                          {st.spoolMode === 'count' ? (
                            <div className="grid grid-cols-2 gap-3">
                              <Field label={opening ? 'Resta hoje (g)' : 'Gramas recebidos'}>
                                <DecimalInput decimals={3} suffix="g" value={st.qty} onValueChange={(v) => patch(l.id, { qty: v })} />
                              </Field>
                              <Field label="Carretéis (lotes)" hint={toNumber(st.spoolCount) > 0 ? `${formatQty(qty / toNumber(st.spoolCount), 'G')} cada` : undefined}>
                                <DecimalInput decimals={0} value={st.spoolCount} onValueChange={(v) => patch(l.id, { spoolCount: v })} />
                              </Field>
                            </div>
                          ) : (
                            <div>
                              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {st.spools.map((g, i) => (
                                  <li key={i} className="flex items-end gap-1">
                                    <Field label={`Carretel ${i + 1}`} className="min-w-0 flex-1">
                                      <DecimalInput
                                        decimals={3}
                                        suffix="g"
                                        value={g}
                                        onValueChange={(v) => patch(l.id, { spools: st.spools.map((x, j) => (j === i ? v : x)) })}
                                      />
                                    </Field>
                                    {st.spools.length > 1 ? (
                                      <Button type="button" variant="ghost" size="icon" aria-label={`Remover carretel ${i + 1}`} onClick={() => patch(l.id, { spools: st.spools.filter((_, j) => j !== i) })}>
                                        <Trash2 />
                                      </Button>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <Button type="button" size="sm" className="h-10 sm:h-8" variant="outline" onClick={() => patch(l.id, { spools: [...st.spools, String(toNumber(l.nominal_spool_g) || 1000)] })}>
                                  <Plus /> Carretel
                                </Button>
                                <span className="text-xs text-muted">
                                  Total {formatQty(qty, 'G')} em {st.spools.length} lote(s)
                                </span>
                              </div>
                            </div>
                          )}
                        </>
                      ) : l.line_kind === 'EQUIPMENT' ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field label="Nome do equipamento" required hint={qty > 1 ? 'Com mais de uma unidade, cada uma recebe um número no fim do nome.' : undefined}>
                            <Input value={st.equipment.name} onChange={(e) => patchEquipment(l.id, { name: e.target.value })} maxLength={70} />
                          </Field>
                          <Field label="Valor do bem (por unidade)" hint="Com frete rateado e sem juros (não editável).">
                            <MoneyInput value={unitValue.toFixed(2)} onValueChange={() => undefined} readOnly disabled />
                          </Field>
                          <Field label="Tipo">
                            <Select value={st.equipment.kind} onChange={(e) => patchEquipment(l.id, { kind: e.target.value as EquipmentKind })}>
                              {(Object.keys(EQUIPMENT_KIND_LABELS) as EquipmentKind[]).map((k) => (
                                <option key={k} value={k}>
                                  {EQUIPMENT_KIND_LABELS[k]}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Unidades recebidas">
                            <DecimalInput decimals={0} suffix="un" value={st.qty} onValueChange={(v) => patch(l.id, { qty: v })} />
                          </Field>
                          <Field label="Vida útil (horas)" hint="Ex.: 5.000 h. Base da depreciação por hora.">
                            <DecimalInput decimals={0} suffix="h" value={st.equipment.useful_life_hours} onValueChange={(v) => patchEquipment(l.id, { useful_life_hours: v })} />
                          </Field>
                          <Field label="Potência média (W)" hint="Para o custo de energia das impressões.">
                            <DecimalInput decimals={0} suffix="W" value={st.equipment.avg_power_w} onValueChange={(v) => patchEquipment(l.id, { avg_power_w: v })} />
                          </Field>
                          <Field label="Horas já usadas" hint={opening ? 'Horas de uso antes do sistema.' : 'Novo: 0.'}>
                            <DecimalInput decimals={1} suffix="h" value={st.equipment.initial_hours} onValueChange={(v) => patchEquipment(l.id, { initial_hours: v })} />
                          </Field>
                          <Field label="Manutenção a cada (horas)">
                            <DecimalInput decimals={0} suffix="h" value={st.equipment.maintenance_interval_hours} onValueChange={(v) => patchEquipment(l.id, { maintenance_interval_hours: v })} />
                          </Field>
                          <Field label="Valor residual" hint="Quanto valerá no fim da vida útil (opcional).">
                            <MoneyInput value={st.equipment.residual_value} onValueChange={(v) => patchEquipment(l.id, { residual_value: v })} />
                          </Field>
                        </div>
                      ) : (
                        <Field label={opening ? `Resta hoje (${unitLabel(l.unit)})` : `Quantidade recebida (${unitLabel(l.unit)})`} className="sm:max-w-xs">
                          <DecimalInput decimals={3} suffix={unitLabel(l.unit)} value={st.qty} onValueChange={(v) => patch(l.id, { qty: v })} />
                        </Field>
                      )}
                      {!opening && qty > 0 && qty < pending ? <p className="text-xs text-warning">Recebimento parcial: ficam {formatQty(pending - qty, l.unit ?? 'UN')} pendentes.</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {done.length > 0 ? (
            <p className="text-xs text-muted">Já recebido: {done.map((l) => l.item_name ?? l.description).join(', ')}.</p>
          ) : null}
          {skipped.length > 0 ? (
            <div className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
              <p className="font-medium text-ink-soft">Não passam por recebimento (despesa na data da compra):</p>
              <ul className="mt-1 space-y-0.5">
                {skipped.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span className="truncate">{l.item_name ?? l.description}</span>
                    <Money value={l.landed_total} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {mode === 'confirm' ? <p className="text-xs text-muted">Compra de {formatDateBR(purchase.purchased_at)}; as parcelas seguem o que foi definido no rascunho.</p> : null}
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
