import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Mail, Plus } from 'lucide-react';
import { createContext, type FormEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BrandMark } from '@/components/layout/brand';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MembershipErrorScreen, OfflineWithoutDataScreen, Splash } from '@/app/screens';
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
  const companies = useMyCompanies(userId);
  const invites = usePendingInvites(userId);
  const [selected, setSelected] = useState<string | null>(() => readRememberedCompanyId());

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

  const value = useMemo<CompanyState | null>(
    () => (active ? { companies: list, active, invites: invites.data ?? [], switchCompany, refresh } : null),
    [list, active, invites.data, switchCompany, refresh],
  );

  if (companies.isPending) return online ? <Splash /> : <OfflineWithoutDataScreen />;
  if (companies.isError && !companies.data) return <MembershipErrorScreen error={companies.error} onRetry={() => void companies.refetch()} />;
  if (!active || !value) {
    return <NoCompanyScreen invites={invites.data ?? []} onJoined={(id) => { switchCompany(id); void refresh(); }} />;
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
export function CreateCompanyForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
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

function NoCompanyScreen({ invites, onJoined }: { invites: PendingInvite[]; onJoined: (companyId: string) => void }) {
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
        <CreateCompanyForm onCreated={onJoined} />
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
