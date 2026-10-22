import { useMemo } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Money } from '@/components/shared/money';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { LoadingBlock } from '@/components/ui/states';
import { useOverview, useOwnerInvestment } from '@/data/dashboard';
import { useAccounts, useIncomeStatement, useInstallments } from '@/data/finance';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addDays, endOfMonth, formatDateBR, startOfMonth } from '@/lib/dates';
import { formatBRL, formatPercent, toNumber } from '@/lib/money';
import { FinanceNav } from './finance-nav';

/** Resumo do financeiro: caixa, o que vence, resultado do mês e investimento do dono. */
export function FinancePage() {
  const { today } = useMember();
  const from = startOfMonth(today());
  const to = endOfMonth(today());
  const overview = useOverview(from, today());
  const statement = useIncomeStatement(from, to);
  const accounts = useAccounts();
  const open = useInstallments({ status: 'ABERTA', dueTo: addDays(today(), 7) });
  const investment = useOwnerInvestment();
  const result = statement.data?.lines.find((l) => l.key === 'resultado');
  const revenue = statement.data?.lines.find((l) => l.key === 'receita_liquida');
  const upcoming = useMemo(() => [...(open.data ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 10), [open.data]);
  const o = overview.data;

  return (
    <Page>
      <PageHeader title="Financeiro" description="Caixa da empresa, contas a pagar e a receber, resultado e o investimento do dono." />
      <FinanceNav />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Caixa disponível" value={o?.cash_available ?? null} hint="Soma das contas da empresa" />
        <Stat
          label="A pagar em 30 dias"
          value={o?.payable_30d.company ?? null}
          hint={o ? `${toNumber(o.payable_30d.overdue) > 0 ? `${formatBRL(o.payable_30d.overdue)} vencido · ` : ''}${formatBRL(o.payable_30d.owner)} no cartão do dono` : undefined}
          tone={o && toNumber(o.payable_30d.overdue) > 0 ? 'warning' : 'default'}
        />
        <Stat label="A receber" value={o?.receivable.open ?? null} hint={o && toNumber(o.receivable.overdue) > 0 ? `${formatBRL(o.receivable.overdue)} vencido` : `${o?.receivable.count ?? 0} parcela(s)`} />
        <Stat label="Resultado do mês" value={result?.amount ?? null} signed hint={revenue ? `Receita líquida ${formatBRL(revenue.amount)}` : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader
            title="Vence nos próximos 7 dias"
            actions={
              <Link to="/financeiro/pagar" className="text-sm underline decoration-accent decoration-2 underline-offset-4">
                Contas a pagar
              </Link>
            }
          />
          {!open.data ? (
            <div className="p-4">
              <LoadingBlock rows={3} />
            </div>
          ) : upcoming.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nada vencendo nos próximos 7 dias.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {upcoming.map((i) => (
                <li key={i.id}>
                  <Link to={i.kind === 'PAGAR' ? '/financeiro/pagar' : '/financeiro/receber'} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle">
                    <span className={cn('num w-14 shrink-0 font-medium', i.is_overdue && 'text-danger')}>{formatDateBR(i.due_date).slice(0, 5)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {i.counterparty_name ?? i.description}
                      <span className="text-xs text-muted">
                        {' '}
                        · {i.number}/{i.of_total}
                      </span>
                    </span>
                    <Badge tone={i.kind === 'RECEBER' ? 'success' : i.payer === 'DONO' ? 'accent' : 'neutral'}>{i.kind === 'RECEBER' ? 'receber' : i.payer === 'DONO' ? 'dono paga' : 'pagar'}</Badge>
                    <Money value={i.amount} className="w-24 text-right font-medium" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Contas da empresa"
              actions={
                <Link to="/financeiro/contas" className="text-sm underline decoration-accent decoration-2 underline-offset-4">
                  Ver
                </Link>
              }
            />
            <ul className="divide-y divide-line text-sm">
              {(accounts.data ?? [])
                .filter((a) => a.owner === 'EMPRESA' && a.kind !== 'CARTAO_CREDITO')
                .map((a) => (
                  <li key={a.id}>
                    <Link to={`/financeiro/contas/${a.id}`} className="flex justify-between gap-2 px-4 py-2.5 hover:bg-subtle">
                      <span className="truncate">{a.name}</span>
                      <Money value={a.balance} className="font-medium" />
                    </Link>
                  </li>
                ))}
            </ul>
          </Card>
          {investment.data ? (
            <Card className="p-4">
              <p className="text-xs text-muted">Investimento líquido do dono</p>
              <Money value={investment.data.net_investment} className="text-xl font-semibold" />
              {investment.data.recovered_pct !== null && toNumber(investment.data.recovered_pct) <= 0 ? (
                <p className="mt-1 text-xs text-muted">O resultado acumulado ainda não começou a devolver o investimento.</p>
              ) : investment.data.recovered_pct !== null ? (
                <>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-subtle">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(1, Math.max(0, toNumber(investment.data.recovered_pct))) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{formatPercent(investment.data.recovered_pct)} recuperado com o resultado</p>
                </>
              ) : null}
              <Link to="/financeiro/dono" className="mt-2 inline-block text-sm underline decoration-accent decoration-2 underline-offset-4">
                Detalhes
              </Link>
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
