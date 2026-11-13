import { CreditCard, Landmark, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type PfAccount, type PfAccountBalance, useAdjustBalances, usePfAccountBalances, usePfAccounts } from '@/data/personal';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { balanceToInput, inputToTarget, remainingLimit } from './balance-math';
import { PMoney } from './privacy';

function adjustedLabel(iso: string | null) {
  if (!iso) return 'nunca ajustado';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'ajustado hoje';
  return days === 1 ? 'ajustado ontem' : `ajustado há ${days} dias`;
}

/** Contas e cartões ativos com o saldo de hoje. */
function useAccountRows() {
  const accounts = usePfAccounts();
  const balances = usePfAccountBalances();
  const rows = useMemo(() => {
    if (!accounts.data || !balances.data) return null;
    const byId = new Map<number, PfAccountBalance>(balances.data.map((b) => [b.account_id, b]));
    return accounts.data
      .filter((a) => a.active && byId.has(a.id))
      .map((account) => ({ account, balance: byId.get(account.id)!.balance, lastAdjustedAt: byId.get(account.id)!.last_adjusted_at }));
  }, [accounts.data, balances.data]);
  return { rows, error: accounts.error ?? balances.error, isError: accounts.isError || balances.isError, refetch: () => void Promise.all([accounts.refetch(), balances.refetch()]) };
}

