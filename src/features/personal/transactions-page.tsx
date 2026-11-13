import { ChevronLeft, ChevronRight, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  type PfTransaction,
  useDeleteTransaction,
  usePfAccounts,
  usePfCategories,
  usePfSummary,
  usePfTransactions,
  useUpdateTransaction,
} from '@/data/personal';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addMonths, capitalize, endOfMonth, formatDateBR, monthLabel, startOfMonth } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { normalizeName } from '@/lib/text';
import { toNumber } from '@/lib/money';
import { PMoney } from './privacy';

function dayTitle(iso: string): string {
  return capitalize(new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)));
}

/** Lançamentos do mês, por dia, com busca, filtro por categoria e edição. */
export function TransactionsPage() {
  const { today: todayFn } = useMember();
  const today = todayFn();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? `${params.get('mes')}-01` : startOfMonth(today);
  const range = { from: month, to: endOfMonth(month) };
  const txs = usePfTransactions(range);
  const summary = usePfSummary(range.from, range.to);
  const categories = usePfCategories();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<PfTransaction | null>(null);

  const go = (delta: number) => {
    const next = new URLSearchParams(params);
    next.set('mes', addMonths(month, delta).slice(0, 7));
    setParams(next, { replace: true });
  };

  const groups = useMemo(() => {
    const q = normalizeName(query);
    const filtered = (txs.data ?? []).filter(
      (t) => (!categoryId || String(t.category_id) === categoryId) && (!q || normalizeName(`${t.description ?? ''} ${t.category_name ?? ''} ${t.account_name}`).includes(q)),
    );
    const byDay = new Map<string, PfTransaction[]>();
    for (const t of filtered) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
    return [...byDay.entries()].map(([date, list]) => ({
      date,
      list,
      spent: list.filter((t) => t.kind === 'GASTO').reduce((sum, t) => sum + t.amount, 0),
    }));
  }, [txs.data, query, categoryId]);

  return (
    <div className="space-y-5">
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
        <dl className="grid grid-cols-3 gap-3 p-4 text-center">
          <div>
            <dt className="text-xs text-muted">Gastos</dt>
            <dd className="text-lg font-semibold"><PMoney value={summary.data?.spent ?? 0} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Entradas</dt>
            <dd className="text-lg font-semibold text-success"><PMoney value={summary.data?.income ?? 0} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Dia a dia</dt>
            <dd className="text-lg font-semibold"><PMoney value={summary.data?.spent_daily ?? 0} /></dd>
          </div>
        </dl>
        {summary.data && summary.data.adjustments !== 0 ? (
          <p className="border-t border-line px-4 py-2 text-center text-xs text-muted">
            Ajustes de saldo no mês: <PMoney value={summary.data.adjustments} signed className="font-medium" /> (fora de gastos e entradas)
          </p>
        ) : null}
        {summary.data && summary.data.by_category.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3" aria-label="Gastos por categoria">
            {summary.data.by_category.map((c) => (
              <li key={`${c.category_id}`}>
                <button
                  type="button"
                  onClick={() => setCategoryId(categoryId === String(c.category_id) ? '' : String(c.category_id ?? ''))}
                  className={cn('rounded-full border px-2.5 py-1 text-xs', categoryId === String(c.category_id) ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-panel hover:bg-subtle')}
                >
                  {c.name} · <PMoney value={c.total} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por descrição, categoria ou conta…" aria-label="Buscar lançamentos" className="pl-9" />
        </div>
        <Select aria-label="Categoria" className="h-10 w-auto" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Todas as categorias</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {txs.isError ? (
        <ErrorState error={txs.error} onRetry={() => void txs.refetch()} />
      ) : !txs.data ? (
        <LoadingBlock />
      ) : groups.length === 0 ? (
        <EmptyState title="Nenhum lançamento" description="Nada encontrado neste mês com esses filtros." />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.date}>
              <CardHeader
                title={dayTitle(g.date)}
                description={g.spent > 0 ? <span>Gasto no dia: <PMoney value={g.spent} /></span> : undefined}
              />
              <ul className="divide-y divide-line">
                {g.list.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setEditing(t)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.description || t.category_name || (t.kind === 'TRANSFERENCIA' ? 'Transferência' : 'Sem descrição')}</span>
                        <span className="block text-xs text-muted">
                          {t.kind === 'TRANSFERENCIA' ? `${t.account_name} → ${t.to_account_name}` : t.kind === 'AJUSTE' ? t.account_name : `${t.category_name ?? 'Sem categoria'} · ${t.account_name}`}
                          {t.kind === 'AJUSTE' ? <Badge className="ml-1.5">ajuste</Badge> : null}
                          {t.schedule_id ? <Badge className="ml-1.5">conta/parcela</Badge> : null}
                          {t.source === 'VOZ' ? <Badge tone="info" className="ml-1.5">voz</Badge> : null}
                        </span>
                      </span>
                      <PMoney value={t.kind === 'GASTO' ? -t.amount : t.amount} signed={t.kind === 'ENTRADA' || t.kind === 'AJUSTE'} className={cn('text-sm font-semibold', t.kind === 'ENTRADA' && 'text-success')} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing ? (
        editing.kind === 'AJUSTE' ? (
          <AdjustmentDialog key={editing.id} tx={editing} onClose={() => setEditing(null)} />
        ) : (
          <EditTransactionDialog key={editing.id} tx={editing} onClose={() => setEditing(null)} />
        )
      ) : null}
    </div>
  );
}

/** Ajuste de saldo não se edita: só dá para apagar (ou fazer outro ajuste em "Atualizar saldos"). */
function AdjustmentDialog({ tx, onClose }: { tx: PfTransaction; onClose: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeleteTransaction(onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Ajuste de saldo"
        description={`${formatDateBR(tx.date)} · ${tx.account_name}`}
        footer={
          <>
            <Button variant="danger-outline" onClick={() => setConfirmDelete(true)} className="mr-auto">
              <Trash2 /> Apagar
            </Button>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Este ajuste {tx.amount > 0 ? 'somou' : 'tirou'} <PMoney value={Math.abs(tx.amount)} className="font-semibold" /> {tx.amount > 0 ? 'ao' : 'do'} saldo de {tx.account_name} para ele bater com o valor real que você informou.
        </p>
        <p className="mt-2 text-xs text-muted">Para corrigir, apague e informe o saldo de novo em "Atualizar saldos" na tela Hoje.</p>
      </DialogContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Apagar este ajuste?"
        description="O saldo da conta volta ao valor anterior ao ajuste. Não dá para desfazer."
        confirmLabel="Apagar"
        onConfirm={() => remove.mutateAsync(tx.id).catch(() => undefined)}
      />
    </Dialog>
  );
}

function EditTransactionDialog({ tx, onClose }: { tx: PfTransaction; onClose: () => void }) {
  const { today: todayFn } = useMember();
  const today = todayFn();
  const accounts = usePfAccounts();
  const categories = usePfCategories();
  const [amount, setAmount] = useState<string | null>(String(tx.amount));
  const [description, setDescription] = useState(tx.description ?? '');
  const [categoryId, setCategoryId] = useState(tx.category_id ? String(tx.category_id) : '');
  const [accountId, setAccountId] = useState(String(tx.account_id));
  const [date, setDate] = useState(tx.date);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateTransaction(onClose);
  const remove = useDeleteTransaction(onClose);
  const options = (categories.data ?? []).filter((c) => c.kind === (tx.kind === 'ENTRADA' ? 'ENTRADA' : 'GASTO') && (c.active || c.id === tx.category_id));

  const submit = () => {
    setError(null);
    if (toNumber(amount) <= 0) return setError('Informe o valor.');
    update.mutate(
      {
        id: tx.id,
        tx: { amount: amount!, description: description.trim() || null, category_id: tx.kind === 'TRANSFERENCIA' ? null : categoryId ? Number(categoryId) : null, account_id: Number(accountId), date },
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Editar lançamento"
        description={`${formatDateBR(tx.date)} · ${tx.kind === 'GASTO' ? 'Gasto' : tx.kind === 'ENTRADA' ? 'Entrada' : 'Transferência'}`}
        footer={
          <>
            <Button variant="danger-outline" onClick={() => setConfirmDelete(true)} className="mr-auto">
              <Trash2 /> Apagar
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={update.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {tx.schedule_id ? <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">Este lançamento pagou uma conta ou parcela. Se apagar, ela volta a ficar prevista.</p> : null}
          <Field label="Valor" required>
            <MoneyInput value={amount} onValueChange={setAmount} />
          </Field>
          <Field label="Descrição">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          </Field>
          {tx.kind !== 'TRANSFERENCIA' ? (
            <Field label="Categoria">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Sem categoria</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conta">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {(accounts.data ?? [])
                  .filter((a) => a.active || a.id === tx.account_id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Data">
              <Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Apagar este lançamento?"
        description="Ele sai dos seus saldos e do calendário. Não dá para desfazer."
        confirmLabel="Apagar"
        onConfirm={() => remove.mutateAsync(tx.id).catch(() => undefined)}
      />
    </Dialog>
  );
}
