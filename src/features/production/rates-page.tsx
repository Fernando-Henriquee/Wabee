import { ArrowLeft, Calculator, Lock, Plus, Split, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/states';
import {
  type CostRateRow,
  type EquipmentRow,
  RATE_MODE_LABELS,
  RATE_TYPE_LABELS,
  RATE_TYPES,
  type RateType,
  rateUnit,
  useCostRates,
  useEquipmentList,
  useRates,
} from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import { formatCost, formatNumber, toNumber } from '@/lib/money';
import { ChoiceChips } from './bits';
import { latestRate } from './helpers';
import { NewRateDialog, type RateDraft, SplitRateDialog } from './rate-dialogs';

const RATE_HINTS: Record<RateType, string> = {
  ENERGY_PRICE_KWH: 'Tarifa da conta de luz. Com a potência do equipamento, vira energia por hora.',
  ENERGY_PER_HOUR: 'Quanto a máquina gasta de luz por hora imprimindo.',
  DEPRECIATION_PER_HOUR: 'Desgaste da máquina por hora de uso.',
  OPERATIONAL_PER_HOUR: 'Energia + depreciação juntas, quando ainda não estão separadas.',
  MAINTENANCE_PER_HOUR: 'Reserva para peças de manutenção (informativa).',
  LABOR_PER_HOUR: 'Valor da hora de trabalho no acabamento (sempre global).',
};

const PARAM_LABELS: Record<string, string> = {
  potencia_w: 'Potência',
  tarifa_kwh: 'Tarifa',
  valor_aquisicao: 'Valor de aquisição',
  valor_residual: 'Residual',
  vida_util_h: 'Vida útil',
  origem: 'Origem',
};

function describeParams(params: Record<string, unknown>): string {
  return Object.entries(params ?? {})
    .map(([key, value]) => {
      const label = PARAM_LABELS[key] ?? key;
      if (key === 'potencia_w') return `${label} ${formatNumber(value as number, 0)} W`;
      if (key === 'vida_util_h') return `${label} ${formatNumber(value as number, 0)} h`;
      if (key === 'tarifa_kwh') return `${label} ${formatCost(value as number, 4)}/kWh`;
      if (typeof value === 'number') return `${label} ${formatCost(value, 2)}`;
      return `${label}: ${String(value)}`;
    })
    .join(' · ');
}

export function RatesPage() {
  const { can } = useMember();
  if (!can('costs')) {
    return (
      <Page>
        <EmptyState title="Sem acesso às taxas" description="As taxas mostram valores em reais, que o seu perfil não vê." />
      </Page>
    );
  }
  return <Rates />;
}

function Rates() {
  const { can } = useMember();
  const [params, setParams] = useSearchParams();
  const rates = useCostRates();
  const equipment = useEquipmentList();
  const scopeParam = Number(params.get('equipamento'));
  const scope = scopeParam > 0 ? scopeParam : null;
  const [draft, setDraft] = useState<RateDraft | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [calcEnergy, setCalcEnergy] = useState<string | null>(null);
  const [calcDep, setCalcDep] = useState<string | null>(null);
  const list = useMemo(() => rates.data ?? [], [rates.data]);
  const machines = equipment.data ?? [];
  const setScope = (value: string) => {
    const updated = new URLSearchParams(params);
    if (value === 'global') updated.delete('equipamento');
    else updated.set('equipamento', value);
    setParams(updated, { replace: true });
  };

  if (rates.isError) return <Page><ErrorState error={rates.error} onRetry={() => void rates.refetch()} /></Page>;
  if (!rates.data || !equipment.data) return <Page><LoadingBlock /></Page>;

  const scoped = list.filter((r) => (r.equipment_id ?? null) === scope);
  const types = scope === null ? RATE_TYPES : RATE_TYPES.filter((t) => t !== 'LABOR_PER_HOUR');
  const combined = latestRate(list, 'OPERATIONAL_PER_HOUR', scope);
  const scopeName = scope === null ? 'Global' : (machines.find((m) => m.id === scope)?.name ?? `Equipamento ${scope}`);
  // Sugestão para a divisão: calculadoras (se usadas) ou o cadastro do equipamento do escopo.
  const machine = machines.find((m) => m.id === scope) ?? machines.find((m) => m.kind === 'PRINTER');
  const tariff = latestRate(list, 'ENERGY_PRICE_KWH', null);
  const derivedEnergy = machine?.avg_power_w && tariff ? String(Math.round((machine.avg_power_w / 1000) * toNumber(tariff.value) * 1_000_000) / 1_000_000) : null;
  const derivedDep =
    machine?.useful_life_hours && toNumber(machine.acquisition_cost) > 0
      ? String(Math.round(((toNumber(machine.acquisition_cost) - toNumber(machine.residual_value)) / machine.useful_life_hours) * 1_000_000) / 1_000_000)
      : null;
  const withOwnRates = new Set(list.map((r) => r.equipment_id).filter((id): id is number => id !== null));

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/producao" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Produção
          </Link>
        }
        title="Taxas de custo"
        description="Valores por hora com vigência: cada impressão usa as taxas do dia em que terminou."
        actions={
          can('write') ? (
            <Button onClick={() => setDraft({ rateType: 'OPERATIONAL_PER_HOUR', equipmentId: scope })}>
              <Plus /> Nova taxa
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Como as taxas entram no custo" />
          <div className="space-y-2 p-4 text-sm text-ink-soft">
            <p>
              <strong className="text-ink">Custo de uma impressão</strong> = Σ gramas × custo médio por grama do filamento + horas de máquina × taxa por hora.
            </p>
            <p>Peças da mesma mesa dividem o custo pelo peso previsto × quantidade; o custo das peças com falha vai para “custo de falhas”.</p>
            <p>
              A taxa por hora pode ser <strong className="text-ink">combinada</strong> (energia + depreciação juntas, como os R$ 1,20/h de hoje) ou{' '}
              <strong className="text-ink">separada</strong> em energia e depreciação. Uma taxa do equipamento vale antes da global.
            </p>
            <p className="inline-flex items-start gap-1.5 text-xs text-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Taxas não são editadas: uma taxa usada por impressões fica como está, para o custo delas não mudar. Para mudar o valor, crie uma nova vigência — a anterior é encerrada
              no dia anterior.
            </p>
          </div>
        </Card>
        <TodayCard machines={machines.filter((m) => m.kind === 'PRINTER' && m.status !== 'BAIXADO')} />
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ChoiceChips
          label="Escopo das taxas"
          value={scope === null ? 'global' : String(scope)}
          onChange={setScope}
          options={[
            { value: 'global', label: 'Global' },
            ...machines.map((m) => ({ value: String(m.id), label: `${m.name}${withOwnRates.has(m.id) ? ' •' : ''}` })),
          ]}
        />
        {scope !== null ? <p className="text-xs text-muted">Sem taxa própria, {scopeName} usa a global.</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {types.map((type) => (
          <RateTimeline
            key={type}
            type={type}
            rows={scoped.filter((r) => r.rate_type === type)}
            onNew={can('write') ? () => setDraft({ rateType: type, equipmentId: scope }) : undefined}
          />
        ))}
      </div>

      {can('write') ? (
        <>
          <h2 className="mb-3 mt-6 inline-flex items-center gap-2 text-lg">
            <Calculator className="size-5 text-muted" aria-hidden /> Calculadoras
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <EnergyCalculator
              machines={machines}
              rates={list}
              initialEquipment={scope}
              onResult={setCalcEnergy}
              onSave={(d) => setDraft(d)}
            />
            <DepreciationCalculator machines={machines} initialEquipment={scope} onResult={setCalcDep} onSave={(d) => setDraft(d)} />
          </div>
          {combined ? (
            <Card className="mt-4">
              <CardHeader
                title="Dividir a taxa combinada"
                description={`${scopeName}: ${formatCost(combined.value, 6)}/h desde ${formatDateBR(combined.valid_from)}. Separe em energia + depreciação a partir de uma data.`}
                actions={
                  <Button variant="outline" onClick={() => setSplitOpen(true)}>
                    <Split /> Dividir
                  </Button>
                }
              />
              <p className="px-4 py-3 text-xs text-muted">
                Enquanto a taxa combinada estiver vigente, ela é a usada no custo. Criar só a energia ou só a depreciação não a substitui: use a divisão, que cria as duas e encerra a
                combinada numa única operação. Os valores das calculadoras acima entram como sugestão.
              </p>
            </Card>
          ) : null}
        </>
      ) : null}

      {draft ? <NewRateDialog draft={draft} open onOpenChange={(o) => !o && setDraft(null)} rates={list} equipment={machines.filter((m) => m.status !== 'BAIXADO')} /> : null}
      {combined ? <SplitRateDialog open={splitOpen} onOpenChange={setSplitOpen} combined={combined} defaults={{ energy: calcEnergy ?? derivedEnergy, depreciation: calcDep ?? derivedDep }} /> : null}
    </Page>
  );
}

function TodayCard({ machines }: { machines: EquipmentRow[] }) {
  return (
    <Card>
      <CardHeader title="Vigente hoje" description="O que entra no custo de uma impressão terminada hoje." />
      <ul className="divide-y divide-line">
        {machines.length === 0 ? <li className="p-4 text-sm text-muted">Nenhuma impressora cadastrada.</li> : null}
        {machines.map((m) => (
          <TodayRow key={m.id} machine={m} />
        ))}
      </ul>
    </Card>
  );
}

function TodayRow({ machine }: { machine: EquipmentRow }) {
  const { today } = useMember();
  const rates = useRates(machine.id, today());
  const r = rates.data;
  const perHour = r ? toNumber(r.energy_h) + toNumber(r.depreciation_h) + toNumber(r.operational_h) : 0;
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{machine.name}</span>
        {r ? <span className={cn('num font-semibold', r.mode === 'MISSING' && 'text-warning')}>{r.mode === 'MISSING' ? 'sem taxa' : `${formatCost(perHour, 4)}/h`}</span> : <Skeleton className="h-5 w-16" />}
      </div>
      {r ? (
        <p className="text-xs text-muted">
          {RATE_MODE_LABELS[r.mode]}
          {r.mode === 'SPLIT' ? `: energia ${formatCost(r.energy_h, 4)} + depreciação ${formatCost(r.depreciation_h, 4)}` : ''}
          {toNumber(r.labor_h) > 0 ? ` · trabalho ${formatCost(r.labor_h, 2)}/h` : ''}
          {r.fully_depreciated ? ' · depreciação zerada (vida útil atingida)' : ''}
        </p>
      ) : null}
    </li>
  );
}

function RateTimeline({ type, rows, onNew }: { type: RateType; rows: CostRateRow[]; onNew?: () => void }) {
  const current = rows.find((r) => r.is_current);
  return (
    <Card>
      <CardHeader
        title={RATE_TYPE_LABELS[type]}
        description={RATE_HINTS[type]}
        actions={
          onNew ? (
            <Button size="sm" variant="ghost" onClick={onNew}>
              <Plus /> Nova vigência
            </Button>
          ) : undefined
        }
      />
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Sem taxa cadastrada.</p>
        ) : (
          <ol className="relative ml-1.5 space-y-3 border-l-2 border-line pl-4">
            {rows.map((r) => (
              <li key={r.id} className="relative">
                <span
                  className={cn('absolute -left-[1.4rem] top-1.5 size-3 rounded-full ring-2 ring-panel', r.id === current?.id ? 'bg-accent' : r.valid_to ? 'bg-line-strong' : 'bg-info')}
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="num text-base font-semibold">
                    {formatCost(r.value, 6)}
                    <span className="text-xs font-normal text-muted">{rateUnit(type)}</span>
                  </span>
                  {r.id === current?.id ? <Badge tone="accent">vigente</Badge> : !r.valid_to ? <Badge tone="info">futura</Badge> : null}
                  {r.source === 'CALCULATED' ? <Badge tone="neutral">calculada</Badge> : null}
                  {r.used_by_jobs > 0 ? (
                    <Badge tone="neutral" title="Usada no custo de impressões: não pode ser alterada">
                      <Lock className="size-3" aria-hidden /> {r.used_by_jobs} impressão(ões)
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted">
                  {r.valid_to ? `${formatDateBR(r.valid_from)} a ${formatDateBR(r.valid_to)}` : `desde ${formatDateBR(r.valid_from)}`}
                  {r.notes ? ` · ${r.notes}` : ''}
                </p>
                {r.calc_params && Object.keys(r.calc_params).length > 0 ? <p className="text-xs text-muted">{describeParams(r.calc_params)}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function MachineSelect({ machines, value, onChange }: { machines: EquipmentRow[]; value: number | null; onChange: (machine: EquipmentRow | null) => void }) {
  return (
    <Field label="Equipamento">
      <Select value={value ?? ''} onChange={(e) => onChange(machines.find((m) => String(m.id) === e.target.value) ?? null)}>
        <option value="">— digitar os valores —</option>
        {machines.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** US-2.3: energia por hora = W ÷ 1000 × R$/kWh. */
function EnergyCalculator({
  machines,
  rates,
  initialEquipment,
  onResult,
  onSave,
}: {
  machines: EquipmentRow[];
  rates: CostRateRow[];
  initialEquipment: number | null;
  onResult: (value: string | null) => void;
  onSave: (draft: RateDraft) => void;
}) {
  const initial = machines.find((m) => m.id === initialEquipment) ?? machines.find((m) => m.kind === 'PRINTER') ?? null;
  const tariff = latestRate(rates, 'ENERGY_PRICE_KWH', null);
  const [machineId, setMachineId] = useState<number | null>(initial?.id ?? null);
  const [watts, setWatts] = useState<string | null>(initial?.avg_power_w ? String(initial.avg_power_w) : null);
  const [price, setPrice] = useState<string | null>(tariff ? String(tariff.value) : null);
  const result = watts && price ? (toNumber(watts) / 1000) * toNumber(price) : null;
  const resultText = result === null ? null : String(Math.round(result * 1_000_000) / 1_000_000);
  const update = (w: string | null, p: string | null) => onResult(w && p ? String(Math.round((toNumber(w) / 1000) * toNumber(p) * 1_000_000) / 1_000_000) : null);

  return (
    <Card>
      <CardHeader title="Energia por hora" description="Potência média (W) ÷ 1000 × tarifa (R$/kWh)." />
      <div className="space-y-4 p-4">
        <MachineSelect
          machines={machines}
          value={machineId}
          onChange={(m) => {
            setMachineId(m?.id ?? null);
            const w = m?.avg_power_w ? String(m.avg_power_w) : watts;
            setWatts(w);
            update(w, price);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Potência média">
            <DecimalInput
              decimals={0}
              suffix="W"
              value={watts}
              onValueChange={(w) => {
                setWatts(w);
                update(w, price);
              }}
            />
          </Field>
          <Field label="Tarifa (R$/kWh)" hint={tariff ? 'Tarifa global vigente' : 'Da conta de luz, com impostos'}>
            <DecimalInput
              decimals={6}
              prefix="R$"
              value={price}
              onValueChange={(p) => {
                setPrice(p);
                update(watts, p);
              }}
            />
          </Field>
        </div>
        <p className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2.5 text-sm">
          <Zap className="size-4 text-accent-ink" aria-hidden />
          {result === null ? <span className="text-muted">Informe potência e tarifa.</span> : <span>Energia ≈ <strong className="num">{formatCost(result, 6)}/h</strong></span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={resultText === null}
            onClick={() =>
              onSave({
                rateType: 'ENERGY_PER_HOUR',
                equipmentId: machineId,
                value: resultText,
                source: 'CALCULATED',
                calcParams: { potencia_w: toNumber(watts), tarifa_kwh: toNumber(price) },
              })
            }
          >
            Salvar como taxa de energia
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!price}
            onClick={() => onSave({ rateType: 'ENERGY_PRICE_KWH', equipmentId: null, value: price, source: 'MANUAL' })}
          >
            Salvar só a tarifa (R$/kWh)
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** US-2.4: depreciação por hora = (valor − residual) ÷ vida útil em horas. */
function DepreciationCalculator({
  machines,
  initialEquipment,
  onResult,
  onSave,
}: {
  machines: EquipmentRow[];
  initialEquipment: number | null;
  onResult: (value: string | null) => void;
  onSave: (draft: RateDraft) => void;
}) {
  const initial = machines.find((m) => m.id === initialEquipment) ?? machines.find((m) => m.kind === 'PRINTER') ?? null;
  const [machineId, setMachineId] = useState<number | null>(initial?.id ?? null);
  const [cost, setCost] = useState<string | null>(initial?.acquisition_cost ? String(initial.acquisition_cost) : null);
  const [residual, setResidual] = useState<string | null>(initial ? String(initial.residual_value ?? 0) : null);
  const [life, setLife] = useState<string | null>(initial?.useful_life_hours ? String(initial.useful_life_hours) : null);
  const compute = (c: string | null, r: string | null, l: string | null) =>
    c && l && toNumber(l) > 0 && toNumber(c) >= toNumber(r) ? String(Math.round(((toNumber(c) - toNumber(r)) / toNumber(l)) * 1_000_000) / 1_000_000) : null;
  const result = compute(cost, residual, life);
  const change = (c: string | null, r: string | null, l: string | null) => onResult(compute(c, r, l));

  return (
    <Card>
      <CardHeader title="Depreciação por hora" description="(Valor de aquisição − valor residual) ÷ vida útil em horas." />
      <div className="space-y-4 p-4">
        <MachineSelect
          machines={machines}
          value={machineId}
          onChange={(m) => {
            setMachineId(m?.id ?? null);
            if (!m) return;
            const c = m.acquisition_cost ? String(m.acquisition_cost) : cost;
            const r = String(m.residual_value ?? 0);
            const l = m.useful_life_hours ? String(m.useful_life_hours) : life;
            setCost(c);
            setResidual(r);
            setLife(l);
            change(c, r, l);
          }}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Valor de aquisição">
            <MoneyInput
              value={cost}
              onValueChange={(c) => {
                setCost(c);
                change(c, residual, life);
              }}
            />
          </Field>
          <Field label="Valor residual">
            <MoneyInput
              value={residual}
              onValueChange={(r) => {
                setResidual(r);
                change(cost, r, life);
              }}
            />
          </Field>
          <Field label="Vida útil">
            <DecimalInput
              decimals={0}
              suffix="h"
              value={life}
              onValueChange={(l) => {
                setLife(l);
                change(cost, residual, l);
              }}
            />
          </Field>
        </div>
        <p className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2.5 text-sm">
          <Calculator className="size-4 text-muted" aria-hidden />
          {result === null ? <span className="text-muted">Informe valor e vida útil.</span> : <span>Depreciação ≈ <strong className="num">{formatCost(result, 6)}/h</strong></span>}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={result === null}
          onClick={() =>
            onSave({
              rateType: 'DEPRECIATION_PER_HOUR',
              equipmentId: machineId,
              value: result,
              source: 'CALCULATED',
              calcParams: { valor_aquisicao: toNumber(cost), valor_residual: toNumber(residual), vida_util_h: toNumber(life) },
            })
          }
        >
          Salvar como taxa de depreciação
        </Button>
      </div>
    </Card>
  );
}
