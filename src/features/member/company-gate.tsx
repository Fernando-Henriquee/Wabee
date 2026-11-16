import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Mail, Plus } from 'lucide-react';
import { createContext, type FormEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark } from '@/components/layout/brand';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DeclinedAccountScreen, MembershipErrorScreen, OfflineWithoutDataScreen, PendingApprovalScreen, Splash } from '@/app/screens';
import { useMyAccountStatus } from '@/data/accounts';
import { rpc } from '@/data/api';
import {
  type CompanySummary,
  type PendingInvite,
  useAcceptInvite,
  useCreateCompany,
  useDeclineInvite,
  useMyCompanies,
  usePendingInvites,
} from '@/data/company';
import { useAuth } from '@/features/auth/auth-context';
import { readRememberedCompanyId, rememberCompanyId, setActiveCompanyId } from '@/lib/active-company';
import { useOnline } from '@/lib/connectivity';
import { describeError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

interface CompanyState {
  companies: CompanySummary[];
  active: CompanySummary;
  invites: PendingInvite[];
  /** Troca a empresa ativa (os dados são recarregados do zero para a nova empresa). */
  switchCompany: (id: string) => void;
  /** Recarrega a lista de empresas e convites da conta. */
  refresh: () => Promise<void>;
}

const CompanyContext = createContext<CompanyState | null>(null);

export function useCompanies(): CompanyState {
  const context = useContext(CompanyContext);
  if (!context) throw new Error('useCompanies fora do CompanyGate');
  return context;
}

/**
 * Descobre as empresas da conta e escolhe a ativa. Sem nenhuma empresa, a pessoa vê os convites
 * pendentes e pode criar a própria. `children` recebe a empresa ativa e deve remontar quando ela mudar.
 */
export function CompanyGate({ userId, children }: { userId: string; children: (active: CompanySummary) => ReactNode }) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const status = useMyAccountStatus(userId);
  const approved = status.data === 'aprovado';
  const companies = useMyCompanies(userId);
  const invites = usePendingInvites(userId);
  const [selected, setSelected] = useState<string | null>(() => readRememberedCompanyId());
  const { user } = useAuth();
  // Quem criou a conta pela tela "Criar conta" informou o nome da empresa: ela é criada no primeiro acesso.
  const pendingName = typeof user?.user_metadata?.company_name === 'string' ? user.user_metadata.company_name.trim() : '';
  const [autoCreate, setAutoCreate] = useState<'idle' | 'creating' | 'done' | 'failed'>('idle');
  const [autoError, setAutoError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const list = useMemo(() => companies.data ?? [], [companies.data]);
  const active = list.find((c) => c.id === selected) ?? list[0] ?? null;

  // Definido durante a renderização: as consultas dos filhos já saem com a empresa certa.
  setActiveCompanyId(active?.id ?? null);
  useEffect(() => {
    rememberCompanyId(active?.id ?? null);
  }, [active?.id]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['account'] }),
      queryClient.refetchQueries({ queryKey: ['account'] }),
    ]);
  }, [queryClient]);

  const switchCompany = useCallback((id: string) => {
    setActiveCompanyId(id);
    rememberCompanyId(id);
    setSelected(id);
  }, []);

  useEffect(() => {
    if (!approved || !companies.isSuccess || list.length > 0 || !pendingName || autoStarted.current) return;
    autoStarted.current = true; // uma tentativa só: nunca cria empresa em duplicidade
    setAutoCreate('creating');
    void (async () => {
      try {
        const id = await rpc<string>('create_company', { p_name: pendingName });
        // O nome já foi usado: sai do cadastro para não criar outra empresa se a pessoa um dia ficar sem nenhuma.
        await supabase.auth.updateUser({ data: { company_name: null } }).catch(() => undefined);
        switchCompany(id);
        await refresh();
        setAutoCreate('done');
      } catch (error) {
        setAutoError(describeError(error));
        setAutoCreate('failed');
      }
    })();
  }, [approved, companies.isSuccess, list.length, pendingName, switchCompany, refresh]);

  const value = useMemo<CompanyState | null>(
    () => (active ? { companies: list, active, invites: invites.data ?? [], switchCompany, refresh } : null),
    [list, active, invites.data, switchCompany, refresh],
  );

  if (status.isPending || companies.isPending) return online ? <Splash /> : <OfflineWithoutDataScreen />;
  if (status.isError && !status.data) return <MembershipErrorScreen error={status.error} onRetry={() => void status.refetch()} />;
  // Conta nova só entra no sistema depois da aprovação do administrador da plataforma.
  if (status.data === 'pendente') return <PendingApprovalScreen onCheck={() => void status.refetch()} checking={status.isFetching} />;
  if (status.data === 'recusado') return <DeclinedAccountScreen />;
  if (companies.isError && !companies.data) return <MembershipErrorScreen error={companies.error} onRetry={() => void companies.refetch()} />;
  if (!active || !value) {
    // A empresa do cadastro está sendo criada (ou acabou de ser): não pisca a tela de "vamos começar".
    if ((pendingName && autoCreate !== 'failed') || autoCreate === 'creating' || autoCreate === 'done') return <Splash />;
    return (
      <NoCompanyScreen
        invites={invites.data ?? []}
        suggestedName={pendingName}
        error={autoError}
        onJoined={(id) => {
          switchCompany(id);
          void refresh();
        }}
      />
    );
  }
  return <CompanyContext.Provider value={value}>{children(active)}</CompanyContext.Provider>;
}

