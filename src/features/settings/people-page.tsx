import { KeyRound, Lock, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type MemberRow, useMembers, useSetMemberRole } from '@/data/settings';
import { useAuth } from '@/features/auth/auth-context';
import { type Role, ROLE_LABELS, useMember } from '@/features/member/member-context';
import { formatDateTimeBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { BackLink, ChoiceCards, FormError, NoAccess, ToggleRow } from './bits';

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  dono: 'Tudo: vendas, compras, financeiro, configurações e auditoria.',
  producao: 'Impressões e consulta de estoque, sem valores financeiros.',
  leitura: 'Vê relatórios, valores e auditoria, sem alterar nada.',
};

const ROLE_TONES: Record<Role, 'brand' | 'accent' | 'info'> = { dono: 'brand', producao: 'accent', leitura: 'info' };

function memberName(member: MemberRow) {
  return member.display_name?.trim() || member.email || 'Sem nome';
}

function MemberDialog({ member, onClose }: { member: MemberRow; onClose: () => void }) {
  const [role, setRole] = useState<Role>(member.role);
  const [active, setActive] = useState(member.active);
  const [error, setError] = useState<string | null>(null);
  const save = useSetMemberRole(onClose);
  const changed = role !== member.role || active !== member.active;
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
              variant={active ? 'primary' : 'danger'}
              disabled={!changed}
              loading={save.isPending}
              onClick={() => {
                setError(null);
                save.mutate({ userId: member.user_id, role, active }, { onError: (e) => setError(describeError(e)) });
              }}
            >
              {active ? 'Salvar acesso' : 'Desativar acesso'}
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
            columns={3}
            options={(Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] }))}
          />
          {role === 'dono' && member.role !== 'dono' ? (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Dono vê e altera tudo, inclusive valores, contas e as permissões das outras pessoas.</p>
          ) : null}
          <ToggleRow
            checked={active}
            onChange={setActive}
            label="Acesso ativo"
            description="Desativado: a pessoa não entra mais no sistema, mas o histórico dela continua na auditoria. Dá para reativar depois."
          />
          <FormError>{error}</FormError>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HowToAdd() {
  return (
    <Card>
      <CardHeader title="Como dar acesso a uma pessoa" description="Novas contas são criadas no Supabase (por segurança, não pelo app)." />
      <ol className="space-y-3 p-4 text-sm text-ink-soft">
        <li className="flex gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">1</span>
          <span>
            <strong className="text-ink">Convide pelo e-mail.</strong> No painel do Supabase, abra <em>Authentication → Users → Add user → Send invitation</em> e informe o
            e-mail da pessoa. Ela recebe um link e cria a própria senha.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">2</span>
          <span>
            <strong className="text-ink">Dê o perfil.</strong> No computador do projeto, rode{' '}
            <code className="rounded bg-subtle px-1.5 py-0.5 text-xs text-ink">npm run member:add -- email@exemplo.com producao "Nome"</code> (perfis:{' '}
            <code className="text-xs">dono</code>, <code className="text-xs">producao</code> ou <code className="text-xs">leitura</code>).
          </span>
        </li>
        <li className="flex gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">3</span>
          <span>
            <strong className="text-ink">Pronto.</strong> A pessoa aparece nesta lista e você troca o perfil ou desativa o acesso por aqui. Até receber um perfil, quem entra vê a tela
            “Conta sem acesso”.
          </span>
        </li>
      </ol>
      <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-xs text-muted">
        <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Nunca compartilhe senhas nem chaves do Supabase: cada pessoa tem a própria conta, e tudo o que ela faz fica na auditoria.
      </p>
    </Card>
  );
}

export function PeoplePage() {
  const { can, settings } = useMember();
  const { user } = useAuth();
  const members = useMembers();
  const [editing, setEditing] = useState<MemberRow | null>(null);

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
      { key: 'active', header: 'Situação', sortValue: (r) => Number(r.active), cell: (r) => (r.active ? <Badge tone="success">ativo</Badge> : <Badge tone="danger">desativado</Badge>) },
      { key: 'since', header: 'Desde', sortValue: (r) => r.created_at, cell: (r) => <span className="num text-muted">{formatDateTimeBR(r.created_at, settings.timezone).slice(0, 10)}</span> },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (r) =>
          r.user_id === user?.id ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted" title="Você não pode alterar o próprio acesso">
              <Lock className="size-3.5" aria-hidden /> bloqueado
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
              <Pencil /> Alterar acesso
            </Button>
          ),
      },
    ],
    [user?.id, settings.timezone],
  );

  if (!can('settings')) return <NoAccess title="Pessoas com acesso" />;

  return (
    <Page className="max-w-5xl">
      <PageHeader back={<BackLink />} title="Pessoas com acesso" description="Quem entra no sistema e o que cada perfil pode fazer." />
      <div className="space-y-5">
        {members.isError ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : !members.data ? (
          <LoadingBlock rows={3} />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => r.user_id}
            rowClassName={(r) => (r.active ? undefined : 'opacity-70')}
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
                    {r.active ? null : <Badge tone="danger">desativado</Badge>}
                  </p>
                </div>
                {r.user_id === user?.id ? (
                  <Lock className="size-4 shrink-0 text-muted" aria-label="Você não pode alterar o próprio acesso" />
                ) : (
                  <Button variant="outline" size="icon" aria-label={`Alterar acesso de ${memberName(r)}`} onClick={() => setEditing(r)}>
                    <Pencil />
                  </Button>
                )}
              </div>
            )}
          />
        )}
        <section aria-label="Perfis" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <div key={r} className="rounded-xl border border-line bg-panel px-3 py-2.5">
              <Badge tone={ROLE_TONES[r]}>{ROLE_LABELS[r]}</Badge>
              <p className="mt-1.5 text-xs leading-snug text-muted">{ROLE_DESCRIPTIONS[r]}</p>
            </div>
          ))}
        </section>
        <HowToAdd />
      </div>
      {editing ? <MemberDialog key={editing.user_id} member={editing} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}
