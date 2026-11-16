import { Lock, Mail, Pencil, Send, Trash2, UserMinus } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useCancelInvite, useInviteMember, useRemoveMember, useSentInvites } from '@/data/company';
import { type MemberRow, useMembers, useSetMemberRole } from '@/data/settings';
import { useAuth } from '@/features/auth/auth-context';
import { type Role, ROLE_LABELS, useMember } from '@/features/member/member-context';
import { formatDateTimeBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { BackLink, ChoiceCards, FormError } from './bits';

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  dono: 'Acesso a tudo e gerencia as pessoas: convida, remove e muda o perfil de cada uma.',
  membro: 'Acesso a tudo da empresa: vendas, compras, estoque, financeiro e configurações. Não gerencia pessoas.',
};

const ROLE_TONES: Record<Role, 'brand' | 'accent'> = { dono: 'brand', membro: 'accent' };

function memberName(member: MemberRow) {
  return member.display_name?.trim() || member.email || 'Sem nome';
}

function MemberDialog({ member, onClose }: { member: MemberRow; onClose: () => void }) {
  const [role, setRole] = useState<Role>(member.role);
  const [error, setError] = useState<string | null>(null);
  const save = useSetMemberRole(onClose);
  const remove = useRemoveMember();
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Acesso de ${memberName(member)}`}
        description={member.email ?? undefined}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={role === member.role}
              loading={save.isPending}
              onClick={() => {
                setError(null);
                save.mutate({ userId: member.user_id, role, active: true }, { onError: (e) => setError(describeError(e)) });
              }}
            >
              Salvar perfil
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <ChoiceCards
            name="perfil"
            legend="Perfil"
            value={role}
            onChange={setRole}
            columns={2}
            options={(Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] }))}
          />
          {role === 'dono' && member.role !== 'dono' ? (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Quem é dono também convida, remove e muda o perfil das outras pessoas.</p>
          ) : null}
          <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
            <p className="text-sm text-ink">Remover da empresa</p>
            <p className="mt-0.5 text-xs text-muted">A pessoa perde o acesso a todos os dados da empresa. O histórico dela continua na auditoria.</p>
            {confirmRemove ? (
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmRemove(false)}>
                  Manter
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={remove.isPending}
                  onClick={() => remove.mutate(member.user_id, { onSuccess: onClose, onError: (e) => setError(describeError(e)) })}
                >
                  <UserMinus /> Confirmar remoção
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setConfirmRemove(true)}>
                <UserMinus /> Remover pessoa
              </Button>
            )}
          </div>
          <FormError>{error}</FormError>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InviteCard() {
  const { company } = useMember();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invites = useSentInvites(true);
  const invite = useInviteMember(() => setEmail(''));
  const cancel = useCancelInvite();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    invite.mutate({ email: email.trim(), companyId: company.id }, { onError: (e) => setError(describeError(e)) });
  };

  return (
    <Card>
      <CardHeader
        title="Convidar uma pessoa"
        description="Quem entrar vê e edita tudo desta empresa. Quem não for convidado não vê nada. Se a pessoa ainda não tem conta, recebe um e-mail para criar a senha."
      />
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="E-mail da pessoa" className="flex-1">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@exemplo.com" autoComplete="off" />
        </Field>
        <Button type="submit" loading={invite.isPending} disabled={!email.trim()}>
          <Send /> Enviar convite
        </Button>
      </form>
      {error ? (
        <div className="px-4 pb-3">
          <FormError>{error}</FormError>
        </div>
      ) : null}
      {invites.data && invites.data.length > 0 ? (
        <ul className="divide-y divide-line border-t border-line">
          {invites.data.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Mail className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{i.email}</span>
              <Badge tone="info">convite pendente</Badge>
              <Button variant="ghost" size="icon" aria-label={`Cancelar convite para ${i.email}`} loading={cancel.isPending} onClick={() => cancel.mutate(i.id)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export function PeoplePage() {
  const { can, settings } = useMember();
  const { user } = useAuth();
  const members = useMembers();
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const isOwner = can('members');

  const rows = useMemo(
    () => [...(members.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || memberName(a).localeCompare(memberName(b), 'pt-BR')),
    [members.data],
  );

  const columns = useMemo<Column<MemberRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Pessoa',
        sortValue: (r) => memberName(r),
        cell: (r) => (
          <span>
            <span className="flex items-center gap-1.5 font-medium text-ink">
              {memberName(r)} {r.user_id === user?.id ? <Badge>você</Badge> : null}
            </span>
            <span className="block text-xs text-muted">{r.email}</span>
          </span>
        ),
      },
      { key: 'role', header: 'Perfil', sortValue: (r) => r.role, cell: (r) => <Badge tone={ROLE_TONES[r.role]}>{ROLE_LABELS[r.role]}</Badge> },
      { key: 'since', header: 'Desde', sortValue: (r) => r.created_at, cell: (r) => <span className="num text-muted">{formatDateTimeBR(r.created_at, settings.timezone).slice(0, 10)}</span> },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (r) =>
          !isOwner ? null : r.user_id === user?.id ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted" title="Você não pode alterar o próprio acesso">
              <Lock className="size-3.5" aria-hidden /> você
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
              <Pencil /> Alterar acesso
            </Button>
          ),
      },
    ],
    [user?.id, settings.timezone, isOwner],
  );

  return (
    <Page className="max-w-5xl">
      <PageHeader back={<BackLink />} title="Pessoas da empresa" description="Quem entra nesta empresa e o que cada perfil pode fazer." />
      <div className="space-y-5">
        {isOwner ? <InviteCard /> : null}
        {members.isError ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : !members.data ? (
          <LoadingBlock rows={3} />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => r.user_id}
            emptyTitle="Nenhuma pessoa encontrada"
            mobileCard={(r) => (
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-ink" aria-hidden>
                  {memberName(r).slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{memberName(r)}</span>
                    {r.user_id === user?.id ? <Badge>você</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-muted">{r.email}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={ROLE_TONES[r.role]}>{ROLE_LABELS[r.role]}</Badge>
                  </p>
                </div>
                {isOwner && r.user_id !== user?.id ? (
                  <Button variant="outline" size="icon" aria-label={`Alterar acesso de ${memberName(r)}`} onClick={() => setEditing(r)}>
                    <Pencil />
                  </Button>
                ) : null}
              </div>
            )}
          />
        )}
        <section aria-label="Perfis" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <div key={r} className="rounded-xl border border-line bg-panel px-3 py-2.5">
              <Badge tone={ROLE_TONES[r]}>{ROLE_LABELS[r]}</Badge>
              <p className="mt-1.5 text-xs leading-snug text-muted">{ROLE_DESCRIPTIONS[r]}</p>
            </div>
          ))}
        </section>
      </div>
      {editing ? <MemberDialog key={editing.user_id} member={editing} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}
