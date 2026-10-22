import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { ACCOUNT_KIND_LABELS, type CashTransaction, cashSourceHref, useAccounts, useCashTransactions, useInstallments } from '@/data/finance';
import { cn } from '@/lib/cn';
import { sumMoney } from '@/lib/calc';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { toNumber } from '@/lib/money';
import { FinanceNav } from './finance-nav';

/** Extrato da conta (US-7.1, US-7.7) com saldo após cada lançamento. Contas do dono mostram o que ele pagou pela empresa. */
export function AccountDetailPage() {
  const { id } = useParams();
  const accountId = Number(id);
  const accounts = useAccounts({ includeInactive: true });
  const account = accounts.data?.find((a) => a.id === accountId);
  const [range, setRange] = useDateRange('mes');
  const transactions = useCashTransactions({ accountId });
  const ownerPaid = useInstallments({ kind: 'PAGAR', status: 'PAGA' }, account?.owner === 'DONO');

  // Saldo corrente calculado do lançamento mais antigo para o mais novo.
  const withBalance = useMemo(() => {
    if (!account || !transactions.data) return [];
    let balance = toNumber(account.opening_balance);
    return [...transactions.data]
      .reverse()
      .map((t) => {
        if (t.occurred_on >= account.opening_date) balance += toNumber(t.signed_amount);
        return { ...t, balance };
      })
      .reverse();
  }, [account, transactions.data]);

  if (accounts.isError || transactions.isError) return <Page><ErrorState error={accounts.error ?? transactions.error} /></Page>;
  if (!accounts.data || !transactions.data) return <Page><LoadingBlock /></Page>;
  if (!account) return <Page><EmptyState title="Conta não encontrada" /></Page>;

  const rows = withBalance.filter((t) => t.occurred_on >= range.from && t.occurred_on <= range.to);
  const ins = sumMoney(rows.filter((t) => t.direction === 'IN').map((t) => t.amount));
  const outs = sumMoney(rows.filter((t) => t.direction === 'OUT').map((t) => t.amount));
  const ownerRows = (ownerPaid.data ?? []).filter((i) => i.account_id === account.id && i.paid_on && i.paid_on >= range.from && i.paid_on <= range.to);
  const exportColumns: ExportColumn<CashTransaction & { balance: number }>[] = [
    { header: 'Data', value: (t) => formatDateBR(t.occurred_on) },
    { header: 'Descrição', value: (t) => t.description ?? '' },
    { header: 'Categoria', value: (t) => `${t.category_code} ${t.category_name}` },
    { header: 'Valor', value: (t) => t.signed_amount, kind: 'money' },
    { header: 'Saldo', value: (t) => t.balance, kind: 'money' },
  ];

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/financeiro/contas" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Contas
          </Link>
        }
        title={account.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {ACCOUNT_KIND_LABELS[account.kind]} <Badge tone={account.owner === 'DONO' ? 'accent' : 'neutral'}>{account.owner === 'DONO' ? 'do dono' : 'da empresa'}</Badge>
            {!account.active ? <Badge tone="danger">inativa</Badge> : null}
          </span>
        }
      />
      <FinanceNav />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPresets range={range} onChange={setRange} />
        {account.owner === 'EMPRESA' ? <ExportMenu rows={rows} columns={exportColumns} fileName={`extrato-${account.id}`} /> : null}
      </div>

      {account.owner === 'DONO' ? (
        <>
          <Stat className="mb-4 max-w-xs" label="Pago pelo dono no período" value={sumMoney(ownerRows.map((r) => r.paid_amount))} hint="Vira investimento do dono (aporte, empréstimo ou reembolso)." />
          {ownerRows.length === 0 ? (
            <EmptyState title="Nada pago por esta conta no período" description="Parcelas pagas com esta conta ou cartão aparecem aqui." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
              {ownerRows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="num w-20 shrink-0 text-muted">{formatDateBR(r.paid_on)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.counterparty_name ?? r.description} <span className="text-xs text-muted">· {r.title_number} {r.number}/{r.of_total}</span>
                  </span>
                  <Money value={r.paid_amount} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Saldo atual" value={account.balance} />
            <Stat label="Entradas no período" value={ins} />
            <Stat label="Saídas no período" value={outs} />
            <Stat label="Resultado do período" value={toNumber(ins) - toNumber(outs)} signed />
          </div>
          {rows.length === 0 ? (
            <EmptyState title="Sem lançamentos no período" />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
              {rows.map((t) => {
                const href = cashSourceHref(t);
                return (
                  <li key={t.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm', (t.is_reversed || t.reverses_id) && 'opacity-60')}>
                    <span className="num w-20 shrink-0 text-muted">{formatDateBR(t.occurred_on)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{href ? <Link to={href} className="hover:underline">{t.description}</Link> : t.description}</span>
                      <span className="block text-xs text-muted">
                        {t.category_code} {t.category_name}
                        {t.is_reversed ? ' · estornado' : ''}
                        {t.reverses_id ? ' · estorno' : ''}
                      </span>
                    </span>
                    <Money value={t.signed_amount} signed className="w-28 text-right font-medium" />
                    <Money value={t.balance} className="hidden w-28 text-right text-xs text-muted sm:inline" />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Page>
  );
}