function InviteRow({ invite, onJoined, onDeclined }: { invite: PendingInvite; onJoined: (companyId: string) => void; onDeclined: () => void }) {
  const accept = useAcceptInvite(onJoined);
  const decline = useDeclineInvite(onDeclined);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
        <Mail className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <strong className="block truncate text-ink">{invite.company_name}</strong>
        <span className="block truncate text-xs text-muted">Convite de {invite.invited_by}</span>
      </span>
      <Button variant="outline" size="sm" loading={decline.isPending} onClick={() => decline.mutate(invite.id)}>
        Recusar
      </Button>
      <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate(invite.id)}>
        Aceitar
      </Button>
    </li>
  );
}

/** Formulário para criar uma empresa nova (a conta vira dona dela). */
export function CreateCompanyForm({ onCreated, initialName = '' }: { onCreated: (id: string) => void; initialName?: string }) {
  const [name, setName] = useState(initialName);
  const create = useCreateCompany(onCreated);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
      <Field label="Nome da empresa" className="flex-1">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Minha Oficina 3D" />
      </Field>
      <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
        <Plus /> Criar empresa
      </Button>
    </form>
  );
}

function NoCompanyScreen({
  invites,
  onJoined,
  suggestedName = '',
  error = null,
}: {
  invites: PendingInvite[];
  onJoined: (companyId: string) => void;
  suggestedName?: string;
  error?: string | null;
}) {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const reload = () => void queryClient.invalidateQueries({ queryKey: ['account'] });
  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-12">
      <div className="text-center">
        <BrandMark className="mx-auto size-14 rounded-2xl" />
        <h1 className="mt-4 text-2xl">Vamos começar</h1>
        <p className="mt-2 text-sm text-ink-soft">
          A conta <strong>{user?.email}</strong> ainda não faz parte de nenhuma empresa. Aceite um convite ou crie a sua.
        </p>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            Não foi possível criar a empresa automaticamente: {error} Crie abaixo.
          </p>
        ) : null}
      </div>
      {invites.length > 0 ? (
        <Card>
          <CardHeader title="Convites para você" description="Quem convidou vai ver e editar os dados da empresa junto com você." />
          <ul className="divide-y divide-line">
            {invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} onJoined={onJoined} onDeclined={reload} />
            ))}
          </ul>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Criar minha empresa" description="Seus dados ficam separados dos de qualquer outra empresa. Depois você pode convidar pessoas." />
        <CreateCompanyForm onCreated={onJoined} initialName={suggestedName} />
      </Card>
      <div className="text-center">
        <Button variant="ghost" onClick={() => void signOut('local')}>
          <LogOut /> Sair
        </Button>
      </div>
    </div>
  );
}


/** Convites pendentes e criação de outra empresa, a partir do menu da conta. */
export function CompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { invites, switchCompany, refresh } = useCompanies();
  const joined = (id: string) => {
    switchCompany(id);
    void refresh();
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Empresas" description="Convites recebidos e criação de uma nova empresa na sua conta." size="md">
        <div className="space-y-4">
          {invites.length > 0 ? (
            <Card>
              <CardHeader title="Convites para você" />
              <ul className="divide-y divide-line">
                {invites.map((invite) => (
                  <InviteRow key={invite.id} invite={invite} onJoined={joined} onDeclined={() => void refresh()} />
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Criar outra empresa" description="Fica separada das demais: cada empresa tem os próprios dados e pessoas." />
            <CreateCompanyForm onCreated={joined} />
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
