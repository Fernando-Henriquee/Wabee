import { CalendarClock, Landmark, Repeat, ShoppingBag, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import {
  AMORTIZATION_LABELS,
  type PfAmortization,
  type PfPlan,
  type PfPlanKind,
  PLAN_KIND_LABELS,
  usePaySchedule,
  usePfAccounts,
  usePfCategories,
  useSavePlan,
  useSetScheduleAmount,
  useSetScheduleDue,
} from '@/data/personal';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addMonths, isValidISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, toNumber } from '@/lib/money';
import { amortize, totals } from './amortization';
import { PMoney } from './privacy';

export interface PayTarget {
  scheduleId: number;
  name: string;
  amount: number;
  dueDate: string;
  accountId?: number | null;
  /** Entrada recebida em vez de gasto pago. */
  income?: boolean;
}

/** Marca um vencimento como pago (ou recebido): cria o lançamento ligado a ele. */
export function PayDialog({ target, open, onOpenChange }: { target: PayTarget; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <PayForm target={target} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function PayForm({ target, onClose }: { target: PayTarget; onClose: () => void }) {
  const { today: todayFn } = useMember();
  const today = todayFn();
  const accounts = usePfAccounts();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState<string | null>(String(target.amount));
  const [accountId, setAccountId] = useState<string>(target.accountId ? String(target.accountId) : '');
  const [error, setError] = useState<string | null>(null);
  const pay = usePaySchedule(onClose);
  const verb = target.income ? 'Recebido' : 'Pago';

  const submit = () => {
    setError(null);
    if (toNumber(amount) <= 0) return setError('Informe o valor.');
    if (!isValidISODate(date) || date > today) return setError('A data não pode ser futura.');
    pay.mutate({ scheduleId: target.scheduleId, date, amount, accountId: accountId ? Number(accountId) : null }, { onError: (e) => setError(describeError(e)) });
  };

  return (
    <DialogContent
      title={target.income ? 'Registrar recebimento' : 'Registrar pagamento'}
      description={`${target.name} · vencimento ${target.dueDate.split('-').reverse().join('/')}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pay.isPending}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={`${verb} em`}>
          <Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Valor" hint="Mude se veio diferente do previsto (juros, desconto…).">
          <MoneyInput value={amount} onValueChange={setAmount} />
        </Field>
        <Field label={target.income ? 'Entrou na conta' : 'Saiu da conta'}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Conta do cadastro</option>
            {(accounts.data ?? [])
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </Field>
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </DialogContent>
  );
}

/** Muda o valor previsto de um vencimento (conta de luz, fatura variável…). */
export function ScheduleAmountDialog({ id, name, amount, open, onOpenChange }: { id: number; name: string; amount: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [value, setValue] = useState<string | null>(String(amount));
  const [error, setError] = useState<string | null>(null);
  const save = useSetScheduleAmount(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Valor do vencimento"
        description={name}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                setError(null);
                if (value === null || toNumber(value) < 0) return setError('Informe um valor válido.');
                save.mutate({ id, amount: value }, { onError: (e) => setError(describeError(e)) });
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Valor previsto">
            <MoneyInput value={value} onValueChange={setValue} autoFocus />
          </Field>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Muda a data de um vencimento em aberto e, se quiser, a dos seguintes (mesmo dia nos meses que vêm). */
export function ScheduleDueDialog({
  id,
  name,
  dueDate,
  canFollow,
  open,
  onOpenChange,
}: {
  id: number;
  name: string;
  dueDate: string;
  /** Há vencimentos seguintes que podem acompanhar a nova data. */
  canFollow: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [date, setDate] = useState(dueDate);
  const [following, setFollowing] = useState(canFollow);
  const [error, setError] = useState<string | null>(null);
  const save = useSetScheduleDue(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Alterar o vencimento"
        description={name}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                setError(null);
                if (!isValidISODate(date)) return setError('Informe uma data válida.');
                save.mutate({ id, date, following: canFollow && following }, { onError: (e) => setError(describeError(e)) });
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Vence em">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
          </Field>
          {canFollow ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={following} onChange={(e) => setFollowing(e.target.checked)} />
              <span>
                Mudar também os próximos vencimentos
                <span className="block text-xs text-muted">Eles passam a cair no mesmo dia nos meses seguintes. O que já foi pago não muda.</span>
              </span>
            </label>
          ) : null}
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const KIND_CARDS: Array<{ kind: PfPlanKind; icon: typeof Repeat; hint: string }> = [
  { kind: 'CONTA_FIXA', icon: Repeat, hint: 'Aluguel, luz, internet, assinatura: todo mês.' },
  { kind: 'ENTRADA_FIXA', icon: TrendingUp, hint: 'Salário e outras entradas que se repetem.' },
  { kind: 'PARCELADO', icon: ShoppingBag, hint: 'Compra no cartão ou carnê em X vezes.' },
  { kind: 'FINANCIAMENTO', icon: Landmark, hint: 'Carro, casa, empréstimo: com juros e saldo devedor.' },
];

interface PlanForm {
  kind: PfPlanKind | null;
  name: string;
  accountId: string;
  categoryId: string;
  amount: string | null;
  count: string | null;
  firstDue: string;
  paidCount: string | null;
  lender: string;
  principal: string | null;
  downPayment: string | null;
  ratePct: string | null;
  system: PfAmortization;
  notes: string;
}

function initialForm(plan: PfPlan | null, today: string): PlanForm {
  if (plan) {
    return {
      kind: plan.kind,
      name: plan.name,
      accountId: plan.account_id ? String(plan.account_id) : '',
      categoryId: plan.category_id ? String(plan.category_id) : '',
      amount: String(plan.amount),
      count: plan.installments_total === null ? null : String(plan.installments_total),
      firstDue: plan.first_due,
      paidCount: null,
      lender: plan.lender ?? '',
      principal: plan.principal === null ? null : String(plan.principal),
      downPayment: plan.down_payment === null ? null : String(plan.down_payment),
      ratePct: plan.rate_month === null ? null : String(Math.round(plan.rate_month * 1_000_000) / 10_000),
      system: plan.system ?? 'PRICE',
      notes: plan.notes ?? '',
    };
  }
  return { kind: null, name: '', accountId: '', categoryId: '', amount: null, count: null, firstDue: addMonths(today, 1), paidCount: null, lender: '', principal: null, downPayment: null, ratePct: null, system: 'PRICE', notes: '' };
}

/** Cadastro de conta fixa, entrada fixa, compra parcelada ou financiamento (ou edição de um existente). */
export function PlanFormDialog({ plan, open, onOpenChange, onSaved }: { plan?: PfPlan | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved?: (id: number) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <PlanForm plan={plan ?? null} onClose={() => onOpenChange(false)} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan: PfPlan | null; onClose: () => void; onSaved?: (id: number) => void }) {
  const { today: todayFn } = useMember();
  const today = todayFn();
  const editing = plan !== null;
  const accounts = usePfAccounts();
  const categories = usePfCategories();
  const [form, setForm] = useState<PlanForm>(() => initialForm(plan, today));
  const [error, setError] = useState<string | null>(null);
  const save = useSavePlan((id) => {
    onClose();
    onSaved?.(id);
  });
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const kind = form.kind;
  const recurring = kind === 'CONTA_FIXA' || kind === 'ENTRADA_FIXA';
  const categoryKind = kind === 'ENTRADA_FIXA' ? 'ENTRADA' : 'GASTO';
  const count = Math.round(toNumber(form.count));
  const rate = toNumber(form.ratePct) / 100;

  const preview = useMemo(() => {
    if (kind !== 'FINANCIAMENTO' || editing) return null;
    const rows = amortize(form.system, toNumber(form.principal), rate, count, toNumber(form.amount));
    return rows.length > 0 ? { rows, ...totals(rows) } : null;
  }, [kind, editing, form.system, form.principal, rate, count, form.amount]);

  if (!kind) {
    return (
      <DialogContent title="O que você quer cadastrar?" description="Escolha o tipo. O sistema avisa dos vencimentos e desconta do seu limite do dia." size="md">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KIND_CARDS.map(({ kind: k, icon: Icon, hint }) => (
            <li key={k}>
              <button type="button" onClick={() => set('kind', k)} className="flex h-full w-full items-start gap-3 rounded-xl border border-line bg-panel p-3 text-left hover:bg-subtle">
                <Icon className="mt-0.5 size-5 shrink-0 text-accent-ink" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold">{PLAN_KIND_LABELS[k]}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    );
  }

  const submit = () => {
    setError(null);
    if (!form.name.trim()) return setError('Informe o nome.');
    if (!editing && !isValidISODate(form.firstDue)) return setError('Informe a data do primeiro vencimento.');
    if (recurring && toNumber(form.amount) <= 0) return setError('Informe o valor.');
    if (!recurring && !editing && count < 1) return setError('Informe o número de parcelas.');
    if (kind === 'PARCELADO' && toNumber(form.amount) <= 0) return setError('Informe o valor de cada parcela.');
    if (kind === 'FINANCIAMENTO' && !editing) {
      if (toNumber(form.principal) <= 0) return setError('Informe o valor financiado.');
      if (form.system === 'FIXA' && toNumber(form.amount) <= 0) return setError('Informe o valor da parcela.');
    }
    const paid = Math.round(toNumber(form.paidCount));
    if (!recurring && paid > count) return setError('As parcelas já pagas não podem passar do total.');
    save.mutate(
      {
        id: plan?.id,
        kind,
        name: form.name.trim(),
        account_id: form.accountId ? Number(form.accountId) : null,
        category_id: form.categoryId ? Number(form.categoryId) : null,
        amount: kind === 'FINANCIAMENTO' && form.system !== 'FIXA' ? 0 : form.amount,
        installments_total: recurring ? (form.count ? count : null) : count,
        first_due: form.firstDue,
        paid_count: paid > 0 ? paid : 0,
        lender: form.lender.trim() || null,
        principal: form.principal,
        down_payment: form.downPayment,
        rate_month: kind === 'FINANCIAMENTO' ? String(rate) : null,
        system: kind === 'FINANCIAMENTO' ? form.system : undefined,
        notes: form.notes.trim() || null,
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  return (
    <DialogContent
      title={`${editing ? 'Editar' : 'Novo'}: ${PLAN_KIND_LABELS[kind].toLowerCase()}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {editing ? 'Salvar' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" required className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} autoFocus placeholder={kind === 'FINANCIAMENTO' ? 'Ex.: Financiamento do carro' : kind === 'PARCELADO' ? 'Ex.: Tênis, geladeira' : kind === 'ENTRADA_FIXA' ? 'Ex.: Salário' : 'Ex.: Aluguel, Internet'} />
          </Field>

          {kind === 'FINANCIAMENTO' ? (
            <>
              <Field label="Banco ou credor">
                <Input value={form.lender} onChange={(e) => set('lender', e.target.value)} maxLength={80} />
              </Field>
              <Field label="Valor financiado" required={!editing} hint="Já sem a entrada." >
                <MoneyInput value={form.principal} onValueChange={(v) => set('principal', v)} disabled={editing} />
              </Field>
              {!editing ? (
                <>
                  <Field label="Entrada paga (opcional)" hint="Só informativo.">
                    <MoneyInput value={form.downPayment} onValueChange={(v) => set('downPayment', v)} />
                  </Field>
                  <Field label="Juros ao mês">
                    <DecimalInput decimals={4} suffix="% a.m." value={form.ratePct} onValueChange={(v) => set('ratePct', v)} />
                  </Field>
                  <Field label="Como as parcelas são calculadas" className="sm:col-span-2">
                    <Select value={form.system} onChange={(e) => set('system', e.target.value as PfAmortization)}>
                      {(Object.keys(AMORTIZATION_LABELS) as PfAmortization[]).map((s) => (
                        <option key={s} value={s}>
                          {AMORTIZATION_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              ) : null}
              {!editing && form.system === 'FIXA' ? (
                <Field label="Valor da parcela" required>
                  <MoneyInput value={form.amount} onValueChange={(v) => set('amount', v)} />
                </Field>
              ) : null}
            </>
          ) : (
            <Field label={kind === 'PARCELADO' ? 'Valor de cada parcela' : kind === 'ENTRADA_FIXA' ? 'Valor que entra' : 'Valor mensal'} required>
              <MoneyInput value={form.amount} onValueChange={(v) => set('amount', v)} />
            </Field>
          )}

          {!editing ? (
            <>
              <Field label={recurring ? 'Próximo vencimento' : 'Primeira parcela vence em'} required>
                <Input type="date" value={form.firstDue} onChange={(e) => set('firstDue', e.target.value)} />
              </Field>
              <Field
                label={recurring ? 'Por quantos meses? (opcional)' : 'Número de parcelas'}
                required={!recurring}
                hint={recurring ? 'Em branco: repete todo mês até você encerrar.' : undefined}
              >
                <DecimalInput decimals={0} value={form.count} onValueChange={(v) => set('count', v)} />
              </Field>
              {!recurring ? (
                <Field label="Quantas já foram pagas?" hint="Para cadastrar algo que já começou. Não mexe no saldo das contas.">
                  <DecimalInput decimals={0} value={form.paidCount} onValueChange={(v) => set('paidCount', v)} placeholder="0" />
                </Field>
              ) : null}
            </>
          ) : null}

          {editing ? (
            <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted sm:col-span-2">
              Para mudar a data de vencimento, use o menu <span className="font-medium text-ink">⋯</span> ao lado do vencimento e escolha “Alterar o vencimento”.
            </p>
          ) : null}
          <Field label={kind === 'ENTRADA_FIXA' ? 'Cai em qual conta' : 'Paga com qual conta'}>
            <Select value={form.accountId} onChange={(e) => set('accountId', e.target.value)}>
              <option value="">Escolher na hora de pagar</option>
              {(accounts.data ?? [])
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Categoria">
            <Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Sem categoria</option>
              {(categories.data ?? [])
                .filter((c) => c.active && c.kind === categoryKind)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={500} className="min-h-14" />
          </Field>
        </div>

        {preview ? (
          <section aria-label="Prévia das parcelas" className="space-y-2 rounded-xl border border-line bg-subtle p-3 text-sm">
            <h3 className="flex items-center gap-1.5 font-semibold">
              <CalendarClock className="size-4" aria-hidden /> Prévia
            </h3>
            <p>
              {form.system === 'SAC' ? (
                <>
                  Primeira parcela <strong>{formatBRL(preview.rows[0]!.payment)}</strong>, última <strong>{formatBRL(preview.rows.at(-1)!.payment)}</strong>.
                </>
              ) : (
                <>
                  {count} parcelas de <strong>{formatBRL(preview.rows[0]!.payment)}</strong>.
                </>
              )}
            </p>
            <p className="text-muted">
              Total a pagar <PMoney value={preview.paid} className="font-medium text-ink" />
              {preview.interest !== null ? (
                <>
                  {' '}
                  · juros <PMoney value={preview.interest} className="font-medium text-ink" />
                </>
              ) : null}
              . O valor do banco pode diferir um pouco (tarifas, seguro, IOF): ajuste cada parcela depois, se precisar.
            </p>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className={cn('rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger')}>
            {error}
          </p>
        ) : null}
      </div>
    </DialogContent>
  );
}
