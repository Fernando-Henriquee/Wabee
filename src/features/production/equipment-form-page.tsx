import { ArrowLeft, Lock } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  EQUIPMENT_KIND_LABELS,
  EQUIPMENT_STATUS_LABELS,
  type EquipmentInput,
  type EquipmentKind,
  type EquipmentRow,
  type EquipmentStatus,
  useCostRates,
  useEquipment,
  useSaveEquipment,
} from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { describeError } from '@/lib/errors';
import { formatCost, formatNumber, toNumber } from '@/lib/money';
import { Notice } from './bits';

interface FormState {
  name: string;
  kind: EquipmentKind;
  brand: string;
  model: string;
  serial: string;
  acquired_at: string;
  acquisition_cost: string | null;
  residual_value: string | null;
  useful_life_hours: string | null;
  avg_power_w: string | null;
  initial_hours: string | null;
  maintenance_interval_hours: string | null;
  status: EquipmentStatus;
  notes: string;
}

const EMPTY: FormState = {
  name: '',
  kind: 'PRINTER',
  brand: '',
  model: '',
  serial: '',
  acquired_at: '',
  acquisition_cost: null,
  residual_value: null,
  useful_life_hours: null,
  avg_power_w: null,
  initial_hours: null,
  maintenance_interval_hours: null,
  status: 'ATIVO',
  notes: '',
};

const str = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

function stateFrom(e: EquipmentRow): FormState {
  return {
    name: e.name,
    kind: e.kind,
    brand: e.brand ?? '',
    model: e.model ?? '',
    serial: e.serial ?? '',
    acquired_at: e.acquired_at ?? '',
    acquisition_cost: str(e.acquisition_cost),
    residual_value: str(e.residual_value),
    useful_life_hours: str(e.useful_life_hours),
    avg_power_w: str(e.avg_power_w),
    initial_hours: str(e.initial_hours),
    maintenance_interval_hours: str(e.maintenance_interval_hours),
    status: e.status,
    notes: e.notes ?? '',
  };
}

