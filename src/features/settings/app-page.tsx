import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Download, HardDrive, MonitorSmartphone, RefreshCw, Share, ShieldCheck, SquarePlus, Trash2, WifiOff } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { wipeLocalData } from '@/features/auth/auth-context';
import { useMember } from '@/features/member/member-context';
import { useOnline } from '@/lib/connectivity';
import { env } from '@/lib/env';
import { formatNumber } from '@/lib/money';
import { CACHE_MAX_AGE_MS } from '@/lib/query-cache';
import { BackLink } from './bits';
import { isIOS, useInstallPrompt } from './install-prompt';

const ENV_LABELS: Record<string, string> = { production: 'Produção', preview: 'Prévia', development: 'Desenvolvimento', local: 'Ambiente local de testes' };

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function InstallCard() {
  const { canPrompt, standalone, install } = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  const ios = isIOS();
  return (
    <Card>
      <CardHeader
        title="Instalar no aparelho"
        description="Instalado, o Wabee abre como um aplicativo, em tela cheia, com ícone na tela inicial e atalhos."
        actions={standalone ? <Badge tone="success">instalado</Badge> : null}
      />
      <div className="space-y-3 p-4 text-sm text-ink-soft">
        {standalone ? (
          <p className="flex items-center gap-2 text-success">
            <CircleCheck className="size-5 shrink-0" aria-hidden /> Você está usando o aplicativo instalado.
          </p>
        ) : canPrompt ? (
          <Button
            size="lg"
            className="w-full sm:w-auto"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const accepted = await install();
                if (accepted) toast.success('Aplicativo instalado. Procure o ícone do Wabee na tela inicial.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download /> Instalar aplicativo
          </Button>
        ) : ios ? (
          <ol className="space-y-2.5">
            <Step n={1}>Abra este endereço no <strong className="text-ink">Safari</strong>.</Step>
            <Step n={2}>
              Toque em <strong className="text-ink">Compartilhar</strong> <Share className="inline size-4 align-text-bottom" aria-label="(ícone de compartilhar)" />.
            </Step>
            <Step n={3}>
              Escolha <strong className="text-ink">Adicionar à Tela de Início</strong> <SquarePlus className="inline size-4 align-text-bottom" aria-hidden /> e confirme.
            </Step>
          </ol>
        ) : (
          <ol className="space-y-2.5">
            <Step n={1}>
              Abra no <strong className="text-ink">Chrome</strong> ou <strong className="text-ink">Edge</strong>.
            </Step>
            <Step n={2}>
              No menu <strong className="text-ink">⋮</strong>, escolha <strong className="text-ink">Instalar app</strong> (no Android pode aparecer como{' '}
              <strong className="text-ink">Adicionar à tela inicial</strong>).
            </Step>
            <Step n={3}>Se a opção não aparecer, o aplicativo já pode estar instalado: procure o ícone do Wabee.</Step>
          </ol>
        )}
      </div>
    </Card>
  );
}

type UpdateStatus = 'idle' | 'checking' | 'current' | 'found' | 'unsupported';

async function checkForUpdate(): Promise<UpdateStatus> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'unsupported';
  await registration.update();
  const installing = registration.installing;
  if (installing) {
    // Espera a nova versão terminar de baixar (o aviso "Atualizar" aparece sozinho).
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 15_000);
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' || installing.state === 'redundant') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }
  return registration.waiting ? 'found' : 'current';
}

