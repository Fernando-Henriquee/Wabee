import { CheckCircle2, CircleAlert, Lock, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Money } from '@/components/shared/money';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select, Textarea } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type MonthClose, useCloseMonth, useMonthChecklist, useMonthCloses, useReopenMonth } from '@/data/finance';
import { useMember } from '@/features/member/member-context';
import { addMonths, capitalize, formatDateTimeBR, monthLabel, startOfMonth } from '@/lib/dates';
import { FinanceNav } from './finance-nav';

/** Fechamento do mês (US-7.12): confere pendências, congela o resultado e bloqueia lançamentos com data no mês. */
export function MonthClosePage() {
  const { can, today, settings } = useMember();
  const closes = useMonthCloses();
  const current = startOfMonth(today());
  const options = Array.from({ length: 12 }, (_, i) => addMonths(current, -(i + 1)));
  const [month, setMonth] = useState(options[0]!);
  const checklist = useMonthChecklist(month);
  const [closing, setClosing] = useState(false);
  const [notes, setNotes] = useState('');
  const [reopening, setReopening] = useState<MonthClose | null>(null);
  const close = useCloseMonth(() => setNotes(''));
  const reopen = useReopenMonth(() => setReopening(null));
  const closeRow = closes.data?.find((c) => c.month === month);
  const isClosed = closeRow?.status === 'FECHADO';
  const c = checklist.data;

  const items = c
    ? [
        { ok: c.open_print_jobs === 0, label: 'Impressões planejadas ou em andamento', count: c.open_print_jobs, href: '/producao' },
        { ok: c.outputs_in_finishing === 0, label: 'Peças aguardando acabamento', count: c.outputs_in_finishing, href: '/producao' },
        { ok: c.purchases_not_received === 0, label: 'Compras confirmadas e não recebidas', count: c.purchases_not_received, href: '/compras' },
        { ok: c.draft_purchases === 0, label: 'Compras em rascunho', count: c.draft_purchases, href: '/compras' },
        { ok: c.overdue_installments === 0, label: 'Parcelas vencidas em aberto', count: c.overdue_installments, href: '/financeiro/pagar' },
        { ok: c.stock_ok, label: c.stock_ok ? 'Estoque conferido (saldos batem com o razão)' : 'Diferença entre saldos e movimentações do estoque', count: null, href: '/estoque' },
      ]
    : [];
  const pending = items.filter((i) => !i.ok).length;

  return (
    <Page>
      <PageHeader title="Fechamento do mês" description="Depois de fechado, nada com data no mês pode ser lançado ou estornado; correções vão para o mês aberto." />
      <FinanceNav />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader
            title="Conferência"
            actions={
              <Select aria-label="Mês" className="h-9 w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
                {options.map((m) => (
                  <option key={m} value={m}>
                    {capitalize(monthLabel(m))}
                  </option>
                ))}
              </Select>
            }
          />
          {checklist.isError ? (
            <ErrorState className="m-4" error={checklist.error} />
          ) : !c ? (
            <div className="p-4">
              <LoadingBlock rows={3} />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((i) => (
                <li key={i.label} className="flex items-center gap-3 px-4 py-3 text-sm">
                  {i.ok ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="ok" /> : <CircleAlert className="size-5 shrink-0 text-warning" aria-label="pendente" />}
                  <span className="min-w-0 flex-1">{i.label}</span>
                  {i.count ? <Badge tone="warning">{i.count}</Badge> : null}
                  {!i.ok ? (
                    <Link to={i.href} className="text-xs underline decoration-accent decoration-2 underline-offset-2">
                      ver
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {settings.go_live_date && month < startOfMonth(settings.go_live_date) ? <p className="border-t border-line px-4 py-3 text-xs text-muted">Mês anterior ao início do sistema: contém só os lançamentos “anteriores ao sistema”.</p> : null}
        </Card>
        <Card className="h-fit space-y-3 p-4">
          {isClosed ? (
            <>
              <p className="flex items-center gap-2 font-semibold">
                <Lock className="size-4" /> {capitalize(monthLabel(month))} está fechado
              </p>
              <p className="text-sm text-muted">Fechado em {formatDateTimeBR(closeRow!.closed_at, settings.timezone)}.</p>
              {closeRow?.metrics.cash_balance !== undefined ? (
                <p className="text-sm">
                  Caixa no fim do mês: <Money value={closeRow.metrics.cash_balance} className="font-semibold" />
                </p>
              ) : null}
              {can('write') ? (
                <Button variant="outline" className="w-full" onClick={() => setReopening(closeRow!)}>
                  <LockOpen /> Reabrir mês
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <p className="font-semibold">{capitalize(monthLabel(month))}</p>
              <p className="text-sm text-muted">{pending === 0 ? 'Tudo certo para fechar.' : `${pending} ponto(s) de atenção. Dá para fechar assim mesmo; eles ficam registrados.`}</p>
              <Field label="Observações do fechamento">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="min-h-16" />
              </Field>
              {can('write') ? (
                <Button className="w-full" disabled={!c} onClick={() => setClosing(true)}>
                  <Lock /> Fechar {monthLabel(month)}
                </Button>
              ) : null}
            </>
          )}
        </Card>
      </div>

      <h2 className="mb-2 mt-6 font-sans text-sm font-semibold">Histórico</h2>
      {closes.isError ? (
        <ErrorState error={closes.error} />
      ) : !closes.data ? (
        <LoadingBlock rows={2} />
      ) : closes.data.length === 0 ? (
        <p className="text-sm text-muted">Nenhum mês fechado ainda.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel text-sm">
          {closes.data.map((m) => (
            <li key={m.month} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="w-36 font-medium">{capitalize(monthLabel(m.month))}</span>
              <Badge tone={m.status === 'FECHADO' ? 'success' : 'warning'}>{m.status === 'FECHADO' ? 'fechado' : 'reaberto'}</Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {m.status === 'FECHADO' ? `em ${formatDateTimeBR(m.closed_at, settings.timezone)}` : `reaberto: ${m.reopen_reason ?? ''}`}
                {m.notes ? ` · ${m.notes}` : ''}
              </span>
              {m.metrics.dre ? (
                <span className="text-xs">
                  Resultado <Money value={m.metrics.dre.lines.find((l) => l.key === 'resultado')?.amount ?? 0} signed className="font-semibold" />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        tone="primary"
        title={`Fechar ${monthLabel(month)}?`}
        description="O resultado do mês fica guardado e nenhuma operação com data neste mês poderá ser lançada ou estornada (dá para reabrir informando o motivo)."
        confirmLabel="Fechar mês"
        onConfirm={() => close.mutateAsync({ month, notes: notes.trim() || null })}
      />
      <ReasonDialog
        open={reopening !== null}
        onOpenChange={(o) => !o && setReopening(null)}
        title={reopening ? `Reabrir ${monthLabel(reopening.month)}?` : ''}
        description="Os lançamentos com data neste mês voltam a ser permitidos. A reabertura fica na auditoria."
        confirmLabel="Reabrir"
        onConfirm={(reason) => reopen.mutateAsync({ month: reopening!.month, reason })}
      />
    </Page>
  );
}

