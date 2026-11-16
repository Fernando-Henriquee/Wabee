import { Check, ShieldCheck, X } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type DecidedAccount, type PendingAccount, useAccountsOverview, useDecideAccount, useIsPlatformAdmin } from '@/data/accounts';
import { useMember } from '@/features/member/member-context';
import { formatDateTimeBR } from '@/lib/dates';

function PendingRow({ account, timezone }: { account: PendingAccount; timezone: string }) {
  const decide = useDecideAccount();
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-ink" aria-hidden>
        {(account.name || account.email || '?').slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <strong className="block truncate text-ink">{account.name || 'Sem nome'}</strong>
        <span className="block truncate text-muted">{account.email}</span>
        <span className="block truncate text-xs text-muted">
          {account.company ? `Empresa pedida: ${account.company} · ` : ''}
          cadastro em {formatDateTimeBR(account.created_at, timezone)}
        </span>
      </span>
      <Button variant="outline" size="sm" loading={decide.isPending && decide.variables?.approve === false} onClick={() => decide.mutate({ userId: account.user_id, approve: false })}>
        <X /> Recusar
      </Button>
      <Button size="sm" loading={decide.isPending && decide.variables?.approve === true} onClick={() => decide.mutate({ userId: account.user_id, approve: true })}>
        <Check /> Aprovar
      </Button>
    </li>
  );
}

function DecidedRow({ account, timezone }: { account: DecidedAccount; timezone: string }) {
  const decide = useDecideAccount();
  const approved = account.status === 'aprovado';
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{account.name || account.email}</span>
        <span className="block truncate text-xs text-muted">
          {account.email} · {formatDateTimeBR(account.decided_at, timezone)}
        </span>
      </span>
      <Badge tone={approved ? 'success' : 'danger'}>{approved ? 'aprovado' : 'recusado'}</Badge>
      <Button variant="ghost" size="sm" loading={decide.isPending} onClick={() => decide.mutate({ userId: account.user_id, approve: !approved })}>
        {approved ? 'Bloquear' : 'Aprovar'}
      </Button>
    </li>
  );
}

/** Cadastros novos aguardando aprovação do administrador da plataforma. */
export function AccountsPage() {
  const { settings } = useMember();
  const isAdmin = useIsPlatformAdmin();
  const overview = useAccountsOverview(isAdmin.data === true);

  if (isAdmin.isPending) return <Page><LoadingBlock rows={2} /></Page>;
  if (!isAdmin.data) {
    return (
      <Page>
        <PageHeader title="Cadastros" />
        <EmptyState icon={<ShieldCheck />} title="Só para o administrador da plataforma" description="Esta página é de quem aprova as contas novas." />
      </Page>
    );
  }

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Cadastros" description="Quem criou conta e espera a sua aprovação para usar o Wabee. Aprovar só libera a pessoa a criar a própria empresa." />
      <div className="space-y-5">
        {overview.isError ? (
          <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        ) : !overview.data ? (
          <LoadingBlock rows={3} />
        ) : (
          <>
            <Card>
              <CardHeader title={`Aguardando aprovação (${overview.data.pendentes.length})`} />
              {overview.data.pendentes.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">Nenhum cadastro esperando.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {overview.data.pendentes.map((a) => (
                    <PendingRow key={a.user_id} account={a} timezone={settings.timezone} />
                  ))}
                </ul>
              )}
            </Card>
            {overview.data.decididas.length > 0 ? (
              <Card>
                <CardHeader title="Últimas decisões" description="Dá para voltar atrás: bloquear quem foi aprovado ou aprovar quem foi recusado." />
                <ul className="divide-y divide-line">
                  {overview.data.decididas.map((a) => (
                    <DecidedRow key={a.user_id} account={a} timezone={settings.timezone} />
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </Page>
  );
}
