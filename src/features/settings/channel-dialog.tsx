import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput, MoneyInput, PercentInput } from '@/components/ui/money-input';
import {
  CHANNEL_KIND_LABELS,
  type ChannelFee,
  type ChannelInput,
  type ChannelKind,
  type ChannelWithFees,
  type FeeFixedPer,
  useSaveSalesChannel,
} from '@/data/settings';
import { useMember } from '@/features/member/member-context';
import { formatDateBR, isValidISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, toCents, toNumber } from '@/lib/money';
import { FormError, ToggleRow } from './bits';
import { describeFee, payoutLabel } from './channel-format';

interface ChannelForm {
  name: string;
  kind: ChannelKind;
  payout_days: string | null;
  active: boolean;
  notes: string;
  fee_pct: string | null;
  fee_fixed: string | null;
  fee_fixed_per: FeeFixedPer;
  payment_fee_pct: string | null;
  fees_valid_from: string;
}

function formFrom(channel: ChannelWithFees | null, today: string): ChannelForm {
  const fee = channel?.current ?? channel?.fees[0] ?? null;
  return {
    name: channel?.name ?? '',
    kind: channel?.kind ?? 'MARKETPLACE',
    payout_days: String(channel?.payout_days ?? 0),
    active: channel?.active ?? true,
    notes: channel?.notes ?? '',
    fee_pct: String(fee?.fee_pct ?? 0),
    fee_fixed: String(fee?.fee_fixed ?? 0),
    fee_fixed_per: fee?.fee_fixed_per ?? 'PEDIDO',
    payment_fee_pct: String(fee?.payment_fee_pct ?? 0),
    fees_valid_from: today,
  };
}

function sameFee(form: ChannelForm, fee: ChannelFee | null): boolean {
  if (!fee) return false;
  return (
    Math.abs(toNumber(form.fee_pct) - toNumber(fee.fee_pct)) < 1e-9 &&
    toCents(form.fee_fixed ?? '0') === toCents(fee.fee_fixed) &&
    form.fee_fixed_per === fee.fee_fixed_per &&
    Math.abs(toNumber(form.payment_fee_pct) - toNumber(fee.payment_fee_pct)) < 1e-9
  );
}

interface ChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = novo canal. */
  channel: ChannelWithFees | null;
  isDefault: boolean;
}

export function ChannelDialog(props: ChannelDialogProps) {
  const { today } = useMember();
  // Remonta o formulário a cada abertura (valores atuais do canal).
  return props.open ? <ChannelDialogBody key={props.channel?.id ?? 'novo'} {...props} initial={formFrom(props.channel, today())} /> : <Dialog open={false} />;
}