/** Saldo de cada conta e, em separado, os cartões com o limite que ainda resta. */
export function BalancesCard() {
  const { rows, isError, error, refetch } = useAccountRows();
  const [adjusting, setAdjusting] = useState<{ only?: number } | null>(null);

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (!rows) return <LoadingBlock rows={3} />;

  const money = rows.filter((r) => r.account.kind !== 'CARTAO');
  const cards = rows.filter((r) => r.account.kind === 'CARTAO');
  const total = money.filter((r) => r.account.in_budget).reduce((sum, r) => sum + r.balance, 0);

  return (
    <Card>
      <CardHeader
        title="Quanto eu tenho"
        description="Informe o saldo de agora e o app ajusta o resto. Não precisa anotar gasto a gasto."
        actions={
          <Button size="sm" onClick={() => setAdjusting({})}>
            <RefreshCw /> Atualizar saldos
          </Button>
        }
      />
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          Nenhuma conta ainda. Cadastre em{' '}
          <Link to="/pessoal/ajustes" className="font-semibold underline underline-offset-2">
            Ajustes
          </Link>
          .
        </p>
      ) : (
        <>
          {money.length > 0 ? (
            <ul className="divide-y divide-line">
              {money.map(({ account, balance, lastAdjustedAt }) => (
                <li key={account.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Landmark className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{account.name}</p>
                    <p className="text-xs text-muted">
                      {adjustedLabel(lastAdjustedAt)}
                      {!account.in_budget ? ' · fora do cálculo' : ''}
                    </p>
                  </div>
                  <PMoney value={balance} className={cn('text-sm font-semibold', balance < 0 && 'text-danger')} />
                  <Button size="sm" variant="ghost" onClick={() => setAdjusting({ only: account.id })}>
                    Ajustar
                  </Button>
                </li>
              ))}
              {money.filter((r) => r.account.in_budget).length > 1 ? (
                <li className="flex items-center justify-between gap-3 bg-subtle/50 px-4 py-2 text-sm">
                  <span className="text-ink-soft">Total nas contas do cálculo</span>
                  <PMoney value={total} className="font-semibold" />
                </li>
              ) : null}
            </ul>
          ) : null}

          {cards.length > 0 ? (
            <div className={cn(money.length > 0 && 'border-t border-line')}>
              <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Cartões de crédito</p>
              <ul className="divide-y divide-line">
                {cards.map(({ account, balance, lastAdjustedAt }) => (
                  <CardRow key={account.id} account={account} balance={balance} lastAdjusted={adjustedLabel(lastAdjustedAt)} onAdjust={() => setAdjusting({ only: account.id })} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      {adjusting ? <AdjustBalancesDialog rows={rows} only={adjusting.only} onClose={() => setAdjusting(null)} /> : null}
    </Card>
  );
}

function CardRow({ account, balance, lastAdjusted, onAdjust }: { account: PfAccount; balance: number; lastAdjusted: string; onAdjust: () => void }) {
  const owed = Math.max(-balance, 0);
  const limit = account.credit_limit;
  const left = limit === null ? null : remainingLimit(limit, balance);
  const used = limit && limit > 0 ? Math.min(owed / limit, 1) : 0;
  return (
    <li className="space-y-1.5 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <CreditCard className="size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="text-xs text-muted">{lastAdjusted}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Devo</p>
          <PMoney value={owed} className="text-sm font-semibold" />
        </div>
        <Button size="sm" variant="ghost" onClick={onAdjust}>
          Ajustar
        </Button>
      </div>
      {limit !== null && left !== null ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted">
              Limite <PMoney value={limit} />
            </span>
            <span className={cn('font-medium', left < 0 ? 'text-danger' : 'text-success')}>
              {left < 0 ? (
                <>
                  estourou <PMoney value={Math.abs(left)} />
                </>
              ) : (
                <>
                  resta <PMoney value={left} />
                </>
              )}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label={`Limite usado de ${account.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}>
            <div className={cn('h-full rounded-full transition-all', left < 0 ? 'bg-danger' : used > 0.8 ? 'bg-warning' : 'bg-success')} style={{ width: `${used * 100}%` }} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Sem limite cadastrado. Informe em{' '}
          <Link to="/pessoal/ajustes" className="underline underline-offset-2">
            Ajustes
          </Link>{' '}
          para ver quanto ainda resta.
        </p>
      )}
    </li>
  );
}

type Row = { account: PfAccount; balance: number; lastAdjustedAt: string | null };

/** Uma linha por conta (ou só a escolhida): digita-se o valor real e o app mostra a diferença. */
function AdjustBalancesDialog({ rows, only, onClose }: { rows: Row[]; only?: number; onClose: () => void }) {
  const list = only ? rows.filter((r) => r.account.id === only) : rows;
  const [requestId, renew] = useRequestId();
  const [values, setValues] = useState<Record<number, string | null>>(() =>
    Object.fromEntries(list.map((r) => [r.account.id, String(balanceToInput(r.account.kind, r.balance))])),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useAdjustBalances(onClose);

  const changes = list
    .map((r) => {
      const typed = values[r.account.id];
      if (typed === null || typed === undefined) return null;
      const target = inputToTarget(r.account.kind, toNumber(typed));
      const delta = Math.round((target - r.balance) * 100) / 100;
      return delta === 0 ? null : { row: r, target, delta };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const missing = list.find((r) => values[r.account.id] === null || values[r.account.id] === undefined);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={only ? `Ajustar ${list[0]?.account.name ?? 'conta'}` : 'Atualizar saldos'}
        description="Digite quanto você tem agora em cada conta e quanto deve em cada cartão. O valor de hoje é recalculado a partir daí."
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              disabled={changes.length === 0}
              onClick={() => {
                setError(null);
                if (missing) return setError(`Informe o valor de "${missing.account.name}".`);
                save.mutate(
                  { requestId, items: changes.map((c) => ({ account_id: c.row.account.id, target: c.target })) },
                  { onSuccess: renew, onError: (e) => setError(describeError(e)) },
                );
              }}
            >
              {changes.length === 0 ? 'Nada mudou' : `Salvar ${changes.length === 1 ? '1 ajuste' : `${changes.length} ajustes`}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {list.map(({ account, balance }) => {
            const isCard = account.kind === 'CARTAO';
            const typed = values[account.id];
            const delta = typed === null || typed === undefined ? 0 : Math.round((inputToTarget(account.kind, toNumber(typed)) - balance) * 100) / 100;
            // No cartão, dívida maior = saldo menor: mostra pelo ponto de vista de quem deve.
            const more = isCard ? -delta : delta;
            return (
              <Field
                key={account.id}
                label={isCard ? `${account.name} — quanto devo` : `${account.name} — quanto tenho`}
                hint={
                  delta !== 0 ? (
                    <>
                      Antes: <PMoney value={balanceToInput(account.kind, balance)} /> ·{' '}
                      <span className={cn('font-medium', (isCard ? more > 0 : more < 0) ? 'text-danger' : 'text-success')}>
                        {more > 0 ? 'sobe ' : 'cai '}
                        <PMoney value={Math.abs(more)} />
                      </span>
                    </>
                  ) : undefined
                }
              >
                <MoneyInput value={typed ?? null} onValueChange={(v) => setValues((cur) => ({ ...cur, [account.id]: v }))} />
              </Field>
            );
          })}
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