function VersionCard() {
  const online = useOnline();
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const messages: Record<Exclude<UpdateStatus, 'idle' | 'checking'>, ReactNode> = {
    current: (
      <span className="flex items-center gap-2 text-success">
        <CircleCheck className="size-4 shrink-0" aria-hidden /> Você já está na versão mais recente.
      </span>
    ),
    found: 'Nova versão encontrada. Salve o que estiver editando e toque em “Atualizar” no aviso da tela.',
    unsupported: 'A atualização automática funciona no aplicativo publicado. Neste ambiente, recarregue a página para ver a versão mais nova.',
  };
  return (
    <Card>
      <CardHeader title="Versão e atualização" description="O app procura versões novas sozinho a cada hora e pergunta antes de atualizar." />
      <div className="px-4 pt-2">
        <dl className="divide-y divide-line">
          <Info label="Versão" value={<span className="num">{__APP_VERSION__}</span>} />
          <Info label="Ambiente" value={ENV_LABELS[env.appEnv] ?? env.appEnv} />
          <Info label="Conexão" value={online ? <Badge tone="success">on-line</Badge> : <Badge tone="warning">sem conexão</Badge>} />
        </dl>
      </div>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <Button
          variant="outline"
          loading={status === 'checking'}
          disabled={!online}
          onClick={async () => {
            setStatus('checking');
            try {
              setStatus(await checkForUpdate());
            } catch {
              setStatus('idle');
              toast.error('Não foi possível procurar atualizações agora. Tente de novo em instantes.');
            }
          }}
        >
          <RefreshCw /> Procurar atualização
        </Button>
        {status !== 'idle' && status !== 'checking' ? (
          <p role="status" className="text-sm text-ink-soft">
            {messages[status]}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function useStorageEstimate() {
  const [usage, setUsage] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    navigator.storage
      ?.estimate?.()
      .then((estimate) => alive && setUsage(estimate.usage ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return usage;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 0)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

function OfflineDataCard() {
  const queryClient = useQueryClient();
  const usage = useStorageEstimate();
  const [confirm, setConfirm] = useState(false);
  const hours = Math.round(CACHE_MAX_AGE_MS / 3_600_000);
  return (
    <Card>
      <CardHeader title="Dados neste aparelho" description="Para abrir sem internet, o app guarda uma cópia das últimas telas vistas." />
      <ul className="space-y-2.5 p-4 text-sm text-ink-soft">
        <li className="flex gap-2.5">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>Sem conexão você consulta o que já foi aberto (marcado como “podem estar desatualizados”). Vendas, pagamentos e outros lançamentos só com internet.</span>
        </li>
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>
            A cópia é só sua, vale por até {hours} horas e é apagada ao sair da conta. Senhas não ficam guardadas nela.
          </span>
        </li>
        <li className="flex gap-2.5">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>Espaço usado pelo app neste aparelho: {usage === null ? 'não informado pelo navegador' : <strong className="num text-ink">{formatBytes(usage)}</strong>}.</span>
        </li>
      </ul>
      <div className="flex flex-col gap-2 border-t border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">Use se algo parecer desatualizado ou antes de emprestar o aparelho. Você continua conectado.</p>
        <Button variant="danger-outline" onClick={() => setConfirm(true)}>
          <Trash2 /> Limpar dados deste aparelho
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Limpar dados deste aparelho?"
        description="A cópia local das telas e as preferências do app neste aparelho serão apagadas, e o app recarrega buscando tudo de novo no servidor. Nada é apagado do sistema e você continua conectado."
        confirmLabel="Limpar e recarregar"
        onConfirm={async () => {
          queryClient.clear();
          await wipeLocalData();
          window.location.reload();
        }}
      />
    </Card>
  );
}

export function AppPage() {
  const { can } = useMember();
  return (
    <Page className="max-w-3xl">
      <PageHeader back={<BackLink />} title="Aplicativo" description="Instalação, versão e dados guardados neste aparelho." />
      <div className="space-y-4">
        <InstallCard />
        <VersionCard />
        <OfflineDataCard />
        <p className="flex items-start gap-2 px-1 text-xs text-muted">
          <MonitorSmartphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Perdeu um aparelho? Em <Link to="/perfil" className="underline">Meu perfil</Link> use “Sair de todos os aparelhos”.
            {can('settings') ? ' Para tirar o acesso de outra pessoa, use Pessoas com acesso.' : ''}
          </span>
        </p>
      </div>
    </Page>
  );
}