function ChannelDialogBody({ open, onOpenChange, channel, isDefault, initial }: ChannelDialogProps & { initial: ChannelForm }) {
  const editing = Boolean(channel);
  const [form, setForm] = useState<ChannelForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveSalesChannel(() => onOpenChange(false));
  const set = <K extends keyof ChannelForm>(key: K, value: ChannelForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const current = channel?.current ?? null;
  const feesChanged = editing && !sameFee(form, current);

  const submit = () => {
    setError(null);
    const name = form.name.trim();
    if (!name) return setError('Informe o nome do canal.');
    const payout = Math.round(toNumber(form.payout_days));
    if (payout < 0 || payout > 120) return setError('O prazo para receber precisa ficar entre 0 e 120 dias.');
    for (const [label, value] of [
      ['taxa do canal', form.fee_pct],
      ['taxa de pagamento', form.payment_fee_pct],
    ] as const) {
      if (toNumber(value) < 0 || toNumber(value) >= 1) return setError(`A ${label} precisa ficar entre 0% e 99,99%.`);
    }
    if (toNumber(form.fee_pct) + toNumber(form.payment_fee_pct) >= 1) return setError('As taxas somadas não podem chegar a 100% da venda.');
    if (toNumber(form.fee_fixed) < 0) return setError('A taxa fixa não pode ser negativa.');
    if (editing && channel && !form.active && isDefault) {
      return setError('Este é o canal padrão das vendas. Escolha outro canal padrão em Empresa e regras antes de desativá-lo.');
    }
    if (feesChanged) {
      if (!isValidISODate(form.fees_valid_from)) return setError('Informe desde quando as novas taxas valem.');
      if (current && form.fees_valid_from <= current.valid_from) {
        return setError(`A tabela atual começa em ${formatDateBR(current.valid_from)}. As novas taxas precisam começar depois dessa data.`);
      }
      if (channel?.scheduled && form.fees_valid_from < channel.scheduled.valid_from) {
        return setError(`Já existe uma tabela agendada para ${formatDateBR(channel.scheduled.valid_from)}. Escolha uma data a partir dela.`);
      }
    }
    const payload: ChannelInput = {
      id: channel?.id,
      name,
      kind: form.kind,
      payout_days: payout,
      active: form.active,
      notes: form.notes.trim() || null,
      fee_pct: form.fee_pct ?? '0',
      fee_fixed: form.fee_fixed ?? '0',
      fee_fixed_per: form.fee_fixed_per,
      payment_fee_pct: form.payment_fee_pct ?? '0',
      fees_valid_from: editing ? form.fees_valid_from : undefined,
    };
    save.mutate(payload, { onError: (e) => setError(describeError(e)) });
  };

  const sale = 100;
  const fees = sale * toNumber(form.fee_pct) + toNumber(form.fee_fixed) + sale * toNumber(form.payment_fee_pct);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        title={editing ? `Editar canal — ${channel!.name}` : 'Novo canal de venda'}
        description="As taxas entram no preço sugerido, na margem e no valor a receber de cada venda."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={save.isPending}>
              {editing ? 'Salvar canal' : 'Cadastrar canal'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} placeholder="Ex.: Shopee" autoFocus={!editing} />
            </Field>
            <Field label="Tipo">
              <Select value={form.kind} onChange={(e) => set('kind', e.target.value as ChannelKind)}>
                {(Object.keys(CHANNEL_KIND_LABELS) as ChannelKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {CHANNEL_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prazo para receber (dias)" hint="Dias entre a venda e o dinheiro cair (0 = na hora). Define o vencimento do recebimento.">
              <DecimalInput decimals={0} value={form.payout_days} onValueChange={(v) => set('payout_days', v)} />
            </Field>
          </div>

          <fieldset className="space-y-4 rounded-xl border border-line p-3 sm:p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Taxas</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Taxa do canal" hint="Comissão sobre o valor da venda.">
                <PercentInput value={form.fee_pct} onValueChange={(v) => set('fee_pct', v)} />
              </Field>
              <Field label="Taxa de pagamento" hint="Cartão, Pix parcelado ou intermediador.">
                <PercentInput value={form.payment_fee_pct} onValueChange={(v) => set('payment_fee_pct', v)} />
              </Field>
              <Field label="Taxa fixa" hint="Valor fixo cobrado pelo canal (ex.: R$ 4,00 por item na Shopee).">
                <MoneyInput value={form.fee_fixed} onValueChange={(v) => set('fee_fixed', v)} />
              </Field>
              <Field label="Taxa fixa cobrada">
                <Select value={form.fee_fixed_per} onChange={(e) => set('fee_fixed_per', e.target.value as FeeFixedPer)}>
                  <option value="PEDIDO">Por pedido</option>
                  <option value="UNIDADE">Por unidade vendida</option>
                </Select>
              </Field>
              {feesChanged ? (
                <Field
                  label="Novas taxas valem a partir de"
                  required
                  className="sm:col-span-2"
                  hint={
                    current
                      ? `A tabela atual (desde ${formatDateBR(current.valid_from)}) termina no dia anterior. Vendas já feitas não mudam.`
                      : 'Vendas já feitas não mudam.'
                  }
                >
                  <Input type="date" value={form.fees_valid_from} min={current?.valid_from} onChange={(e) => set('fees_valid_from', e.target.value)} />
                </Field>
              ) : null}
            </div>
            <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
              Numa venda de {formatBRL(sale)} (1 unidade), o canal fica com <strong className="num">{formatBRL(fees)}</strong> e você recebe{' '}
              <strong className="num">{formatBRL(sale - fees)}</strong> {payoutLabel(Math.round(toNumber(form.payout_days)))}.
              {!editing ? ' As taxas iniciais valem para todas as vendas deste canal.' : null}
            </p>
          </fieldset>

          <div className="grid grid-cols-1 gap-4">
            {editing ? (
              <ToggleRow
                checked={form.active}
                onChange={(v) => set('active', v)}
                label="Canal ativo"
                description={isDefault ? 'Este é o canal padrão das vendas.' : 'Inativo: some da escolha nas vendas novas, mas continua nos relatórios.'}
              />
            ) : null}
            <Field label="Observações">
              <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={500} className="min-h-16" />
            </Field>
          </div>

          {editing && channel!.fees.length > 0 ? <FeeHistory fees={channel!.fees} current={current} /> : null}
          <FormError>{error}</FormError>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FeeHistory({ fees, current }: { fees: ChannelFee[]; current: ChannelFee | null }) {
  return (
    <section aria-label="Histórico de taxas">
      <h3 className="mb-2 text-sm font-semibold">Histórico de taxas</h3>
      <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {fees.map((fee) => {
          const isCurrent = current?.id === fee.id;
          const future = !isCurrent && fee.valid_to === null && current !== null && fee.valid_from > current.valid_from;
          return (
            <li key={fee.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="num text-ink-soft">
                {formatDateBR(fee.valid_from)} {fee.valid_to ? `a ${formatDateBR(fee.valid_to)}` : 'em diante'}{' '}
                {isCurrent ? <Badge tone="success">vigente</Badge> : future ? <Badge tone="info">agendada</Badge> : null}
              </span>
              <span className="num text-ink">{describeFee(fee)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
