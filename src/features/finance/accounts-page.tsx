import { ArrowLeftRight, CreditCard, Landmark, Pencil, Plus, Tags, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { ACCOUNT_KIND_LABELS, type AccountKind, type PaymentAccount, type Payer, useAccounts, useSaveAccount, useTransfer } from '@/data/finance';
import { useMember } from '@/features/member/member-context';
import { sumMoney } from '@/lib/calc';
import { formatDateBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { FinanceNav } from './finance-nav';

const KIND_ICON = { BANCO: Landmark, DINHEIRO: Wallet, CARTAO_CREDITO: CreditCard, CARTEIRA: Wallet } as const;

/** Contas e cartões (US-7.1): da empresa (movimentam o caixa) e do dono (viram investimento do dono). */
export function AccountsPage() {
  const { can } = useMember();
  const accounts = useAccounts({ includeInactive: true });
  const [editing, setEditing] = useState<PaymentAccount | 'new' | null>(null);
  const [transferring, setTransferring] = useState(false);
  if (accounts.isError) return <Page><ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} /></Page>;
  const list = accounts.data ?? [];
  const company = list.filter((a) => a.owner === 'EMPRESA');
  const owner = list.filter((a) => a.owner === 'DONO');
  const cash = sumMoney(company.filter((a) => a.active && a.kind !== 'CARTAO_CREDITO').map((a) => a.balance));

  return (
    <Page>
      <PageHeader
        title="Contas e cartões"
        description="Contas da empresa formam o caixa. Contas e cartões pessoais do dono servem para registrar o que ele pagou pela empresa."
        actions={
          can('write') ? (
            <>
              <Button asChild variant="outline">
                <Link to="/financeiro/categorias">
                  <Tags /> Categorias
                </Link>
              </Button>
              {company.filter((a) => a.active && a.kind !== 'CARTAO_CREDITO').length > 1 ? (
                <Button variant="outline" onClick={() => setTransferring(true)}>
                  <ArrowLeftRight /> Transferir
                </Button>
              ) : null}
              <Button onClick={() => setEditing('new')}>
                <Plus /> Nova conta
              </Button>
            </>
          ) : undefined
        }
      />
      <FinanceNav />
      {!accounts.data ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="font-sans text-sm font-semibold">Da empresa</h2>
              <span className="text-sm text-muted">
                Caixa disponível <Money value={cash} className="font-semibold text-ink" />
              </span>
            </div>
            {company.length === 0 ? (
              <EmptyState title="Nenhuma conta da empresa" description='Cadastre onde a Wabee recebe e paga. Se recebe no seu Pix pessoal, crie uma conta "Pix (empresa)" marcada como da empresa.' />
            ) : (
              <AccountGrid accounts={company} onEdit={can('write') ? setEditing : undefined} />
            )}
          </section>
          <section>
            <h2 className="mb-2 px-1 font-sans text-sm font-semibold">Do dono</h2>
            {owner.length === 0 ? (
              <EmptyState title="Nenhuma conta do dono" description="Cadastre o cartão pessoal usado nas compras da Wabee: as parcelas pagas nele viram investimento do dono." />
            ) : (
              <AccountGrid accounts={owner} onEdit={can('write') ? setEditing : undefined} />
            )}
          </section>
        </div>
      )}
      {editing ? <AccountDialog key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} /> : null}
      {transferring ? <TransferDialog accounts={company.filter((a) => a.active && a.kind !== 'CARTAO_CREDITO')} onOpenChange={setTransferring} /> : null}
    </Page>
  );
}

