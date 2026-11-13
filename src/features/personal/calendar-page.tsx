import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type PfCalendarDay, usePfBudget, usePfCalendar, usePfPlans, usePfSchedule, usePfTransactions } from '@/data/personal';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addDays, addMonths, capitalize, formatDateBR, monthLabel, startOfMonth } from '@/lib/dates';
import { formatNumber } from '@/lib/money';
import { usePersonalActions } from './actions';
import { PMoney } from './privacy';
import { usePrivacy } from './privacy-context';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Reais inteiros, curtos para caber na célula ("45", "1,2 mil"). */
function compact(value: number): string {
  if (value >= 1000) return `${formatNumber(value / 1000, 1)} mil`;
  return formatNumber(Math.round(value), 0);
}

function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

type Status = 'ok' | 'over' | 'none' | 'future';

function statusOf(day: PfCalendarDay): Status {
  if (day.is_future) return 'future';
  if (day.spent <= 0) return 'none';
  if (day.allowance === null) return 'ok';
  return day.spent > day.allowance + 0.005 ? 'over' : 'ok';
}

/** Calendário do mês: quanto foi gasto em cada dia, o limite que valia e os vencimentos. */
export function CalendarPage() {
  const { today: todayFn } = useMember();
  const today = todayFn();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? `${params.get('mes')}-01` : startOfMonth(today);
  const selected = params.get('dia') ?? (month === startOfMonth(today) ? today : month);
  const calendar = usePfCalendar(month);
  const opening = usePfBudget(month);
  const plans = usePfPlans();
  // O que ficou em aberto antes deste mês (recebimentos e contas ainda não baixados) também mexe no saldo.
  const carried = usePfSchedule({ to: addDays(month, -1), status: 'PREVISTO' });
  const { hidden } = usePrivacy();
  const { openAdd } = usePersonalActions();

  const go = (delta: number) => {
    const next = new URLSearchParams(params);
    next.set('mes', addMonths(month, delta).slice(0, 7));
    next.delete('dia');
    setParams(next, { replace: true });
  };
  const select = (date: string) => {
    const next = new URLSearchParams(params);
    next.set('dia', date);
    setParams(next, { replace: true });
  };

  const stats = useMemo(() => {
    const past = (calendar.data?.days ?? []).filter((d) => !d.is_future);
    const spent = past.reduce((sum, d) => sum + d.spent, 0);
    const withSpending = past.filter((d) => d.spent > 0);
    const inside = withSpending.filter((d) => statusOf(d) === 'ok').length;
    return { spent, average: past.length > 0 ? spent / past.length : 0, inside, spendingDays: withSpending.length };
  }, [calendar.data]);

  // Entradas e saídas do mês: o que já aconteceu mais o que está previsto (vencimentos ainda em aberto).
  const flow = useMemo(() => {
    const all = calendar.data?.days ?? [];
    let received = 0;
    let toReceive = 0;
    let paid = 0;
    let toPay = 0;
    for (const d of all) {
      received += d.income;
      paid += d.spent + d.paid_bills;
      for (const b of d.bills) {
        if (b.status !== 'PREVISTO') continue;
        if (b.kind === 'ENTRADA_FIXA') toReceive += b.amount;
        else toPay += b.amount;
      }
    }
    const income = received + toReceive;
    const expense = paid + toPay;
    // Ajuste de saldo do 1º dia do mês já está no saldo de abertura (vale desde o início do dia).
    const adjust = all.filter((d) => d.date !== month).reduce((sum, d) => sum + d.adjust, 0);
    return { received, toReceive, income, paid, toPay, expense, adjust };
  }, [calendar.data, month]);

  // Dívida total: o que falta pagar de parcelado, cartão parcelado, empréstimo e financiamento (conta fixa fica de fora).
  const debt = useMemo(() => {
    const open = (plans.data ?? []).filter((p) => p.status === 'ATIVO' && (p.kind === 'PARCELADO' || p.kind === 'FINANCIAMENTO') && p.open_count > 0);
    const lastDue = open.reduce<string | null>((latest, p) => (p.last_due && (!latest || p.last_due > latest) ? p.last_due : latest), null);
    return {
      total: open.reduce((sum, p) => sum + p.remaining_amount, 0),
      installments: open.reduce((sum, p) => sum + p.open_count, 0),
      contracts: open.length,
      lastDue,
    };
  }, [plans.data]);

  if (calendar.isError) return <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />;

  const days = calendar.data?.days ?? [];
  const lead = days[0] ? weekday(days[0].date) : 0;
  const current = days.find((d) => d.date === selected) ?? null;

  const startBalance =
    opening.data && carried.data ? opening.data.balance + carried.data.reduce((sum, r) => sum + (r.plan_kind === 'ENTRADA_FIXA' ? r.amount : -r.amount), 0) : undefined;
  const endBalance = startBalance === undefined ? null : startBalance + flow.income - flow.expense + flow.adjust;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={`Resumo de ${monthLabel(month)}`}>
        <FlowCard className="col-span-2 lg:col-span-1" label="Saldo no fim do mês" loading={endBalance === null || !calendar.data} hint={startBalance === undefined ? undefined : <>Saldo no início do mês <PMoney value={startBalance} /></>}>
          <PMoney value={endBalance ?? 0} className={cn((endBalance ?? 0) < 0 && 'text-danger')} />
        </FlowCard>
        <FlowCard label="Entradas do mês" loading={!calendar.data} hint={<>recebido <PMoney value={flow.received} /> · a receber <PMoney value={flow.toReceive} /></>}>
          <PMoney value={flow.income} className="text-success" />
        </FlowCard>
        <FlowCard label="Saídas do mês" loading={!calendar.data} hint={<>pago <PMoney value={flow.paid} /> · a pagar <PMoney value={flow.toPay} /></>}>
          <PMoney value={flow.expense} />
        </FlowCard>
        <FlowCard
          className="col-span-2 lg:col-span-1"
          label="Dívida em parcelas"
          loading={!plans.data}
          hint={
            debt.contracts === 0 ? (
              'Nenhuma parcela em aberto.'
            ) : (
              <>
                {debt.installments} {debt.installments === 1 ? 'parcela' : 'parcelas'} em {debt.contracts} {debt.contracts === 1 ? 'cadastro' : 'cadastros'}
                {debt.lastDue ? ` · última em ${formatDateBR(debt.lastDue).slice(3)}` : ''}
              </>
            )
          }
        >
          <PMoney value={debt.total} className={cn(debt.total > 0 && 'text-danger')} />
        </FlowCard>
      </dl>

      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <Button variant="ghost" size="icon-sm" aria-label="Mês anterior" onClick={() => go(-1)}>
            <ChevronLeft />
          </Button>
          <h2 className="font-sans text-base font-semibold">{capitalize(monthLabel(month))}</h2>
          <Button variant="ghost" size="icon-sm" aria-label="Próximo mês" onClick={() => go(1)}>
            <ChevronRight />
          </Button>
        </div>
        {!calendar.data ? (
          <div className="p-4">
            <LoadingBlock rows={5} />
          </div>
        ) : (
          <div className="p-2 sm:p-3">
            <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[0.7rem] font-medium uppercase text-muted" aria-hidden>
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <ol className="grid grid-cols-7 gap-1">
              {Array.from({ length: lead }, (_, i) => (
                <li key={`b${i}`} aria-hidden />
              ))}
              {days.map((d) => {
                const status = statusOf(d);
                const isToday = d.date === today;
                const isSelected = d.date === selected;
                const dayNumber = Number(d.date.slice(8));
                const label = `${formatDateBR(d.date)}${hidden ? '' : d.spent > 0 ? `, gasto ${compact(d.spent)} reais` : ''}`;
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      onClick={() => select(d.date)}
                      aria-label={label}
                      aria-pressed={isSelected}
                      className={cn(
                        'flex h-[4.4rem] w-full flex-col items-stretch rounded-lg border p-1 text-left transition-colors sm:h-[5.2rem] sm:p-1.5',
                        status === 'over' && 'border-danger/40 bg-danger-soft',
                        status === 'ok' && 'border-success/30 bg-success-soft',
                        (status === 'none' || status === 'future') && 'border-line bg-panel',
                        d.is_future && 'text-muted',
                        isToday && 'ring-2 ring-accent',
                        isSelected && 'outline outline-2 outline-offset-1 outline-ink',
                      )}
                    >
                      <span className="flex items-center justify-between text-xs font-semibold">
                        <span className={cn(isToday && 'rounded bg-accent px-1 text-ink')}>{dayNumber}</span>
                        {d.is_cycle_start ? <span className="text-[0.6rem] font-medium text-info" title="Começa um novo ciclo">novo ciclo</span> : null}
                      </span>
                      <span className="mt-auto space-y-0.5">
                        {d.income > 0 ? <span className="num block text-[0.65rem] font-medium text-success">{hidden ? '+•••' : `+${compact(d.income)}`}</span> : null}
                        {d.spent > 0 ? <span className={cn('num block text-xs font-semibold sm:text-sm', status === 'over' ? 'text-danger' : 'text-ink')}>{hidden ? '•••' : compact(d.spent)}</span> : null}
                        {d.bills.length > 0 ? (
                          <span className="flex items-center gap-0.5" aria-hidden>
                            {d.bills.slice(0, 3).map((b) => (
                              <span key={b.schedule_id} className={cn('size-1.5 rounded-full', b.status === 'PAGO' ? 'bg-success' : b.status === 'PULADO' ? 'bg-muted' : 'bg-warning')} />
                            ))}
                          </span>
                        ) : null}
                        {d.allowance !== null && !hidden ? <span className="num block text-[0.6rem] leading-none text-muted">lim {compact(d.allowance)}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
              <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded bg-success-soft ring-1 ring-success/40" /> dentro do limite</li>
              <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded bg-danger-soft ring-1 ring-danger/40" /> passou do limite</li>
              <li className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-warning" /> conta ou parcela a vencer</li>
              <li>"lim" = quanto podia gastar naquele dia</li>
            </ul>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {current ? <DayDetail day={current} onAdd={() => openAdd(current.is_future ? undefined : current.date)} /> : <div />}
        <Card>
          <CardHeader title="Resumo do mês" />
          <dl className="space-y-2 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Gasto do dia a dia</dt><dd><PMoney value={stats.spent} className="font-semibold" /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Média por dia</dt><dd><PMoney value={stats.average} /></dd></div>
            <div className="flex justify-between">
              <dt className="text-muted">Dias dentro do limite</dt>
              <dd className="num">{stats.spendingDays === 0 ? '—' : `${stats.inside} de ${stats.spendingDays}`}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function FlowCard({ label, hint, loading, className, children }: { label: string; hint?: React.ReactNode; loading?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-line bg-panel p-3', className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold">{loading ? <span className="text-muted">…</span> : children}</dd>
      {!loading && hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function DayDetail({ day, onAdd }: { day: PfCalendarDay; onAdd: () => void }) {
  const txs = usePfTransactions({ from: day.date, to: day.date });
  const over = !day.is_future && day.allowance !== null && day.spent > day.allowance + 0.005;
  return (
    <Card>
      <CardHeader
        title={capitalize(new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`)))}
        description={
          day.allowance === null ? undefined : (
            <span>
              {day.is_future ? 'Limite previsto' : 'Limite do dia'}: <PMoney value={day.allowance} />
              {!day.is_future ? (
                <>
                  {' '}
                  · gasto <PMoney value={day.spent} className={cn(over && 'font-semibold text-danger')} />
                </>
              ) : null}
            </span>
          )
        }
        actions={
          !day.is_future ? (
            <Button size="sm" variant="outline" onClick={onAdd}>
              <Plus /> Lançar neste dia
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 p-4">
        {day.bills.length > 0 ? (
          <section aria-label="Vencimentos do dia">
            <h3 className="mb-1.5 text-xs font-medium uppercase text-muted">Vencimentos</h3>
            <ul className="space-y-1">
              {day.bills.map((b) => (
                <li key={b.schedule_id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {b.name} <Badge tone={b.status === 'PAGO' ? 'success' : b.status === 'PULADO' ? 'neutral' : 'warning'}>{b.status === 'PAGO' ? (b.kind === 'ENTRADA_FIXA' ? 'recebido' : 'pago') : b.status === 'PULADO' ? 'pulado' : 'a vencer'}</Badge>
                  </span>
                  <PMoney value={b.amount} className="font-medium" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {!day.is_future ? (
          <section aria-label="Lançamentos do dia">
            <h3 className="mb-1.5 text-xs font-medium uppercase text-muted">Lançamentos</h3>
            {txs.isError ? (
              <ErrorState error={txs.error} />
            ) : !txs.data ? (
              <LoadingBlock rows={2} />
            ) : txs.data.length === 0 ? (
              <p className="text-sm text-muted">Nada lançado neste dia.</p>
            ) : (
              <ul className="divide-y divide-line">
                {txs.data.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      {t.description || t.category_name || 'Sem descrição'}
                      <span className="text-xs text-muted"> · {t.category_name ?? (t.kind === 'TRANSFERENCIA' ? 'transferência' : 'sem categoria')}</span>
                    </span>
                    <PMoney value={t.kind === 'GASTO' ? -t.amount : t.amount} signed={t.kind === 'ENTRADA'} className={cn('font-medium', t.kind === 'ENTRADA' && 'text-success')} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : day.bills.length === 0 ? (
          <p className="text-sm text-muted">Dia ainda por vir. Se gastar exatamente o limite até lá, ele continua igual.</p>
        ) : null}
      </div>
    </Card>
  );
}
