import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useMember } from '@/features/member/member-context';
import { useOnline } from '@/lib/connectivity';
import { cn } from '@/lib/cn';
import { formatDateTimeBR } from '@/lib/dates';

interface QueryLike {
  dataUpdatedAt: number;
  isFetching: boolean;
  isError: boolean;
  isStale?: boolean;
  data?: unknown;
  refetch?: () => unknown;
}

/**
 * Indica de quando são os dados exibidos. Offline ou após falha de atualização,
 * deixa explícito que podem estar desatualizados.
 */
export function Freshness({ query, className }: { query: QueryLike; className?: string }) {
  const online = useOnline();
  const { settings } = useMember();
  if (!query.dataUpdatedAt) return null;
  const when = formatDateTimeBR(new Date(query.dataUpdatedAt).toISOString(), settings.timezone);
  const outdated = !online || (query.isError && query.data !== undefined);
  return (
    <p className={cn('inline-flex items-center gap-1.5 text-xs', outdated ? 'font-medium text-warning' : 'text-muted', className)} aria-live="polite">
      {outdated ? <TriangleAlert className="size-3.5" aria-hidden /> : null}
      {outdated ? `Dados salvos em ${when} — podem estar desatualizados` : query.isFetching ? 'Atualizando…' : `Atualizado em ${when}`}
      {online && query.refetch && !query.isFetching ? (
        <button type="button" onClick={() => void query.refetch?.()} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Atualizar dados">
          <RefreshCw className="size-3.5" />
        </button>
      ) : null}
    </p>
  );
}
