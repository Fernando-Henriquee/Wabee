import { Hourglass, LogOut, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { Link } from 'react-router';
import { BrandMark, BrandName } from '@/components/layout/brand';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useAuth } from '@/features/auth/auth-context';
import { resetAppAndReload } from '@/lib/pwa-reset';

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Carregando">
      <div className="flex flex-col items-center gap-3">
        <BrandMark className="size-14 animate-pulse rounded-2xl" />
        <BrandName className="text-2xl" />
      </div>
    </div>
  );
}

export function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 px-4 py-6 sm:px-6" role="status" aria-label="Carregando">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function OfflineWithoutDataScreen() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <WifiOff className="size-10 text-warning" aria-hidden />
      <h1 className="text-2xl">Sem conexão</h1>
      <p className="text-sm text-ink-soft">
        Ainda não há dados salvos neste aparelho para mostrar sem internet (ou eles passaram de 72 horas e foram apagados por segurança).
        Conecte-se para continuar.
      </p>
    </div>
  );
}

export function ConfigProblemScreen({ problems }: { problems: string[] }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <ShieldAlert className="size-10 text-danger" aria-hidden />
      <h1 className="mt-3 text-2xl">Configuração incompleta</h1>
      <p className="mt-2 text-sm text-ink-soft">O aplicativo não pode iniciar até que as variáveis de ambiente sejam corrigidas:</p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">
        Na Vercel, cadastre as variáveis em Settings → Environment Variables e faça um novo deploy (Redeploy). Passo a passo em docs/VERCEL.md.
      </p>
    </div>
  );
}

export function NoAccessScreen() {
  const { user, signOut } = useAuth();
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <BrandMark className="mx-auto size-14 rounded-2xl" />
      <h1 className="mt-4 text-2xl">Conta sem acesso</h1>
      <p className="mt-2 text-sm text-ink-soft">
        A conta <strong>{user?.email}</strong> entrou com sucesso, mas ainda não tem um perfil de acesso no Wabee. Peça ao dono do sistema para
        liberar o acesso (docs/SUPABASE.md).
      </p>
      <Button className="mt-6" variant="outline" onClick={() => void signOut('local')}>
        <LogOut /> Sair
      </Button>
    </div>
  );
}

export function MembershipErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { signOut } = useAuth();
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-16">
      <h1 className="text-2xl">Não foi possível carregar seus dados</h1>
      <ErrorState error={error} onRetry={onRetry} />
      <p className="text-sm text-muted">Se o erro continuar, o aparelho pode estar com uma versão antiga do app. Atualize e tente de novo.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void resetAppAndReload()}>
          <RefreshCw /> Atualizar o app
        </Button>
        <Button variant="ghost" onClick={() => void signOut('local')}>
          <LogOut /> Sair
        </Button>
      </div>
    </div>
  );
}

/** Conta criada, mas ainda sem a aprovação do administrador: não faz nada até lá. */
export function PendingApprovalScreen({ onCheck, checking }: { onCheck: () => void; checking: boolean }) {
  const { user, signOut } = useAuth();
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <BrandMark className="mx-auto size-14 rounded-2xl" />
      <Hourglass className="mx-auto mt-6 size-8 text-warning" aria-hidden />
      <h1 className="mt-3 text-2xl">Cadastro aguardando aprovação</h1>
      <p className="mt-2 text-sm text-ink-soft">
        A conta <strong>{user?.email}</strong> foi criada e está na fila de aprovação. Assim que for aprovada, esta tela libera sozinha e você
        cria a sua empresa.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="outline" loading={checking} onClick={onCheck}>
          <RefreshCw /> Verificar agora
        </Button>
        <Button variant="ghost" onClick={() => void signOut('local')}>
          <LogOut /> Sair
        </Button>
      </div>
    </div>
  );
}

export function DeclinedAccountScreen() {
  const { user, signOut } = useAuth();
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <BrandMark className="mx-auto size-14 rounded-2xl" />
      <ShieldAlert className="mx-auto mt-6 size-8 text-danger" aria-hidden />
      <h1 className="mt-3 text-2xl">Cadastro não aprovado</h1>
      <p className="mt-2 text-sm text-ink-soft">
        A conta <strong>{user?.email}</strong> não foi aprovada para usar o Wabee. Se isso for um engano, fale com quem administra a plataforma.
      </p>
      <Button className="mt-6" variant="outline" onClick={() => void signOut('local')}>
        <LogOut /> Sair
      </Button>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <Page>
      <PageHeader title="Página não encontrada" description="O endereço acessado não existe." />
      <Button asChild>
        <Link to="/">Voltar para a visão geral</Link>
      </Button>
    </Page>
  );
}
