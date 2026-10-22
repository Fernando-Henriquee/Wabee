import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { from, unwrap } from '@/data/api';
import { useAppQuery } from '@/data/hooks';
import { type InstallmentRow, type Payer, PAYER_LABELS, titleSourceHref, useAccounts, useInstallments, usePayInstallments, useReverseInstallmentPayment } from '@/data/finance';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { sumMoney } from '@/lib/calc';
import { addDays, capitalize, endOfMonth, formatDateBR, monthLabel } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatBRL, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { FinanceNav } from './finance-nav';
import { PayInstallmentDialog, ReceiveInstallmentDialog } from './installment-dialogs';

type Kind = 'PAGAR' | 'RECEBER';

interface Group {
  key: string;
  label: string;
  tone?: 'danger';
  rows: InstallmentRow[];
}

function groupOpen(rows: InstallmentRow[], today: string): Group[] {
  const week = addDays(today, 7);
  const monthEnd = endOfMonth(today);
  const groups = new Map<string, Group>();
  const add = (key: string, label: string, row: InstallmentRow, tone?: 'danger') => {
    if (!groups.has(key)) groups.set(key, { key, label, tone, rows: [] });
    groups.get(key)!.rows.push(row);
  };
  for (const row of rows) {
    if (row.due_date < today) add('0-overdue', 'Vencidas', row, 'danger');
    else if (row.due_date <= week) add('1-week', 'Próximos 7 dias', row);
    else if (row.due_date <= monthEnd) add('2-month', 'Restante do mês', row);
    else add(`3-${row.due_date.slice(0, 7)}`, capitalize(monthLabel(row.due_date)), row);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Taxa de pagamento vigente de cada canal (sugere a taxa ao receber). */
function usePaymentFees() {
  return useAppQuery(['channel-payment-fees'], async () => {
    const rows = await unwrap<Array<{ channel_id: number; payment_fee_pct: number }>>(from('sales_channel_fees').select('channel_id,payment_fee_pct').is('valid_to', null));
    return new Map(rows.map((r) => [r.channel_id, toNumber(r.payment_fee_pct)]));
  });
}

/** Contas a pagar (US-7.4, US-7.5) e contas a receber (US-7.3): parcelas em aberto agrupadas por vencimento e baixas do período. */
export function InstallmentsPage({ kind }: { kind: Kind }) {
  const { can, today } = useMember();
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') === 'baixadas' ? 'baixadas' : 'abertas';
  const payerFilter = (params.get('pagador') as Payer | null) ?? null;
  const pay = kind === 'PAGAR';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <Page>
      <PageHeader
        title={pay ? 'Contas a pagar' : 'Contas a receber'}
        description={
          pay
            ? 'Parcelas de compras e despesas. Pago pelo cartão ou conta do dono vira investimento do dono, sem sair do caixa da empresa.'
            : 'Parcelas de vendas. O dinheiro entra no caixa pelo valor líquido; a taxa vai para despesas de venda.'
        }
      />
      <FinanceNav />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setParam('aba', v === 'abertas' ? null : v)}>
          <TabsList>
            <TabsTrigger value="abertas">Em aberto</TabsTrigger>
            <TabsTrigger value="baixadas">{pay ? 'Pagas' : 'Recebidas'}</TabsTrigger>
          </TabsList>
        </Tabs>
        {pay ? (
          <Select aria-label="Quem paga" className="h-9 w-auto" value={payerFilter ?? ''} onChange={(e) => setParam('pagador', e.target.value || null)}>
            <option value="">Empresa e dono</option>
            <option value="EMPRESA">Só a empresa</option>
            <option value="DONO">Só o dono</option>
          </Select>
        ) : null}
      </div>
      {tab === 'abertas' ? <OpenInstallments kind={kind} payer={payerFilter} canWrite={can('write')} today={today()} /> : <SettledInstallments kind={kind} payer={payerFilter} canWrite={can('write')} />}
    </Page>
  );
}

