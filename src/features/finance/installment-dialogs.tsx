import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { FUNDING_LABELS, type InstallmentRow, type Payer, PAYER_LABELS, useAccounts, usePayInstallment, useReceiveInstallment } from '@/data/finance';
import { useMember } from '@/features/member/member-context';
import { formatDateBR } from '@/lib/dates';
import { formatBRL, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';

interface Props {
  installment: InstallmentRow | null;
  onOpenChange: (open: boolean) => void;
  /** Taxa de pagamento sugerida (fração), ex.: payment_fee_pct do canal. */
  suggestedFeePct?: number | null;
}

/**
 * Baixa de parcela a pagar (US-7.4, RN-19): pela conta da empresa vira saída de caixa;
 * por conta ou cartão do dono vira movimento do dono (aporte, empréstimo ou reembolso).
 */
export function PayInstallmentDialog({ installment, onOpenChange }: Props) {
  const { today } = useMember();
  const [requestId, renew] = useRequestId();
  const accounts = useAccounts();
  const [paidOn, setPaidOn] = useState(today());
  const [accountId, setAccountId] = useState<string>('');
  const [payer, setPayer] = useState<Payer | ''>('');
  const [amount, setAmount] = useState<string | null>(null);
  const [remainder, setRemainder] = useState<'DESCONTO' | 'SALDO'>('DESCONTO');
  const [notes, setNotes] = useState('');
  const pay = usePayInstallment(() => {
    renew();
    onOpenChange(false);
  });
  if (!installment) return null;
  const account = accounts.data?.find((a) => String(a.id) === accountId);
  const effectivePayer: Payer = account?.owner === 'DONO' ? 'DONO' : (payer || installment.payer);
  const value = amount ?? String(installment.amount);
  const diff = toNumber(value) - toNumber(installment.amount);
  const companyCash = (accounts.data ?? []).filter((a) => a.owner === 'EMPRESA' && a.kind !== 'CARTAO_CREDITO');
  const ownerAccounts = (accounts.data ?? []).filter((a) => a.owner === 'DONO');
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`Pagar parcela ${installment.number} de ${installment.of_total}`}
        description={`${installment.counterparty_name ?? installment.description} · vence ${formatDateBR(installment.due_date)} · ${formatBRL(installment.amount)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              loading={pay.isPending}
              disabled={effectivePayer === 'EMPRESA' && !accountId}
              onClick={() =>
                pay.mutate({
                  requestId,
                  installmentId: installment.id,
                  paidOn,
                  accountId: accountId ? Number(accountId) : null,
                  amount: value,
                  payer: effectivePayer,
                  remainder,
                  notes: notes.trim() || null,
                })
              }
            >
              Registrar pagamento
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Data do pagamento" required>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="Valor pago" required>
              <MoneyInput value={value} onValueChange={setAmount} />
            </Field>
          </div>
          <Field label="De onde saiu o dinheiro" hint="Conta ou cartão do dono: não sai do caixa da empresa, vira investimento do dono.">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{installment.payer === 'DONO' ? 'Pago pelo dono (sem conta)' : 'Escolha a conta…'}</option>
              {companyCash.length > 0 ? (
                <optgroup label="Contas da empresa">
                  {companyCash.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {ownerAccounts.length > 0 ? (
                <optgroup label="Do dono">
                  {ownerAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
          {!account ? (
            <Field label="Quem pagou">
              <Select value={payer || installment.payer} onChange={(e) => setPayer(e.target.value as Payer)}>
                <option value="EMPRESA">Empresa</option>
                <option value="DONO">Dono</option>
              </Select>
            </Field>
          ) : null}
          <p className="text-sm">
            Pagador: <Badge tone={effectivePayer === 'DONO' ? 'accent' : 'neutral'}>{PAYER_LABELS[effectivePayer]}</Badge>
            {effectivePayer === 'DONO' && installment.owner_funding_type ? <span className="ml-2 text-xs text-muted">vira {FUNDING_LABELS[installment.owner_funding_type].toLowerCase()}</span> : null}
          </p>
          {diff > 0 ? <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{formatBRL(diff)} a mais serão lançados como juros/multa por atraso.</p> : null}
          {diff < 0 ? (
            <Field label={`Faltam ${formatBRL(-diff)}`}>
              <Select value={remainder} onChange={(e) => setRemainder(e.target.value as 'DESCONTO' | 'SALDO')}>
                <option value="DESCONTO">Foi desconto obtido (quita a parcela)</option>
                <option value="SALDO">Continua em aberto (nova parcela com o restante)</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Observação">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className="min-h-14" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Baixa de parcela a receber (US-6.7): entra no caixa pelo valor líquido; a taxa vai para despesas de venda. */
export function ReceiveInstallmentDialog({ installment, onOpenChange, suggestedFeePct }: Props) {
  const { today } = useMember();
  const [requestId, renew] = useRequestId();
  const accounts = useAccounts();
  const companyAccounts = (accounts.data ?? []).filter((a) => a.owner === 'EMPRESA' && a.kind !== 'CARTAO_CREDITO');
  const [receivedOn, setReceivedOn] = useState(today());
  const [accountId, setAccountId] = useState<string>('');
  const [amount, setAmount] = useState<string | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const [remainder, setRemainder] = useState<'SALDO' | 'DESCONTO'>('SALDO');
  const receive = useReceiveInstallment(() => {
    renew();
    onOpenChange(false);
  });
  if (!installment) return null;
  const value = amount ?? String(installment.amount);
  const feeValue = fee ?? (suggestedFeePct ? (Math.round(toNumber(value) * toNumber(suggestedFeePct) * 100) / 100).toFixed(2) : '0');
  const diff = toNumber(value) - toNumber(installment.amount);
  const account = accountId || (companyAccounts.length === 1 ? String(companyAccounts[0]!.id) : '');
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`Receber parcela ${installment.number} de ${installment.of_total}`}
        description={`${installment.counterparty_name ?? installment.description} · vence ${formatDateBR(installment.due_date)} · ${formatBRL(installment.amount)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              loading={receive.isPending}
              disabled={!account}
              onClick={() => receive.mutate({ requestId, installmentId: installment.id, receivedOn, accountId: Number(account), amount: value, fee: feeValue, remainder })}
            >
              Registrar recebimento
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Data do recebimento" required>
              <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </Field>
            <Field label="Valor recebido" required>
              <MoneyInput value={value} onValueChange={setAmount} />
            </Field>
          </div>
          <Field
            label="Conta da empresa"
            required
            hint={companyAccounts.length === 0 ? 'Cadastre uma conta da empresa em Financeiro → Contas (se recebe no seu Pix pessoal, crie uma conta "Pix (empresa)" marcada como da empresa).' : undefined}
          >
            <Select value={account} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Escolha a conta…</option>
              {companyAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Taxa (maquininha, Pix com tarifa, antecipação)" hint={`Entra no caixa: ${formatBRL(toNumber(value) - toNumber(feeValue))}`}>
            <MoneyInput value={feeValue} onValueChange={setFee} />
          </Field>
          {diff < 0 ? (
            <Field label={`Faltam ${formatBRL(-diff)}`}>
              <Select value={remainder} onChange={(e) => setRemainder(e.target.value as 'SALDO' | 'DESCONTO')}>
                <option value="SALDO">Continua em aberto (nova parcela com o restante)</option>
                <option value="DESCONTO">Desconto ou perda (quita a parcela)</option>
              </Select>
            </Field>
          ) : null}
          {diff > 0 ? <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">{formatBRL(diff)} a mais entram como outras receitas.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
