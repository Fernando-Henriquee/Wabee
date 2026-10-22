import { Info as InfoIcon, Split } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/money-input';
import { type CostRateRow, type EquipmentRow, RATE_TYPE_LABELS, RATE_TYPES, type RateType, rateUnit, useCreateCostRate, useSplitOperationalRate } from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { addDays, formatDateBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatCost, toNumber } from '@/lib/money';
import { Notice } from './bits';
import { latestRate } from './helpers';

export interface RateDraft {
  rateType: RateType;
  equipmentId: number | null;
  value?: string | null;
  source?: 'MANUAL' | 'CALCULATED';
  calcParams?: Record<string, unknown>;
  notes?: string;
}

/** Nova vigência (US-2.2): ao salvar, a anterior do mesmo tipo e escopo é encerrada no dia anterior. */
export function NewRateDialog({
  draft,
  open,
  onOpenChange,
  rates,
  equipment,
}: {
  draft: RateDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rates: CostRateRow[];
  equipment: EquipmentRow[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <NewRateForm draft={draft} rates={rates} equipment={equipment} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function NewRateForm({ draft, rates, equipment, onClose }: { draft: RateDraft; rates: CostRateRow[]; equipment: EquipmentRow[]; onClose: () => void }) {
  const { today } = useMember();
  const [type, setType] = useState<RateType>(draft.rateType);
  const [equipmentId, setEquipmentId] = useState<number | null>(draft.rateType === 'LABOR_PER_HOUR' ? null : draft.equipmentId);
  const [value, setValue] = useState<string | null>(draft.value ?? null);
  const [validFrom, setValidFrom] = useState(today());
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCostRate(() => onClose());
  const scope = type === 'LABOR_PER_HOUR' ? null : equipmentId;
  const current = latestRate(rates, type, scope);
  const calculated = draft.source === 'CALCULATED' && type === draft.rateType && toNumber(value) === toNumber(draft.value);

  const submit = () => {
    setError(null);
    if (value === null || toNumber(value) < 0) return setError('Informe o valor da taxa.');
    if (!validFrom) return setError('Informe a data de início.');
    create.mutate(
      {
        rateType: type,
        value,
        validFrom,
        equipmentId: scope,
        source: calculated ? 'CALCULATED' : 'MANUAL',
        calcParams: calculated ? draft.calcParams : {},
        notes: notes.trim() || null,
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  return (
    <DialogContent
      title="Nova vigência de taxa"
      description="Taxas não são editadas: cada mudança de valor é uma nova vigência a partir de uma data."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Salvar taxa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tipo de taxa" required>
          <Select
            value={type}
            onChange={(e) => {
              const next = e.target.value as RateType;
              setType(next);
              if (next === 'LABOR_PER_HOUR') setEquipmentId(null);
            }}
          >
            {RATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RATE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vale para" hint={type === 'LABOR_PER_HOUR' ? 'A taxa de trabalho é sempre global.' : 'A taxa de um equipamento vale antes da global.'}>
          <Select value={scope ?? ''} disabled={type === 'LABOR_PER_HOUR'} onChange={(e) => setEquipmentId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todos os equipamentos (global)</option>
            {equipment.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={`Valor (R$${rateUnit(type)})`} required>
            <DecimalInput decimals={6} prefix="R$" suffix={rateUnit(type)} value={value} onValueChange={setValue} className="pr-14" />
          </Field>
          <Field label="Início da vigência" required>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
        </div>
        <Field label="Observações">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="min-h-14" />
        </Field>
        {current ? (
          <Notice tone={validFrom && validFrom <= current.valid_from ? 'warning' : 'info'} icon={<InfoIcon />}>
            {validFrom && validFrom <= current.valid_from
              ? `Já existe ${formatCost(current.value, 6)}${rateUnit(type)} a partir de ${formatDateBR(current.valid_from)}: escolha uma data posterior.`
              : `A vigência atual (${formatCost(current.value, 6)}${rateUnit(type)} desde ${formatDateBR(current.valid_from)}) será encerrada em ${validFrom ? formatDateBR(addDays(validFrom, -1)) : '—'}.`}
            {current.used_by_jobs > 0 ? ` Ela já foi usada por ${current.used_by_jobs} impressão(ões), que mantêm o valor antigo.` : ''}
          </Notice>
        ) : null}
        {calculated ? <p className="text-xs text-muted">Valor da calculadora: fica registrado como “calculada”, com os parâmetros usados.</p> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </DialogContent>
  );
}

/** Divide a taxa combinada (ex.: R$ 1,20/h) em energia + depreciação a partir de uma data (US-2.5). */
export function SplitRateDialog({
  open,
  onOpenChange,
  combined,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  combined: CostRateRow;
  defaults: { energy: string | null; depreciation: string | null };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <SplitForm combined={combined} defaults={defaults} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function SplitForm({ combined, defaults, onClose }: { combined: CostRateRow; defaults: { energy: string | null; depreciation: string | null }; onClose: () => void }) {
  const { today } = useMember();
  const [validFrom, setValidFrom] = useState(today());
  const [energy, setEnergy] = useState<string | null>(defaults.energy);
  const [depreciation, setDepreciation] = useState<string | null>(defaults.depreciation);
  const [error, setError] = useState<string | null>(null);
  const split = useSplitOperationalRate(() => onClose());
  const sum = toNumber(energy) + toNumber(depreciation);
  const diff = sum - toNumber(combined.value);

  const submit = () => {
    setError(null);
    if (energy === null || depreciation === null) return setError('Informe energia e depreciação por hora.');
    if (validFrom <= combined.valid_from) return setError(`A divisão precisa começar depois de ${formatDateBR(combined.valid_from)}, início da taxa combinada.`);
    split.mutate({ validFrom, energyH: energy, depreciationH: depreciation, equipmentId: combined.equipment_id }, { onError: (e) => setError(describeError(e)) });
  };

  return (
    <DialogContent
      title="Dividir a taxa combinada"
      description={`Hoje: ${formatCost(combined.value, 6)}/h combinada${combined.equipment_name ? ` (${combined.equipment_name})` : ' (global)'}. A partir da data escolhida, o custo passa a mostrar energia e depreciação separadas.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={split.isPending}>
            <Split /> Dividir a partir desta data
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="A partir de" required>
          <Input type="date" value={validFrom} min={addDays(combined.valid_from, 1)} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Energia (R$/h)" required hint="W ÷ 1000 × R$/kWh (use a calculadora).">
            <DecimalInput decimals={6} prefix="R$" suffix="/h" className="pr-12" value={energy} onValueChange={setEnergy} />
          </Field>
          <Field label="Depreciação (R$/h)" required hint="(Valor − residual) ÷ vida útil.">
            <DecimalInput decimals={6} prefix="R$" suffix="/h" className="pr-12" value={depreciation} onValueChange={setDepreciation} />
          </Field>
        </div>
        <p className="rounded-lg bg-subtle px-3 py-2 text-sm">
          Soma <strong className="num">{formatCost(sum, 6)}/h</strong>{' '}
          <span className={diff > 0 ? 'text-warning' : 'text-muted'}>
            ({diff === 0 ? 'igual à combinada' : `${diff > 0 ? '+' : '−'}${formatCost(Math.abs(diff), 6)}/h em relação à combinada`})
          </span>
        </p>
        <p className="text-xs text-muted">A taxa combinada é encerrada no dia anterior; impressões já finalizadas continuam com o valor da data delas.</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </DialogContent>
  );
}