export function EquipmentFormPage() {
  const { id } = useParams();
  const { can } = useMember();
  const equipment = useEquipment(id ? Number(id) : undefined);
  if (!can('write')) {
    return (
      <Page>
        <EmptyState title="Sem permissão" description="Só o dono cadastra e edita equipamentos." />
      </Page>
    );
  }
  if (id && equipment.isError) return <Page><ErrorState error={equipment.error} /></Page>;
  if (id && equipment.data === undefined) return <Page><LoadingBlock /></Page>;
  if (id && equipment.data === null) return <Page><EmptyState title="Equipamento não encontrado" /></Page>;
  return <EquipmentForm key={id ?? 'new'} id={id ? Number(id) : undefined} initial={equipment.data ? stateFrom(equipment.data) : EMPTY} locked={Boolean(equipment.data?.purchase_line_id)} />;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function intText(v: string | null) {
  return v === null ? null : String(Math.round(toNumber(v)));
}

function EquipmentForm({ id, initial, locked }: { id?: number; initial: FormState; locked: boolean }) {
  const navigate = useNavigate();
  const editing = id !== undefined;
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const rates = useCostRates();
  const save = useSaveEquipment((savedId) => navigate(`/producao/equipamentos/${savedId}`, { replace: true }));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const cost = toNumber(form.acquisition_cost);
  const residual = toNumber(form.residual_value);
  const life = toNumber(form.useful_life_hours);
  const depreciationH = life > 0 && cost > residual ? (cost - residual) / life : null;
  const tariff = (rates.data ?? []).find((r) => r.rate_type === 'ENERGY_PRICE_KWH' && r.is_current && (r.equipment_id === null || r.equipment_id === id));
  const kwh = form.avg_power_w ? toNumber(form.avg_power_w) / 1000 : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('Informe o nome do equipamento.');
    if (cost > 0 && residual > cost) return setError('O valor residual não pode passar do valor de aquisição.');
    const payload: EquipmentInput = {
      id,
      name: form.name.trim(),
      kind: form.kind,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      serial: form.serial.trim() || null,
      acquired_at: form.acquired_at || null,
      acquisition_cost: form.acquisition_cost,
      residual_value: form.residual_value,
      useful_life_hours: intText(form.useful_life_hours),
      avg_power_w: intText(form.avg_power_w),
      initial_hours: form.initial_hours,
      maintenance_interval_hours: intText(form.maintenance_interval_hours),
      status: editing ? form.status : undefined,
      notes: form.notes.trim() || null,
    };
    save.mutate(payload, { onError: (e) => setError(describeError(e)) });
  };

  return (
    <Page className="max-w-3xl">
      <PageHeader
        back={
          <Link to={editing ? `/producao/equipamentos/${id}` : '/producao/equipamentos'} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {editing ? 'Voltar ao equipamento' : 'Equipamentos'}
          </Link>
        }
        title={editing ? `Editar ${initial.name}` : 'Novo equipamento'}
        description="Impressoras compradas pelo sistema já nascem no recebimento da compra, com o valor da nota."
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Section title="Identificação">
          <Field label="Nome" required className="sm:col-span-2" hint='Ex.: "Impressora 1", "Bambu A1"'>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
          </Field>
          <Field label="Tipo">
            <Select value={form.kind} onChange={(e) => set('kind', e.target.value as EquipmentKind)}>
              {(Object.keys(EQUIPMENT_KIND_LABELS) as EquipmentKind[]).map((k) => (
                <option key={k} value={k}>
                  {EQUIPMENT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          {editing ? (
            <Field label="Situação" hint={initial.status === 'BAIXADO' ? 'Equipamento baixado não volta a operar.' : 'Em manutenção ou baixado não recebe novas impressões.'}>
              <Select value={form.status} onChange={(e) => set('status', e.target.value as EquipmentStatus)} disabled={initial.status === 'BAIXADO'}>
                {(Object.keys(EQUIPMENT_STATUS_LABELS) as EquipmentStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {EQUIPMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field label="Marca">
            <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} maxLength={60} />
          </Field>
          <Field label="Modelo">
            <Input value={form.model} onChange={(e) => set('model', e.target.value)} maxLength={60} />
          </Field>
          <Field label="Número de série">
            <Input value={form.serial} onChange={(e) => set('serial', e.target.value)} maxLength={60} />
          </Field>
          <Field label="Data de aquisição">
            <Input type="date" value={form.acquired_at} onChange={(e) => set('acquired_at', e.target.value)} />
          </Field>
        </Section>

        <Section title="Valor e depreciação" description="Depreciação por hora = (valor de aquisição − valor residual) ÷ vida útil em horas.">
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                Valor de aquisição {locked ? <Lock className="size-3.5 text-muted" aria-label="Travado" /> : null}
              </span>
            }
            hint={locked ? 'Veio de uma compra: é o valor da nota (sem juros, com frete rateado) e não muda aqui.' : 'Sem juros, com frete.'}
          >
            <MoneyInput value={form.acquisition_cost} onValueChange={(v) => set('acquisition_cost', v)} disabled={locked} />
          </Field>
          <Field label="Valor residual" hint="Quanto valeria ao fim da vida útil (revenda).">
            <MoneyInput value={form.residual_value} onValueChange={(v) => set('residual_value', v)} />
          </Field>
          <Field label="Vida útil (horas)" hint="Ex.: 5.000 h para uma impressora de entrada.">
            <DecimalInput decimals={0} suffix="h" value={form.useful_life_hours} onValueChange={(v) => set('useful_life_hours', v)} />
          </Field>
          <div className="flex items-end">
            <p className="w-full rounded-lg bg-subtle px-3 py-2.5 text-sm">
              {depreciationH !== null ? (
                <>
                  Depreciação ≈ <strong className="num">{formatCost(depreciationH, 4)}/h</strong>
                </>
              ) : (
                <span className="text-muted">Informe valor e vida útil para ver a depreciação por hora.</span>
              )}
            </p>
          </div>
        </Section>

        <Section title="Uso, energia e manutenção" description="O horímetro soma as horas iniciais e o tempo de todas as impressões (concluídas e com falha).">
          <Field label="Horas já usadas antes do sistema" hint="Ponto de partida do horímetro.">
            <DecimalInput decimals={1} suffix="h" value={form.initial_hours} onValueChange={(v) => set('initial_hours', v)} />
          </Field>
          <Field label="Intervalo de manutenção (horas)" hint="Avisa quando chegar a 90% do intervalo.">
            <DecimalInput decimals={0} suffix="h" value={form.maintenance_interval_hours} onValueChange={(v) => set('maintenance_interval_hours', v)} />
          </Field>
          <Field label="Potência média (W)" hint="Medida na tomada durante a impressão (média, não a máxima).">
            <DecimalInput decimals={0} suffix="W" value={form.avg_power_w} onValueChange={(v) => set('avg_power_w', v)} />
          </Field>
          <div className="flex items-end">
            <p className="w-full rounded-lg bg-subtle px-3 py-2.5 text-sm">
              {kwh !== null ? (
                <>
                  Consome ≈ <strong className="num">{formatNumber(kwh, 3)} kWh/h</strong>
                  {tariff ? (
                    <>
                      {' '}
                      · energia ≈ <strong className="num">{formatCost(kwh * toNumber(tariff.value), 4)}/h</strong> com a tarifa de {formatCost(tariff.value, 2)}/kWh
                    </>
                  ) : null}
                </>
              ) : (
                <span className="text-muted">Energia por hora = W ÷ 1000 × R$/kWh.</span>
              )}
            </p>
          </div>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />
          </Field>
        </Section>

        <p className="text-xs text-muted">As taxas por hora usadas no custo das impressões ficam em Produção → Taxas, com vigência; este cadastro só alimenta as calculadoras.</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Salvar alterações' : 'Cadastrar equipamento'}
          </Button>
        </div>
      </form>
    </Page>
  );
}
