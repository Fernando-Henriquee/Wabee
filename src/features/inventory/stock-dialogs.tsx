import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select, Textarea } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { type ItemRow, LOT_STATUS_LABELS, type LotRow, useAdjustStock, useLots, useRegisterIssue, useRegisterOpening } from '@/data/inventory';
import { useMember } from '@/features/member/member-context';
import { describeError } from '@/lib/errors';
import { formatBRL, formatQty, toNumber, unitLabel } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';

interface DialogProps {
  item: ItemRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function lotLabel(lot: LotRow) {
  return `${lot.lot_code} — ${formatQty(lot.qty_remaining, 'G')} (${LOT_STATUS_LABELS[lot.status]?.toLowerCase()})`;
}

/** Saldo inicial (US-1.3): filamento por carretel (gramas restantes e custo por grama). */
export function OpeningBalanceDialog({ item, open, onOpenChange }: DialogProps) {
  const { settings } = useMember();
  const [requestId, renew] = useRequestId();
  const filament = item.kind === 'FILAMENT';
  const tool = item.kind === 'TOOL';
  const [entries, setEntries] = useState<Array<{ qty: string | null; cost: string | null }>>([{ qty: null, cost: null }]);
  const [error, setError] = useState<string | null>(null);
  const save = useRegisterOpening(() => {
    renew();
    setEntries([{ qty: null, cost: null }]);
    onOpenChange(false);
  });

  const submit = () => {
    setError(null);
    const valid = entries.filter((e) => toNumber(e.qty) > 0);
    if (valid.length === 0) return setError('Informe ao menos uma quantidade.');
    if (!filament && !tool && valid.some((e) => e.cost === null)) return setError('Informe o custo unitário.');
    // Filamento: o campo é custo por kg na tela; o banco guarda por grama.
    save.mutate({
      requestId,
      itemId: item.id,
      entries: valid.map((e) => ({ qty: e.qty!, unit_cost: e.cost === null ? null : filament ? String(toNumber(e.cost) / 1000) : e.cost })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Saldo inicial — ${item.name}`}
        description={filament ? 'Um carretel por linha, com os gramas que restam hoje.' : 'Quanto você tem hoje e quanto custou cada unidade.'}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={save.isPending}>
              Registrar saldo
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <div key={index} className="flex items-end gap-2">
              <Field label={filament ? `Carretel ${index + 1} (g)` : `Quantidade (${unitLabel(item.unit)})`} className="flex-1">
                <DecimalInput decimals={3} value={entry.qty} onValueChange={(qty) => setEntries((list) => list.map((e, i) => (i === index ? { ...e, qty } : e)))} />
              </Field>
              {!tool ? (
                <Field label={filament ? 'Custo por kg' : 'Custo unitário'} className="flex-1" hint={filament && index === 0 ? `Em branco: referência de ${formatBRL(toNumber(settings.filament_reference_cost_g) * 1000)}/kg` : undefined}>
                  <MoneyInput value={entry.cost} onValueChange={(cost) => setEntries((list) => list.map((e, i) => (i === index ? { ...e, cost } : e)))} />
                </Field>
              ) : null}
              {entries.length > 1 ? (
                <Button variant="ghost" size="icon" aria-label="Remover linha" onClick={() => setEntries((list) => list.filter((_, i) => i !== index))}>
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))}
          {filament ? (
            <Button variant="outline" size="sm" onClick={() => setEntries((list) => [...list, { qty: null, cost: list.at(-1)?.cost ?? null }])}>
              <Plus /> Outro carretel
            </Button>
          ) : null}
          {tool ? <p className="text-xs text-muted">Ferramentas não têm valor de estoque: são despesa na compra (o valor de aquisição fica no cadastro).</p> : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ISSUE_TYPES = [
  { value: 'LOSS', label: 'Perda (quebra, umidade, defeito)', hint: 'Vai para "ajustes e perdas" no resultado.' },
  { value: 'GIFT', label: 'Brinde', hint: 'Custo vai para Marketing.' },
  { value: 'SAMPLE', label: 'Amostra', hint: 'Custo vai para Marketing.' },
  { value: 'PERSONAL_USE', label: 'Uso pessoal do dono', hint: 'Vira retirada em bens do dono, não despesa.' },
  { value: 'CONSUMABLE_USE', label: 'Consumo (consumível)', hint: 'Despesa de consumíveis.' },
];

/** Saída avulsa (US-1.9): sai pelo custo médio, com motivo obrigatório. */
export function StockIssueDialog({ item, open, onOpenChange }: DialogProps) {
  const { can } = useMember();
  const [requestId, renew] = useRequestId();
  const filament = item.kind === 'FILAMENT';
  const lots = useLots(filament ? item.id : undefined, true);
  const types = ISSUE_TYPES.filter((t) => (t.value === 'CONSUMABLE_USE' ? item.kind === 'CONSUMABLE' : true)).filter((t) => can('write') || t.value === 'LOSS');
  const [type, setType] = useState(types[0]!.value);
  const [qty, setQty] = useState<string | null>(null);
  const [lotId, setLotId] = useState<string>('');
  const [reason, setReason] = useState('');
  const save = useRegisterIssue(() => {
    renew();
    setQty(null);
    setReason('');
    onOpenChange(false);
  });
  const selected = types.find((t) => t.value === type);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Saída avulsa — ${item.name}`}
        description={`Saldo livre: ${formatQty(item.qty_available, item.unit)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => save.mutate({ requestId, itemId: item.id, type, qty: qty ?? '0', reason: reason.trim(), lotId: lotId ? Number(lotId) : null })}
              loading={save.isPending}
              disabled={!qty || toNumber(qty) <= 0 || reason.trim().length < 3}
            >
              Registrar saída
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Tipo de saída" hint={selected?.hint}>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Quantidade (${unitLabel(item.unit)})`} required>
            <DecimalInput decimals={3} value={qty} onValueChange={setQty} />
          </Field>
          {filament && (lots.data?.length ?? 0) > 0 ? (
            <Field label="Carretel" hint="Em branco: sai do carretel aberto e, se acabar, do fechado mais antigo.">
              <Select value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">Automático</option>
                {lots.data!.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lotLabel(lot)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Motivo" required hint="Fica registrado no extrato e na auditoria.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Ajuste por contagem ou pesagem do carretel (US-1.7): restante = peso bruto − tara. */
export function AdjustStockDialog({ item, open, onOpenChange, initialLotId }: DialogProps & { initialLotId?: number }) {
  const [requestId, renew] = useRequestId();
  const filament = item.kind === 'FILAMENT';
  const lots = useLots(filament ? item.id : undefined, true);
  const [lotId, setLotId] = useState<string>(initialLotId ? String(initialLotId) : '');
  const [mode, setMode] = useState<'weight' | 'count'>(filament ? 'weight' : 'count');
  const [value, setValue] = useState<string | null>(null);
  const [reason, setReason] = useState(filament ? 'Pesagem do carretel' : 'Contagem');
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useAdjustStock(() => {
    renew();
    setValue(null);
    setConfirmLarge(false);
    onOpenChange(false);
  });
  const lot = lots.data?.find((l) => String(l.id) === lotId);
  const system = filament ? (lot ? toNumber(lot.qty_remaining) : null) : toNumber(item.qty_on_hand);
  const counted = value === null ? null : mode === 'weight' ? toNumber(value) - toNumber(item.empty_spool_tare_g) : toNumber(value);
  const diff = counted === null || system === null ? null : counted - system;

  const submit = () => {
    setError(null);
    save.mutate(
      {
        requestId,
        itemId: item.id,
        lotId: lotId ? Number(lotId) : null,
        countedQty: mode === 'count' ? value : null,
        grossWeight: mode === 'weight' ? value : null,
        reason: reason.trim(),
        confirmLarge,
      },
      {
        onError: (e) => {
          const message = describeError(e);
          if (/passa de 10%/.test(message)) {
            setConfirmLarge(true);
            setError(`${message} Clique em "Confirmar ajuste" para registrar mesmo assim.`);
          } else setError(message);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${filament ? 'Pesagem ou ajuste' : 'Ajuste de inventário'} — ${item.name}`}
        description="A diferença vira um ajuste de entrada ou saída, sempre com motivo."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={save.isPending} disabled={value === null || (filament && !lotId && (lots.data?.length ?? 0) > 0) || reason.trim().length < 3}>
              {confirmLarge ? 'Confirmar ajuste' : 'Registrar ajuste'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {filament && (lots.data?.length ?? 0) > 0 ? (
            <Field label="Carretel" required>
              <Select value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">Escolha o carretel…</option>
                {lots.data!.map((l) => (
                  <option key={l.id} value={l.id}>
                    {lotLabel(l)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {filament ? (
            <div role="radiogroup" aria-label="Como informar" className="inline-flex rounded-xl border border-line bg-subtle p-1">
              {[
                { key: 'weight', label: 'Peso na balança' },
                { key: 'count', label: 'Gramas restantes' },
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.key}
                  onClick={() => setMode(m.key as 'weight' | 'count')}
                  className={`h-8 rounded-lg px-3 text-sm font-medium ${mode === m.key ? 'bg-panel text-ink shadow-sm' : 'text-muted'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
          <Field
            label={mode === 'weight' ? 'Peso bruto (g), com o carretel' : `Quantidade contada (${unitLabel(item.unit)})`}
            hint={mode === 'weight' ? `Tara do carretel vazio: ${formatQty(item.empty_spool_tare_g ?? 0, 'G')} (cadastro do filamento)` : undefined}
            required
          >
            <DecimalInput decimals={3} value={value} onValueChange={(v) => {
              setValue(v);
              setConfirmLarge(false);
            }} />
          </Field>
          {system !== null && counted !== null ? (
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-subtle p-3 text-center text-sm">
              <div>
                <p className="text-xs text-muted">No sistema</p>
                <p className="num font-medium">{formatQty(system, item.unit)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Contado</p>
                <p className="num font-medium">{formatQty(counted, item.unit)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Diferença</p>
                <p className={`num font-semibold ${diff! < 0 ? 'text-danger' : diff! > 0 ? 'text-success' : ''}`}>
                  {diff! > 0 ? '+' : ''}
                  {formatQty(diff, item.unit)}
                </p>
              </div>
            </div>
          ) : null}
          <Field label="Motivo" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Field>
          {error ? (
            <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
