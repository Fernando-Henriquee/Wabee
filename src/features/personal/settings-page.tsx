import { Pencil, Plus, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  ACCOUNT_KIND_LABELS,
  type PfAccount,
  type PfAccountKind,
  type PfCategory,
  useAddMember,
  usePfAccounts,
  usePfCategories,
  usePfMembers,
  usePfSpace,
  useRemoveMember,
  useSaveAccount,
  useSaveCategory,
  useSaveSpaceSettings,
} from '@/data/personal';
import { useMember } from '@/features/member/member-context';
import { describeError } from '@/lib/errors';
import { formatDateBR } from '@/lib/dates';
import { toNumber } from '@/lib/money';
import { PMoney } from './privacy';

/** Ajustes: dia do salário, reserva, contas, categorias e a pessoa que divide as finanças. */
export function PersonalSettingsPage() {
  return (
    <div className="space-y-5">
      <CycleCard />
      <AccountsCard />
      <CategoriesCard />
      <MembersCard />
    </div>
  );
}

function CycleCard() {
  const space = usePfSpace();
  const save = useSaveSpaceSettings();
  const [day, setDay] = useState<string | null>(null);
  const [reserve, setReserve] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  if (space.isError) return <ErrorState error={space.error} />;
  if (!space.data) return <LoadingBlock rows={2} />;
  const s = space.data;
  const dayValue = day ?? String(s.cycle_start_day);
  const reserveValue = reserve === undefined ? String(s.cycle_reserve) : reserve;
  const dirty = toNumber(dayValue) !== s.cycle_start_day || toNumber(reserveValue) !== s.cycle_reserve;
  return (
    <Card>
      <CardHeader title="Ciclo do dinheiro" description="O valor do dia divide o que você tem pelos dias até o próximo salário." />
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <Field label="Dia em que o dinheiro costuma entrar" hint="De 1 a 28. O ciclo vai desse dia até o anterior do mês seguinte.">
          <DecimalInput decimals={0} value={dayValue} onValueChange={setDay} suffix="do mês" />
        </Field>
        <Field label="Quanto quer guardar por ciclo" hint="Fica de fora do que você pode gastar.">
          <MoneyInput value={reserveValue} onValueChange={setReserve} />
        </Field>
        {error ? <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p> : null}
        <div className="sm:col-span-2">
          <Button
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => {
              setError(null);
              const d = Math.round(toNumber(dayValue));
              if (d < 1 || d > 28) return setError('O dia precisa ficar entre 1 e 28.');
              save.mutate({ cycle_start_day: d, cycle_reserve: reserveValue ?? '0' }, { onError: (e) => setError(describeError(e)), onSuccess: () => { setDay(null); setReserve(undefined); } });
            }}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AccountsCard() {
  const accounts = usePfAccounts();
  const [editing, setEditing] = useState<PfAccount | 'new' | null>(null);
  return (
    <Card>
      <CardHeader
        title="Contas"
        description="Informe o saldo de cada uma para o cálculo partir do valor certo."
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus /> Nova conta
          </Button>
        }
      />
      {accounts.isError ? (
        <div className="p-4"><ErrorState error={accounts.error} /></div>
      ) : !accounts.data ? (
        <div className="p-4"><LoadingBlock rows={2} /></div>
      ) : (
        <ul className="divide-y divide-line">
          {accounts.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {a.name} {!a.active ? <Badge tone="neutral">inativa</Badge> : null} {!a.in_budget ? <Badge>fora do cálculo</Badge> : null}
                </p>
                <p className="text-xs text-muted">
                  {ACCOUNT_KIND_LABELS[a.kind]} · saldo inicial de {formatDateBR(a.opening_date)}
                </p>
              </div>
              <PMoney value={a.opening_balance} className="text-sm font-semibold" />
              <Button size="icon-sm" variant="ghost" aria-label={`Editar ${a.name}`} onClick={() => setEditing(a)}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? <AccountDialog account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function AccountDialog({ account, onClose }: { account: PfAccount | null; onClose: () => void }) {
  const { today: todayFn } = useMember();
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<PfAccountKind>(account?.kind ?? 'CONTA');
  const [balance, setBalance] = useState<string | null>(account ? String(account.opening_balance) : '0');
  const [date, setDate] = useState(account?.opening_date ?? todayFn());
  const [inBudget, setInBudget] = useState(account?.in_budget ?? true);
  const [active, setActive] = useState(account?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveAccount(onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={account ? `Editar ${account.name}` : 'Nova conta'}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                setError(null);
                if (!name.trim()) return setError('Informe o nome da conta.');
                save.mutate(
                  { id: account?.id, name: name.trim(), kind, opening_balance: toNumber(balance), opening_date: date, in_budget: inBudget, active },
                  { onError: (e) => setError(describeError(e)) },
                );
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="Ex.: Nubank, Carteira, Cartão Itaú" />
          </Field>
          <Field label="Tipo">
            <Select
              value={kind}
              onChange={(e) => {
                const next = e.target.value as PfAccountKind;
                setKind(next);
                if (!account) setInBudget(next === 'CONTA' || next === 'CARTEIRA' || next === 'CARTAO');
              }}
            >
              {(Object.keys(ACCOUNT_KIND_LABELS) as PfAccountKind[]).map((k) => (
                <option key={k} value={k}>
                  {ACCOUNT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === 'CARTAO' ? 'Quanto deve hoje' : 'Saldo'} hint={kind === 'CARTAO' ? 'Digite com sinal de menos, ex.: -400' : undefined}>
              <MoneyInput value={balance} onValueChange={setBalance} />
            </Field>
            <Field label="Saldo de qual dia">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={inBudget} onChange={(e) => setInBudget(e.target.checked)} />
            <span>
              Entra no valor que posso gastar por dia
              <span className="block text-xs text-muted">Desmarque para poupança ou investimento: o dinheiro lá não conta como disponível.</span>
            </span>
          </label>
          {account ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Conta ativa
            </label>
          ) : null}
          {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesCard() {
  const categories = usePfCategories();
  const [editing, setEditing] = useState<PfCategory | 'new' | null>(null);
  return (
    <Card>
      <CardHeader
        title="Categorias"
        description="As palavras ajudam a voz a escolher a categoria sozinha."
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus /> Nova categoria
          </Button>
        }
      />
      {categories.isError ? (
        <div className="p-4"><ErrorState error={categories.error} /></div>
      ) : !categories.data ? (
        <div className="p-4"><LoadingBlock rows={3} /></div>
      ) : (
        <ul className="divide-y divide-line">
          {categories.data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {c.name} <Badge tone={c.kind === 'ENTRADA' ? 'success' : 'neutral'}>{c.kind === 'ENTRADA' ? 'entrada' : 'gasto'}</Badge> {!c.active ? <Badge>inativa</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted">{c.keywords.length > 0 ? c.keywords.join(', ') : 'Sem palavras-chave'}</p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={`Editar ${c.name}`} onClick={() => setEditing(c)}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? <CategoryDialog category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function CategoryDialog({ category, onClose }: { category: PfCategory | null; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<'GASTO' | 'ENTRADA'>(category?.kind ?? 'GASTO');
  const [words, setWords] = useState((category?.keywords ?? []).join(', '));
  const [active, setActive] = useState(category?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveCategory(onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={category ? `Editar ${category.name}` : 'Nova categoria'}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                setError(null);
                if (!name.trim()) return setError('Informe o nome.');
                save.mutate(
                  { id: category?.id, name: name.trim(), kind, keywords: words.split(',').map((w) => w.trim()).filter(Boolean), active },
                  { onError: (e) => setError(describeError(e)) },
                );
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
          </Field>
          {!category ? (
            <Field label="Tipo">
              <Select value={kind} onChange={(e) => setKind(e.target.value as 'GASTO' | 'ENTRADA')}>
                <option value="GASTO">Gasto</option>
                <option value="ENTRADA">Entrada</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Palavras que levam a esta categoria" hint="Separadas por vírgula. Ex.: mercado, padaria, feira">
            <Input value={words} onChange={(e) => setWords(e.target.value)} />
          </Field>
          {category ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Categoria ativa
            </label>
          ) : null}
          {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MembersCard() {
  const members = usePfMembers();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const add = useAddMember(() => setEmail(''));
  const remove = useRemoveMember();
  const list = members.data ?? [];
  return (
    <Card>
      <CardHeader title="Quem divide estas finanças" description="Até duas pessoas veem e lançam nos mesmos dados. Precisam já ter login com perfil Dono." />
      {members.isError ? (
        <div className="p-4"><ErrorState error={members.error} /></div>
      ) : !members.data ? (
        <div className="p-4"><LoadingBlock rows={2} /></div>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {list.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.display_name} {m.is_me ? <Badge tone="accent">você</Badge> : null}</p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                </div>
                {list.length > 1 ? (
                  <Button size="icon-sm" variant="ghost" aria-label={m.is_me ? 'Sair deste espaço' : `Remover ${m.display_name}`} onClick={() => setRemoving(m.user_id)}>
                    <UserMinus />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {list.length < 2 ? (
            <form
              className="flex flex-wrap items-end gap-2 border-t border-line p-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                if (!email.trim()) return;
                add.mutate(email.trim(), { onError: (err) => setError(describeError(err)) });
              }}
            >
              <Field label="E-mail da pessoa" className="min-w-56 flex-1">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" autoCapitalize="none" />
              </Field>
              <Button type="submit" variant="outline" loading={add.isPending} disabled={!email.trim()}>
                <UserPlus /> Convidar
              </Button>
              {error ? <p role="alert" className="w-full text-sm text-danger">{error}</p> : null}
            </form>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={list.find((m) => m.user_id === removing)?.is_me ? 'Sair deste espaço?' : 'Remover esta pessoa?'}
        description="Quem sai deixa de ver estas finanças. Os dados continuam com quem ficou."
        confirmLabel="Confirmar"
        onConfirm={() => remove.mutateAsync(removing!).then(() => setRemoving(null)).catch(() => undefined)}
      />
    </Card>
  );
}