function AccountGrid({ accounts, onEdit }: { accounts: PaymentAccount[]; onEdit?: (a: PaymentAccount) => void }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((a) => {
        const Icon = KIND_ICON[a.kind];
        return (
          <li key={a.id}>
            <Card className={a.active ? 'p-4' : 'p-4 opacity-60'}>
              <div className="flex items-start justify-between gap-2">
                <Link to={`/financeiro/contas/${a.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-soft">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{a.name}</span>
                    <span className="block text-xs text-muted">
                      {ACCOUNT_KIND_LABELS[a.kind]}
                      {a.kind === 'CARTAO_CREDITO' && a.card_closing_day ? ` · fecha dia ${a.card_closing_day}, vence dia ${a.card_due_day}` : ''}
                    </span>
                  </span>
                </Link>
                {onEdit ? (
                  <Button size="icon-sm" variant="ghost" aria-label={`Editar ${a.name}`} onClick={() => onEdit(a)}>
                    <Pencil />
                  </Button>
                ) : null}
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                {a.owner === 'EMPRESA' && a.kind !== 'CARTAO_CREDITO' ? (
                  <Money value={a.balance} className="text-xl font-semibold" />
                ) : (
                  <span className="text-xs text-muted">{a.owner === 'DONO' ? 'Não entra no caixa da empresa' : 'Cartão da empresa'}</span>
                )}
                <span className="flex gap-1">
                  {!a.active ? <Badge tone="danger">inativa</Badge> : null}
                  {a.unreconciled_count > 0 ? <Badge>{a.unreconciled_count} a conferir</Badge> : null}
                </span>
              </div>
              {a.last_activity_on ? <p className="mt-1 text-xs text-muted">Último lançamento {formatDateBR(a.last_activity_on)}</p> : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function AccountDialog({ account, onOpenChange }: { account: PaymentAccount | null; onOpenChange: (open: boolean) => void }) {
  const { today } = useMember();
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'BANCO');
  const [owner, setOwner] = useState<Payer>(account?.owner ?? 'EMPRESA');
  const [openingBalance, setOpeningBalance] = useState<string | null>(account ? String(account.opening_balance) : null);
  const [openingDate, setOpeningDate] = useState(account?.opening_date ?? today());
  const [closingDay, setClosingDay] = useState(account?.card_closing_day ? String(account.card_closing_day) : '');
  const [dueDay, setDueDay] = useState(account?.card_due_day ? String(account.card_due_day) : '');
  const [active, setActive] = useState(account?.active ?? true);
  const [notes, setNotes] = useState(account?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useSaveAccount(() => onOpenChange(false));
  const card = kind === 'CARTAO_CREDITO';
  const used = Boolean(account?.last_activity_on);

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError('Dê um nome para a conta.');
    if (card && (!closingDay || !dueDay)) return setError('Informe o dia de fechamento e o de vencimento do cartão.');
    save.mutate(
      {
        id: account?.id,
        name: name.trim(),
        kind,
        owner,
        opening_balance: owner === 'EMPRESA' && !card ? (openingBalance ?? '0') : '0',
        opening_date: openingDate,
        card_closing_day: card ? Number(closingDay) : null,
        card_due_day: card ? Number(dueDay) : null,
        active,
        notes: notes.trim() || null,
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={account ? 'Editar conta' : 'Nova conta'}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} onClick={submit}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder='Ex.: Pix (empresa), Nubank do Fulano' autoFocus />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Tipo" hint={used ? 'Já tem lançamentos: o tipo não muda.' : undefined}>
              <Select value={kind} disabled={used} onChange={(e) => setKind(e.target.value as AccountKind)}>
                {(Object.keys(ACCOUNT_KIND_LABELS) as AccountKind[]).map((k) => (
                  <option key={k} value={k}>
                    {ACCOUNT_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="De quem é">
              <Select value={owner} disabled={used} onChange={(e) => setOwner(e.target.value as Payer)}>
                <option value="EMPRESA">Da empresa</option>
                <option value="DONO">Do dono (pessoal)</option>
              </Select>
            </Field>
          </div>
          {owner === 'DONO' ? (
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-ink">O que for pago por esta conta não sai do caixa da empresa: vira aporte, empréstimo ou despesa a reembolsar do dono.</p>
          ) : null}
          {owner === 'EMPRESA' && !card ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Saldo inicial" hint="Quanto havia na conta na data ao lado.">
                <MoneyInput value={openingBalance} disabled={used} onValueChange={setOpeningBalance} />
              </Field>
              <Field label="Na data">
                <Input type="date" value={openingDate} disabled={used} onChange={(e) => setOpeningDate(e.target.value)} />
              </Field>
            </div>
          ) : null}
          {card ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Dia de fechamento" required>
                <Select value={closingDay} onChange={(e) => setClosingDay(e.target.value)}>
                  <option value="">—</option>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Dia de vencimento" required>
                <Select value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
                  <option value="">—</option>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
          <Field label="Observações">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="min-h-14" />
          </Field>
          {account ? (
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Conta ativa
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ accounts, onOpenChange }: { accounts: PaymentAccount[]; onOpenChange: (open: boolean) => void }) {
  const { today } = useMember();
  const [requestId, renew] = useRequestId();
  const [fromId, setFromId] = useState(String(accounts[0]?.id ?? ''));
  const [toId, setToId] = useState(String(accounts[1]?.id ?? ''));
  const [amount, setAmount] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const transfer = useTransfer(() => {
    renew();
    onOpenChange(false);
  });
  const fromAccount = accounts.find((a) => String(a.id) === fromId);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title="Transferir entre contas"
        description="Não é receita nem despesa: só muda o dinheiro de lugar."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              loading={transfer.isPending}
              disabled={!amount || fromId === toId}
              onClick={() => transfer.mutate({ requestId, fromId: Number(fromId), toId: Number(toId), amount: amount!, occurredOn: date, notes: notes.trim() || null })}
            >
              Transferir
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="De" hint={fromAccount ? `Saldo ${formatBRL(fromAccount.balance)}` : undefined}>
              <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Para" error={fromId === toId ? 'Escolha contas diferentes.' : null}>
              <Select value={toId} onChange={(e) => setToId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Valor" required>
              <MoneyInput value={amount} onValueChange={setAmount} />
            </Field>
            <Field label="Data">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Observação">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

