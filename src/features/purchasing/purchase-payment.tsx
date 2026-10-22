import { Pencil, RotateCcw, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { FUNDING_LABELS, type OwnerFundingType, type PaymentAccount, type Payer } from '@/data/finance';
import { METHOD_LABELS, METHOD_ORDER, type PaymentMethod } from '@/data/purchasing';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import { formatBRL, formatPercent, toNumber } from '@/lib/money';
import { Callout } from './purchase-bits';
import { accountsFor, type buildInstallments, FUNDING_HINTS, hasInstallments, isCardMethod, isCashMethod } from './purchase-logic';
import { Segmented } from './segmented';

export interface PaymentState {
  method: PaymentMethod;
  accountId: number | null;
  /** Usado quando não há conta escolhida (conta do dono força "dono"). */
  payer: Payer;
  funding: OwnerFundingType;
  countText: string | null;
  /** null = 1º vencimento sugerido pelo cartão. */
  firstDue: string | null;
  /** null = igual ao valor à vista. */
  installmentsTotal: string | null;
  interestUnknown: boolean;
  /** Valores de parcela editados (índice → valor). */
  edited: Record<number, string>;
}

const METHOD_HINTS: Record<PaymentMethod, string> = {
  PIX: 'pago na hora',
  DINHEIRO: 'pago na hora',
  DEBITO: 'pago na hora',
  CREDITO_VISTA: '1 parcela na fatura',
  CREDITO_PARCELADO: 'parcelas no cartão',
  BOLETO: '1 ou mais boletos',
};

interface Props {
  state: PaymentState;
  onChange: (patch: Partial<PaymentState>) => void;
  accounts: PaymentAccount[];
  purchasedAt: string;
  cashTotal: string;
  installmentsTotal: string;
  interest: string;
  suggestedDue: string;
  installments: ReturnType<typeof buildInstallments>;
  /** Sem valor à vista: diferença entre o total parcelado e a soma das linhas. */
  unknownDiff: string;
  onFitLines: () => void;
}

/** Pagamento, quem pagou e parcelas (US-3.3, US-3.4). */
export function PurchasePayment({ state, onChange, accounts, purchasedAt, cashTotal, installmentsTotal, interest, suggestedDue, installments, unknownDiff, onFitLines }: Props) {
  const [editing, setEditing] = useState(Object.keys(state.edited).length > 0);
  const options = accountsFor(state.method, accounts);
  const account = accounts.find((a) => a.id === state.accountId) ?? null;
  const payer: Payer = account ? account.owner : state.payer;
  const multi = hasInstallments(state.method);
  const cash = isCashMethod(state.method);
  const card = account?.kind === 'CARTAO_CREDITO' ? account : null;
  const interestValue = toNumber(interest);
  const companyOptions = options.filter((a) => a.owner === 'EMPRESA');
  const ownerOptions = options.filter((a) => a.owner === 'DONO');

  const changeMethod = (method: PaymentMethod) => {
    const fits = account ? accountsFor(method, [account]).length > 0 : true;
    onChange({ method, accountId: fits ? state.accountId : null, edited: {} });
    setEditing(false);
  };

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Forma de pagamento" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {METHOD_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={state.method === m}
            onClick={() => changeMethod(m)}
            className={cn(
              'flex min-h-12 flex-col items-start justify-center rounded-lg border px-3 py-2 text-left transition-colors',
              state.method === m ? 'border-ink bg-ink text-brand-fg' : 'border-line-strong bg-panel text-ink hover:bg-subtle',
            )}
          >
            <span className="text-sm font-semibold">{METHOD_LABELS[m]}</span>
            <span className={cn('text-xs', state.method === m ? 'text-brand-fg/75' : 'text-muted')}>{METHOD_HINTS[m]}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={isCardMethod(state.method) ? 'Cartão' : cash ? 'De qual conta saiu' : 'Conta (opcional)'}
          required={isCardMethod(state.method) || (cash && payer === 'EMPRESA')}
          hint={account?.owner === 'DONO' ? 'Conta ou cartão do dono: não sai do caixa da empresa.' : options.length === 0 ? 'Nenhuma conta deste tipo: cadastre em Financeiro → Contas.' : undefined}
        >
          <Select value={state.accountId ? String(state.accountId) : ''} onChange={(e) => onChange({ accountId: e.target.value ? Number(e.target.value) : null, edited: {} })}>
            <option value="">{isCardMethod(state.method) ? 'Escolha o cartão…' : cash ? 'Escolha a conta…' : 'A definir no pagamento'}</option>
            {companyOptions.length > 0 ? (
              <optgroup label="Da empresa">
                {companyOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {ownerOptions.length > 0 ? (
              <optgroup label="Do dono (pessoal)">
                {ownerOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-soft">Quem pagou</span>
          {account ? (
            <p className="flex min-h-10 flex-wrap items-center gap-2 text-sm">
              <Badge tone={payer === 'DONO' ? 'accent' : 'neutral'}>{payer === 'DONO' ? 'Dono' : 'Empresa'}</Badge>
              <span className="text-xs text-muted">definido pela conta escolhida</span>
            </p>
          ) : (
            <Segmented
              label="Quem pagou"
              value={state.payer}
              onChange={(p) => onChange({ payer: p })}
              options={[
                { value: 'EMPRESA', label: 'Empresa' },
                { value: 'DONO', label: 'Dono (pessoal)' },
              ]}
            />
          )}
        </div>

        {payer === 'DONO' ? (
          <Field label="Como tratar o que o dono pagou" hint={FUNDING_HINTS[state.funding]} className="sm:col-span-2">
            <Select value={state.funding} onChange={(e) => onChange({ funding: e.target.value as OwnerFundingType })}>
              {(Object.keys(FUNDING_LABELS) as OwnerFundingType[]).map((f) => (
                <option key={f} value={f}>
                  {FUNDING_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {multi ? (
          <Field label="Número de parcelas" required>
            <DecimalInput decimals={0} suffix="x" value={state.countText} onValueChange={(v) => onChange({ countText: v })} />
          </Field>
        ) : null}

        {!cash ? (
          <Field
            label={multi ? '1º vencimento' : 'Vencimento'}
            required
            hint={
              state.firstDue ? (
                <button type="button" className="underline decoration-accent decoration-2 underline-offset-2" onClick={() => onChange({ firstDue: null })}>
                  Usar o sugerido: {formatDateBR(suggestedDue)}
                </button>
              ) : card?.card_due_day ? (
                `Sugerido pelo cartão (fecha dia ${card.card_closing_day ?? 1}, vence dia ${card.card_due_day}).`
              ) : (
                'Sugerido: um mês depois da compra.'
              )
            }
          >
            <Input type="date" value={state.firstDue ?? suggestedDue} min={purchasedAt} onChange={(e) => onChange({ firstDue: e.target.value || null })} />
          </Field>
        ) : null}

        {multi ? (
          <Field label="Total parcelado" hint={state.installmentsTotal === null ? `Igual ao valor à vista (${formatBRL(cashTotal)}) até você informar.` : 'Soma das parcelas na fatura ou nos boletos.'}>
            <MoneyInput value={state.installmentsTotal} onValueChange={(v) => onChange({ installmentsTotal: v })} placeholder={formatBRL(cashTotal).replace('R$', '').trim()} />
          </Field>
        ) : null}

        {multi ? (
          <label className="inline-flex min-h-10 items-center gap-2 self-end text-sm text-ink-soft">
            <Checkbox checked={state.interestUnknown} onChange={(e) => onChange({ interestUnknown: e.target.checked })} /> Não sei o valor à vista
          </label>
        ) : null}
      </div>

      {multi && state.interestUnknown ? (
        toNumber(unknownDiff) !== 0 ? (
          <Callout
            tone="warning"
            title="As linhas precisam somar o total parcelado"
            action={
              <Button type="button" size="sm" variant="outline" onClick={onFitLines}>
                <Wand2 /> Ajustar linhas ao total
              </Button>
            }
          >
            Sem o valor à vista, os juros ficam embutidos no custo dos itens. As linhas somam {formatBRL(cashTotal)} e o total parcelado é {formatBRL(installmentsTotal)} (diferença de {formatBRL(unknownDiff)}).
          </Callout>
        ) : (
          <Callout tone="info">Sem o valor à vista: os juros ficam embutidos no custo dos itens (juros = R$ 0,00 no resultado).</Callout>
        )
      ) : multi && interestValue > 0 ? (
        <Callout tone="info" title={`Juros do parcelamento: ${formatBRL(interest)}`}>
          {formatPercent(interestValue / Math.max(toNumber(cashTotal), 0.01))} sobre o valor à vista. Viram despesa financeira no mês de cada parcela; o custo dos itens fica pelo valor à vista.
        </Callout>
      ) : multi && interestValue < 0 ? (
        <Callout tone="danger">O total parcelado ({formatBRL(installmentsTotal)}) é menor que o valor à vista ({formatBRL(cashTotal)}).</Callout>
      ) : null}

      <div className="rounded-lg border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-subtle/60 px-3 py-2">
          <p className="text-sm font-semibold">
            {cash ? 'Pagamento' : `Parcelas (${installments.rows.length})`}
            <span className="ml-2 text-xs font-normal text-muted">soma {formatBRL(installments.sum)}</span>
          </p>
          {multi && installments.rows.length > 1 ? (
            editing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange({ edited: {} });
                  setEditing(false);
                }}
              >
                <RotateCcw /> Cálculo automático
              </Button>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil /> Editar valores
              </Button>
            )
          ) : null}
        </div>
        <ol className="grid grid-cols-1 gap-x-6 px-3 py-1 sm:grid-cols-2">
          {installments.rows.map((row, i) => (
            <li key={i} className="flex min-h-10 items-center gap-3 border-b border-line/60 py-1 text-sm last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
              <span className="w-12 shrink-0 text-xs text-muted">
                {i + 1}/{installments.rows.length}
              </span>
              <span className="num">{formatDateBR(row.due_date)}</span>
              {cash ? <Badge tone="success">paga na compra</Badge> : null}
              {row.adjusted ? (
                <span className="text-xs text-muted" title="Recalculada para fechar o total">
                  ajustada
                </span>
              ) : null}
              <span className="ml-auto">
                {editing ? (
                  <span className="block w-32">
                    <MoneyInput
                      value={row.amount}
                      aria-label={`Valor da parcela ${i + 1}`}
                      onValueChange={(v) => {
                        const next = { ...state.edited };
                        if (v === null) delete next[i];
                        else next[i] = v;
                        onChange({ edited: next });
                      }}
                    />
                  </span>
                ) : (
                  <Money value={row.amount} className={cn('font-medium', row.edited && 'text-accent-ink')} />
                )}
              </span>
            </li>
          ))}
        </ol>
        {installments.error ? (
          <p role="alert" className="border-t border-line px-3 py-2 text-sm font-medium text-danger">
            {installments.error}
          </p>
        ) : editing ? (
          <p className="border-t border-line px-3 py-2 text-xs text-muted">Edite para bater com a fatura; a última parcela se ajusta para fechar o total.</p>
        ) : null}
      </div>
    </div>
  );
}
