import { CircleAlert, LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useOnline } from '@/lib/connectivity';
import { describeError } from '@/lib/errors';
import { Button } from './button';

export function Spinner({ className, label = 'Carregando…' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-muted', className)}>
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-line/70', className)} />;
}

/** Carregamento. Sem conexão e sem dados salvos, explica em vez de carregar para sempre. */
export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  const online = useOnline();
  if (!online) {
    return (
      <EmptyState
        icon={<WifiOff />}
        title="Sem conexão"
        description="Esta tela ainda não tem dados salvos neste aparelho. Conecte-se à internet para carregá-la."
      />
    );
  }
  return (
    <div className="space-y-2" role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-panel/60 px-6 py-10 text-center', className)}>
      {icon ? <div className="mb-1 text-accent-ink [&_svg]:size-8">{icon}</div> : null}
      <p className="font-display text-lg text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger sm:flex-row sm:items-center', className)}>
      <CircleAlert className="size-5 shrink-0" aria-hidden />
      <p className="flex-1">{describeError(error)}</p>
      {onRetry ? (
        <Button variant="danger-outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
