import { Plus, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useOwnerInvestment } from '@/data/dashboard';
import {
  MANUAL_OWNER_KINDS,
  OWNER_KIND_LABELS,
  type OwnerMovement,
  type OwnerMovementKind,
  useAccounts,
  useOwnerMovements,
  useRegisterOwnerMovement,
  useReverseOwnerMovement,
} from '@/data/finance';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { capitalize, formatDateBR, monthLabel } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { formatBRL, formatPercent, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { FinanceNav } from './finance-nav';

/** Investimento do dono (US-7.8, US-7.9, RN-19, RN-27): quanto entrou, quanto saiu e quanto já voltou em resultado. */
export function OwnerPage() {
  const { can } = useMember();
  const investment = useOwnerInvestment();
  const movements = useOwnerMovements();
  const [registering, setRegistering] = useState(false);
  const [reversing, setReversing] = useState<OwnerMovement | null>(null);
  const reverse = useReverseOwnerMovement(() => setReversing(null));
  const rows = useMemo(() => (movements.data ?? []).filter((m) => m.reverses_id === null), [movements.data]);

  const exportColumns: ExportColumn<OwnerMovement>[] = [
    { header: 'Data', value: (m) => formatDateBR(m.occurred_on) },
    { header: 'Tipo', value: (m) => OWNER_KIND_LABELS[m.kind] },
    { header: 'Valor', value: (m) => m.amount, kind: 'money' },
    { header: 'Sentido', value: (m) => (m.direction === 'DONO_PARA_EMPRESA' ? 'Dono → empresa' : 'Empresa → dono') },
    { header: 'Compra', value: (m) => m.purchase_number ?? '' },
    { header: 'Observação', value: (m) => m.notes ?? '' },
    { header: 'Estornado', value: (m) => (m.is_reversed ? 'sim' : '') },
  ];

  const inv = investment.data;
  const recovered = inv?.recovered_pct === null || inv?.recovered_pct === undefined ? null : Math.max(0, Math.min(1, toNumber(inv.recovered_pct)));

  return (
    <Page>
      <PageHeader
        title="Dono e investimento"
        description="O que o dono colocou na Wabee (dinheiro, parcelas pagas no cartão pessoal) e o que já voltou como resultado."
        actions={
          can('write') ? (
            <Button onClick={() => setRegistering(true)}>
              <Plus /> Registrar movimento
            </Button>
          ) : undefined
        }
      />
      <FinanceNav />
      {investment.isError ? (
        <ErrorState error={investment.error} />
      ) : !inv ? (
        <LoadingBlock rows={2} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Investimento líquido" value={inv.net_investment} hint={`${formatBRL(inv.invested)} entraram · ${formatBRL(inv.withdrawn)} voltaram ao dono`} />
            <Stat label="Retorno acumulado" value={inv.accumulated_return} signed hint="Resultado operacional desde o início" />
            <Stat label="Falta recuperar" value={inv.remaining_to_recover} />
            <Stat
              label="Previsão para recuperar"
              value={inv.months_to_recover}
              format={(v) => (v === null || v === undefined ? '—' : `${v} ${toNumber(v) === 1 ? 'mês' : 'meses'}`)}
              hint={inv.avg_result_3m === null ? 'Precisa de 3 meses de histórico' : `Média dos últimos 3 meses: ${formatBRL(inv.avg_result_3m)}`}
              estimated={inv.months_to_recover !== null}
            />
          </div>
          {recovered !== null ? (
            <Card className="mb-4 p-4">
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="font-medium">Investimento recuperado</span>
                <span className="num font-semibold">{toNumber(inv.recovered_pct) < 0 ? 'ainda sem retorno' : formatPercent(recovered)}</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-subtle" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(recovered * 100)} aria-label="Investimento recuperado">
                <div className="h-full rounded-full honey-stripes bg-accent" style={{ width: `${recovered * 100}%` }} />
              </div>
            </Card>
          ) : null}
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Saldos com o dono" />
              <dl className="divide-y divide-line text-sm">
                <Row label="Empréstimos a devolver ao dono" value={inv.loan_balance} />
                <Row label="Despesas a reembolsar ao dono" value={inv.pending_reimbursements} />
                <Row label="Parcelas assumidas pelo dono (total)" value={inv.owner_committed_total} />
                <Row label="Já pagas pelo dono" value={inv.owner_paid_total} />
              </dl>
            </Card>
            <Card>
              <CardHeader title="Parcelas futuras no cartão do dono" description="Não saem do caixa da empresa; viram investimento quando pagas." />
              {inv.owner_future_installments.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted">Nenhuma parcela futura.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {inv.owner_future_installments.slice(0, 12).map((f) => (
                    <li key={f.month} className="flex justify-between px-4 py-2">
                      <span>{capitalize(monthLabel(f.month))}</span>
                      <Money value={f.amount} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-line px-4 py-2 text-right">
                <Link to="/financeiro/pagar?pagador=DONO" className="text-sm underline decoration-accent decoration-2 underline-offset-4">
                  Ver parcelas do dono
                </Link>
              </div>
            </Card>
          </div>
        </>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-sans text-sm font-semibold">Movimentos</h2>
        <ExportMenu rows={rows} columns={exportColumns} fileName="movimentos-do-dono" />
      </div>
      {movements.isError ? (
        <ErrorState error={movements.error} />
      ) : !movements.data ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhum movimento" description="Aportes, empréstimos, parcelas pagas no cartão pessoal, pró-labore e retiradas aparecem aqui." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
          {rows.map((m) => {
            const inbound = m.direction === 'DONO_PARA_EMPRESA';
            const manual = m.installment_id === null && m.stock_movement_id === null;
            return (
              <li key={m.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm', m.is_reversed && 'opacity-60')}>
                <span className="num w-20 shrink-0 text-muted">{formatDateBR(m.occurred_on)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{OWNER_KIND_LABELS[m.kind]}</span>
                  {m.is_reversed ? <Badge className="ml-1.5">estornado</Badge> : null}
                  <span className="block truncate text-xs text-muted">
                    {m.purchase_number ? (
                      <Link to={`/compras/${m.purchase_id}`} className="underline decoration-accent decoration-2 underline-offset-2">
                        {m.purchase_number}
                      </Link>
                    ) : null}
                    {m.notes ? `${m.purchase_number ? ' · ' : ''}${m.notes}` : ''}
                    {m.installment_id ? ' · parcela paga pelo dono' : ''}
                  </span>
                </span>
                <span className={cn('num w-28 text-right font-semibold', inbound ? 'text-success' : 'text-ink')}>
                  {inbound ? '+' : '−'}
                  {formatBRL(m.amount)}
                </span>
                {can('write') && manual && !m.is_reversed ? (
                  <Button size="icon-sm" variant="ghost" aria-label="Estornar" title="Estornar" onClick={() => setReversing(m)}>
                    <RotateCcw />
                  </Button>
                ) : (
                  <span className="w-8" />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">+ entrou na empresa (investimento) · − voltou ao dono. Parcelas pagas pelo dono são estornadas em Contas a pagar.</p>

      {registering ? <OwnerMovementDialog onOpenChange={setRegistering} /> : null}
      <ReasonDialog
        open={reversing !== null}
        onOpenChange={(o) => !o && setReversing(null)}
        title="Estornar este movimento?"
        description={reversing ? `${OWNER_KIND_LABELS[reversing.kind]} de ${formatBRL(reversing.amount)} em ${formatDateBR(reversing.occurred_on)}. O lançamento de caixa também é estornado.` : ''}
        confirmLabel="Estornar"
        onConfirm={(reason) => reverse.mutateAsync({ id: reversing!.id, reason })}
      />
    </Page>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 px-4 py-2.5">
      <dt className="text-ink-soft">{label}</dt>
      <dd>
        <Money value={value} className="font-medium" />
      </dd>
    </div>
  );
}

function OwnerMovementDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { today } = useMember();
  const [requestId, renew] = useRequestId();
  const accounts = useAccounts();
  const company = (accounts.data ?? []).filter((a) => a.owner === 'EMPRESA' && a.kind !== 'CARTAO_CREDITO');
  const [kind, setKind] = useState<OwnerMovementKind>('CAPITAL_CONTRIBUTION');
  const [amount, setAmount] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const register = useRegisterOwnerMovement((w) => {
    renew();
    if (w) setWarning(w);
    else onOpenChange(false);
  });
  const option = MANUAL_OWNER_KINDS.find((k) => k.kind === kind)!;
  const account = accountId || (company.length === 1 ? String(company[0]!.id) : '');
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title="Movimento do dono"
        description="Dinheiro que o dono coloca ou tira da empresa pela conta da empresa."
        footer={
          warning ? (
            <Button onClick={() => onOpenChange(false)}>Entendi</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                loading={register.isPending}
                disabled={!amount || !account}
                onClick={() =>
                  register.mutate({ requestId, kind, amount: amount!, occurredOn: date, accountId: Number(account), notes: notes.trim() || null }, { onError: (e) => setError(describeError(e)) })
                }
              >
                Registrar
              </Button>
            </>
          )
        }
      >
        {warning ? (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Registrado, com um alerta: {warning}</p>
        ) : (
          <div className="space-y-4">
            <Field label="Tipo" hint={option.hint}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as OwnerMovementKind)}>
                <optgroup label="Dono → empresa">
                  {MANUAL_OWNER_KINDS.filter((k) => k.direction === 'IN').map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {OWNER_KIND_LABELS[k.kind]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Empresa → dono">
                  {MANUAL_OWNER_KINDS.filter((k) => k.direction === 'OUT').map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {OWNER_KIND_LABELS[k.kind]}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Valor" required>
                <MoneyInput value={amount} onValueChange={setAmount} autoFocus />
              </Field>
              <Field label="Data">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <Field label={option.direction === 'IN' ? 'Entrou na conta' : 'Saiu da conta'} required hint={company.length === 0 ? 'Cadastre uma conta da empresa primeiro.' : undefined}>
              <Select value={account} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Escolha…</option>
                {company.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Observação">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