function OpenInstallments({ kind, payer, canWrite, today }: { kind: Kind; payer: Payer | null; canWrite: boolean; today: string }) {
  const pay = kind === 'PAGAR';
  const query = useInstallments({ kind, status: 'ABERTA' });
  const fees = usePaymentFees();
  const [acting, setActing] = useState<InstallmentRow | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [payingMany, setPayingMany] = useState(false);
  const rows = useMemo(() => (query.data ?? []).filter((r) => !payer || r.payer === payer), [query.data, payer]);
  const groups = useMemo(() => groupOpen(rows, today), [rows, today]);

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;

  const total = sumMoney(rows.map((r) => r.amount));
  const overdue = sumMoney(rows.filter((r) => r.is_overdue).map((r) => r.amount));
  const week = sumMoney(rows.filter((r) => !r.is_overdue && r.due_date <= addDays(today, 7)).map((r) => r.amount));
  const byOwner = sumMoney(rows.filter((r) => r.payer === 'DONO').map((r) => r.amount));
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportColumns: ExportColumn<InstallmentRow>[] = [
    { header: 'Vencimento', value: (r) => formatDateBR(r.due_date) },
    { header: 'Título', value: (r) => r.title_number },
    { header: 'Origem', value: (r) => r.source_ref ?? '' },
    { header: pay ? 'Fornecedor' : 'Cliente', value: (r) => r.counterparty_name ?? '' },
    { header: 'Descrição', value: (r) => r.description },
    { header: 'Parcela', value: (r) => `${r.number}/${r.of_total}` },
    { header: 'Valor', value: (r) => r.amount, kind: 'money' },
    ...(pay ? ([{ header: 'Pagador', value: (r) => PAYER_LABELS[r.payer] }] as ExportColumn<InstallmentRow>[]) : []),
  ];

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vencido" value={overdue} tone={toNumber(overdue) > 0 ? 'negative' : 'default'} />
        <Stat label="Próximos 7 dias" value={week} />
        <Stat label="Total em aberto" value={total} hint={`${rows.length} parcela(s)`} />
        {pay ? <Stat label="Parcelas do dono" value={byOwner} hint="Pagas pelo cartão/conta do dono: não saem do caixa" /> : <Stat label="Clientes com saldo" value={new Set(rows.map((r) => r.customer_id ?? r.counterparty_name)).size} format={(v) => String(v ?? 0)} />}
      </div>
      <div className="mb-3 flex justify-end">
        <ExportMenu rows={rows} columns={exportColumns} fileName={pay ? 'contas-a-pagar' : 'contas-a-receber'} />
      </div>
      {groups.length === 0 ? (
        <EmptyState title={pay ? 'Nada a pagar' : 'Nada a receber'} description={pay ? 'Compras confirmadas e despesas lançadas aparecem aqui.' : 'Vendas com saldo em aberto aparecem aqui.'} />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`g-${group.key}`}>
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 id={`g-${group.key}`} className={cn('font-sans text-sm font-semibold', group.tone === 'danger' ? 'text-danger' : 'text-ink')}>
                  {group.label}
                </h2>
                <Money value={sumMoney(group.rows.map((r) => r.amount))} className="text-sm font-semibold" />
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
                {group.rows.map((r) => (
                  <InstallmentItem
                    key={r.id}
                    row={r}
                    kind={kind}
                    selectable={pay && canWrite}
                    selected={selected.has(r.id)}
                    onToggle={() => toggle(r.id)}
                    action={
                      canWrite ? (
                        <Button size="sm" variant={r.is_overdue ? 'primary' : 'outline'} onClick={() => setActing(r)}>
                          {pay ? 'Pagar' : 'Receber'}
                        </Button>
                      ) : null
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {selectedRows.length > 0 ? (
        <div className="sticky bottom-20 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink bg-ink px-4 py-3 text-brand-fg shadow-[var(--shadow-pop)] lg:bottom-4">
          <span className="text-sm">
            {selectedRows.length} selecionada(s) · <span className="num font-semibold">{formatBRL(sumMoney(selectedRows.map((r) => r.amount)))}</span>
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" className="text-brand-fg hover:bg-white/10 hover:text-brand-fg" onClick={() => setSelected(new Set())}>
              Limpar
            </Button>
            <Button size="sm" variant="accent" onClick={() => setPayingMany(true)}>
              Pagar juntas
            </Button>
          </span>
        </div>
      ) : null}

      {acting && pay ? <PayInstallmentDialog installment={acting} onOpenChange={(open) => !open && setActing(null)} /> : null}
      {acting && !pay ? <ReceiveInstallmentDialog installment={acting} suggestedFeePct={acting.channel_id ? (fees.data?.get(acting.channel_id) ?? null) : null} onOpenChange={(open) => !open && setActing(null)} /> : null}
      {payingMany ? (
        <PayManyDialog
          rows={selectedRows}
          onOpenChange={(open) => {
            setPayingMany(open);
          }}
          onDone={() => {
            setPayingMany(false);
            setSelected(new Set());
          }}
        />
      ) : null}
    </>
  );
}

function InstallmentItem({ row, kind, selectable, selected, onToggle, action }: { row: InstallmentRow; kind: Kind; selectable: boolean; selected: boolean; onToggle: () => void; action: React.ReactNode }) {
  const href = titleSourceHref(row);
  return (
    <li className={cn('flex items-center gap-3 px-3 py-3 sm:px-4', selected && 'bg-accent-soft')}>
      {selectable ? <Checkbox aria-label={`Selecionar parcela ${row.number} de ${row.title_number}`} checked={selected} onChange={onToggle} className="size-5" /> : null}
      <div className="w-16 shrink-0 text-center">
        <p className={cn('num text-sm font-semibold', row.is_overdue && 'text-danger')}>{formatDateBR(row.due_date).slice(0, 5)}</p>
        <p className="text-xs text-muted">{row.due_date.slice(0, 4)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.counterparty_name ?? row.description}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {href ? (
            <Link to={href} className="underline decoration-accent decoration-2 underline-offset-2">
              {row.source_ref ?? row.title_number}
            </Link>
          ) : (
            <span>{row.title_number}</span>
          )}
          <span>
            parcela {row.number}/{row.of_total}
          </span>
          {row.counterparty_name ? <span className="truncate">{row.description}</span> : null}
          {kind === 'PAGAR' && row.payer === 'DONO' ? <Badge tone="accent">dono</Badge> : null}
        </p>
      </div>
      <Money value={row.amount} className="text-sm font-semibold" />
      {action}
    </li>
  );
}

function PayManyDialog({ rows, onOpenChange, onDone }: { rows: InstallmentRow[]; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const { today } = useMember();
  const [requestId, renew] = useRequestId();
  const accounts = useAccounts();
  const [paidOn, setPaidOn] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [payer, setPayer] = useState<Payer>(rows.every((r) => r.payer === 'DONO') ? 'DONO' : 'EMPRESA');
  const payMany = usePayInstallments(() => {
    renew();
    onDone();
  });
  const account = accounts.data?.find((a) => String(a.id) === accountId);
  const effectivePayer: Payer = account?.owner === 'DONO' ? 'DONO' : payer;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`Pagar ${rows.length} parcela(s) juntas`}
        description={`Total ${formatBRL(sumMoney(rows.map((r) => r.amount)))} — ex.: a fatura do cartão do mês. Cada parcela é baixada pelo valor integral.`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              loading={payMany.isPending}
              disabled={effectivePayer === 'EMPRESA' && !accountId}
              onClick={() => payMany.mutate({ requestId, ids: rows.map((r) => r.id), paidOn, accountId: accountId ? Number(accountId) : null, payer: effectivePayer })}
            >
              Registrar pagamento
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Data do pagamento" required>
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label="De onde saiu o dinheiro">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{payer === 'DONO' ? 'Pago pelo dono (sem conta)' : 'Escolha a conta…'}</option>
              {(accounts.data ?? [])
                .filter((a) => a.kind !== 'CARTAO_CREDITO' || a.owner === 'DONO')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.owner === 'DONO' ? '(dono)' : ''}
                  </option>
                ))}
            </Select>
          </Field>
          {!account ? (
            <Field label="Quem pagou">
              <Select value={payer} onChange={(e) => setPayer(e.target.value as Payer)}>
                <option value="EMPRESA">Empresa</option>
                <option value="DONO">Dono</option>
              </Select>
            </Field>
          ) : null}
          <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 px-3 py-2">
                <span className="truncate">
                  {formatDateBR(r.due_date)} · {r.counterparty_name ?? r.description} ({r.number}/{r.of_total})
                </span>
                <Money value={r.amount} />
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettledInstallments({ kind, payer, canWrite }: { kind: Kind; payer: Payer | null; canWrite: boolean }) {
  const pay = kind === 'PAGAR';
  const [range, setRange] = useDateRange('mes');
  const query = useInstallments({ kind, status: 'PAGA' });
  const [reversing, setReversing] = useState<InstallmentRow | null>(null);
  const reverse = useReverseInstallmentPayment(() => setReversing(null));
  const rows = useMemo(
    () =>
      (query.data ?? [])
        .filter((r) => r.paid_on && r.paid_on >= range.from && r.paid_on <= range.to && (!payer || r.payer === payer))
        .sort((a, b) => (b.paid_on ?? '').localeCompare(a.paid_on ?? '')),
    [query.data, range.from, range.to, payer],
  );
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const total = sumMoney(rows.map((r) => r.paid_amount));
  const fees = sumMoney(rows.map((r) => r.fee_amount));
  const exportColumns: ExportColumn<InstallmentRow>[] = [
    { header: pay ? 'Pago em' : 'Recebido em', value: (r) => formatDateBR(r.paid_on) },
    { header: 'Vencimento', value: (r) => formatDateBR(r.due_date) },
    { header: 'Título', value: (r) => r.title_number },
    { header: pay ? 'Fornecedor' : 'Cliente', value: (r) => r.counterparty_name ?? '' },
    { header: 'Descrição', value: (r) => r.description },
    { header: 'Valor', value: (r) => r.paid_amount, kind: 'money' },
    { header: 'Taxa', value: (r) => r.fee_amount, kind: 'money' },
    { header: 'Conta', value: (r) => r.account_name ?? (r.payer === 'DONO' ? 'Dono' : '') },
  ];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPresets range={range} onChange={setRange} />
        <ExportMenu rows={rows} columns={exportColumns} fileName={pay ? 'pagamentos' : 'recebimentos'} />
      </div>
      <p className="mb-3 text-sm text-muted">
        {rows.length} {pay ? 'pagamento(s)' : 'recebimento(s)'} · total <Money value={total} className="font-semibold text-ink" />
        {!pay && toNumber(fees) > 0 ? (
          <>
            {' '}
            · taxas <Money value={fees} />
          </>
        ) : null}
      </p>
      {rows.length === 0 ? (
        <EmptyState title="Nada no período" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
          {rows.map((r) => (
            <InstallmentItem
              key={r.id}
              row={{ ...r, due_date: r.paid_on ?? r.due_date, is_overdue: false }}
              kind={kind}
              selectable={false}
              selected={false}
              onToggle={() => undefined}
              action={
                <span className="flex items-center gap-1">
                  <span className="hidden text-xs text-muted sm:inline">{r.account_name ?? (r.payer === 'DONO' ? 'pelo dono' : '')}</span>
                  {canWrite ? (
                    <Button size="icon-sm" variant="ghost" aria-label="Estornar baixa" title="Estornar baixa" onClick={() => setReversing(r)}>
                      <RotateCcw />
                    </Button>
                  ) : null}
                </span>
              }
            />
          ))}
        </ul>
      )}
      <ReasonDialog
        open={reversing !== null}
        onOpenChange={(open) => !open && setReversing(null)}
        title="Estornar a baixa?"
        description={reversing ? `A parcela ${reversing.number}/${reversing.of_total} de ${reversing.title_number} volta a ficar em aberto e o lançamento de caixa é estornado.` : ''}
        confirmLabel="Estornar"
        onConfirm={(reason) => reverse.mutateAsync({ installmentId: reversing!.id, reason })}
      />
    </>
  );
}
