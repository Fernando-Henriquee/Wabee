import { AlertTriangle, ArrowRight, CalendarCheck, Mic, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type PfBill, usePfAccounts, usePfBudget, usePfTransactions } from '@/data/personal';
import { cn } from '@/lib/cn';
import { diffInDays, formatDateBR } from '@/lib/dates';
import { usePersonalActions } from './actions';
import { PayDialog, type PayTarget } from './plan-dialogs';
import { PMoney } from './privacy';

function shortDate(iso: string) {
  return formatDateBR(iso).slice(0, 5);
}

function Row({ label, value, sign, strong }: { label: string; value: number; sign?: '+' | '−'; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1.5 text-sm', strong && 'border-t border-line pt-2 font-semibold')}>
      <dt className="text-ink-soft">
        {sign ? <span className="mr-1.5 inline-block w-3 text-center text-muted">{sign}</span> : null}
        {label}
      </dt>
      <dd>
        <PMoney value={value} />
      </dd>
    </div>
  );
}

/** Hoje: quanto posso gastar, quanto já gastei, o que vence e os últimos lançamentos. */
export function TodayPage() {
  const { openAdd } = usePersonalActions();
  const budget = usePfBudget();
  const recent = usePfTransactions({ limit: 8 });
  const accounts = usePfAccounts();
  const [pay, setPay] = useState<PayTarget | null>(null);

  if (budget.isError) return <ErrorState error={budget.error} onRetry={() => void budget.refetch()} />;
  if (!budget.data) return <LoadingBlock />;
  const b = budget.data;
  const over = b.remaining < -0.005;
  const used = b.allowance > 0 ? Math.min(b.spent / b.allowance, 1) : b.spent > 0 ? 1 : 0;
  const noMoney = b.available <= 0;
  const hasData = (accounts.data ?? []).some((a) => a.opening_balance !== 0) || (recent.data ?? []).length > 0;
  const billsToPay = b.next_bills.filter((bill) => bill.kind !== 'ENTRADA_FIXA');
  const daysToEnd = b.days_left;

  const openPay = (bill: PfBill) =>
    setPay({ scheduleId: bill.schedule_id, name: bill.installments_total ? `${bill.name} (${bill.number}/${bill.installments_total})` : bill.name, amount: bill.amount, dueDate: bill.due_date, income: bill.kind === 'ENTRADA_FIXA' });

  return (
    <div className="space-y-5">
      {!hasData ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Para o cálculo fazer sentido, informe o saldo das suas contas em{' '}
          <Link to="/pessoal/ajustes" className="font-semibold underline underline-offset-2">
            Ajustes
          </Link>{' '}
          e cadastre seu salário e suas contas em{' '}
          <Link to="/pessoal/parcelas" className="font-semibold underline underline-offset-2">
            Parcelas e contas
          </Link>
          .
        </div>
      ) : null}

      <Card className={cn(over && 'border-danger/40')}>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted">Hoje você pode gastar</p>
              <p className={cn('num font-display text-4xl font-bold leading-tight sm:text-5xl', noMoney && 'text-danger')}>
                <PMoney value={b.allowance} />
              </p>
              <p className="mt-1 text-sm text-muted">
                {daysToEnd === 1 ? 'Último dia do ciclo' : `${daysToEnd} dias até ${shortDate(b.cycle_end)}`} · ciclo de {shortDate(b.cycle_start)} a {shortDate(b.cycle_end)}
              </p>
            </div>
            <Button onClick={() => openAdd()} size="lg" className="w-full sm:w-auto">
              <Mic /> Lançar gasto
            </Button>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span>
                Gasto hoje: <PMoney value={b.spent} className="font-semibold" />
              </span>
              <span className={cn('font-medium', over ? 'text-danger' : 'text-success')}>
                {over ? (
                  <>
                    passou <PMoney value={Math.abs(b.remaining)} />
                  </>
                ) : (
                  <>
                    resta <PMoney value={b.remaining} />
                  </>
                )}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Quanto do limite de hoje já foi gasto" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}>
              <div className={cn('h-full rounded-full transition-all', over ? 'bg-danger' : used > 0.8 ? 'bg-warning' : 'bg-success')} style={{ width: `${used * 100}%` }} />
            </div>
          </div>

          {noMoney ? (
            <p className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              Pelas contas e parcelas que ainda vencem neste ciclo, não sobra para gastar. Veja em "Parcelas e contas" o que dá para ajustar.
            </p>
          ) : null}

          {b.tomorrow_if_save !== null && b.tomorrow_if_spend !== null ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">Se não gastar mais nada hoje, amanhã você pode</p>
                <p className="text-lg font-semibold text-success">
                  <PMoney value={b.tomorrow_if_save} />
                </p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">Se gastar o que resta hoje, amanhã você pode</p>
                <p className="text-lg font-semibold">
                  <PMoney value={b.tomorrow_if_spend} />
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Hoje é o último dia do ciclo: amanhã começa um novo, com o salário.</p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="De onde vem esse valor" description="O que você tem, menos o que já está comprometido até o fim do ciclo." />
          <dl className="px-4 py-3">
            <Row label="Saldo das contas" value={b.balance} />
            <Row label="Entradas previstas e recebidas no ciclo" value={b.incomes} sign="+" />
            <Row label="Contas e parcelas até o fim do ciclo" value={b.commitments} sign="−" />
            {b.reserve > 0 ? <Row label="Reserva para guardar" value={b.reserve} sign="−" /> : null}
            <Row label="Disponível para gastar" value={b.available} strong />
            <p className="pt-1 text-xs text-muted">Dividido pelos {daysToEnd} {daysToEnd === 1 ? 'dia' : 'dias'} que faltam. O que você não gasta hoje fica para os próximos.</p>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Próximos vencimentos"
            description={b.overdue_count > 0 ? `${b.overdue_count} em atraso` : 'Até o fim do ciclo'}
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/pessoal/parcelas">
                  Ver tudo <ArrowRight />
                </Link>
              </Button>
            }
          />
          {billsToPay.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma conta ou parcela vence até o fim do ciclo.</p>
          ) : (
            <ul className="divide-y divide-line">
              {billsToPay.map((bill) => {
                const days = diffInDays(bill.due_date, b.date);
                return (
                  <li key={bill.schedule_id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {bill.name}
                        {bill.installments_total ? <span className="text-muted"> {bill.number}/{bill.installments_total}</span> : null}
                      </p>
                      <p className={cn('text-xs', bill.overdue ? 'font-medium text-danger' : 'text-muted')}>
                        {bill.overdue ? `Atrasada desde ${shortDate(bill.due_date)}` : days === 0 ? 'Vence hoje' : days === 1 ? 'Vence amanhã' : `Vence ${shortDate(bill.due_date)}`}
                      </p>
                    </div>
                    <PMoney value={bill.amount} className="text-sm font-semibold" />
                    <Button size="sm" variant="outline" onClick={() => openPay(bill)}>
                      Pagar
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Últimos lançamentos"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link to="/pessoal/lancamentos">
                Ver todos <ArrowRight />
              </Link>
            </Button>
          }
        />
        {recent.isError ? (
          <div className="p-4"><ErrorState error={recent.error} /></div>
        ) : !recent.data ? (
          <div className="p-4"><LoadingBlock rows={3} /></div>
        ) : recent.data.length === 0 ? (
          <EmptyState icon={<Wallet />} title="Nenhum lançamento ainda" description='Toque em "Lançar gasto" e diga, por exemplo, "gastei 45 no mercado".' className="m-4" />
        ) : (
          <ul className="divide-y divide-line">
            {recent.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.description || t.category_name || (t.kind === 'TRANSFERENCIA' ? 'Transferência' : 'Sem descrição')}</p>
                  <p className="text-xs text-muted">
                    {shortDate(t.date)} · {t.kind === 'TRANSFERENCIA' ? `${t.account_name} → ${t.to_account_name}` : (t.category_name ?? 'Sem categoria')}
                    {t.schedule_id ? <Badge className="ml-1.5">conta/parcela</Badge> : null}
                    {t.source === 'VOZ' ? <Badge tone="info" className="ml-1.5">voz</Badge> : null}
                  </p>
                </div>
                <PMoney value={t.kind === 'ENTRADA' ? t.amount : t.kind === 'GASTO' ? -t.amount : t.amount} signed={t.kind === 'ENTRADA'} className={cn('text-sm font-semibold', t.kind === 'ENTRADA' && 'text-success')} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <CalendarCheck className="size-3.5" aria-hidden /> Veja o dia a dia no <Link to="/pessoal/calendario" className="underline underline-offset-2">calendário</Link>.
      </p>
      {pay ? <PayDialog target={pay} open onOpenChange={(open) => !open && setPay(null)} /> : null}
    </div>
  );
}
