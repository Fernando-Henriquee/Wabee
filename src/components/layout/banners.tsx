import { FlaskConical, WifiOff } from 'lucide-react';
import { useOnline } from '@/lib/connectivity';
import { isLocalEnv } from '@/lib/env';

export function LocalEnvBanner() {
  if (!isLocalEnv) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-info px-3 py-1 text-center text-xs font-medium text-white">
      <FlaskConical className="size-3.5" aria-hidden />
      Ambiente local de testes — dados fictícios, sem relação com os dados reais.
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <p>
        <strong>Sem conexão.</strong> Você está vendo dados salvos neste aparelho, que podem estar desatualizados. Vendas, pagamentos e
        despesas só podem ser registrados com conexão.
      </p>
    </div>
  );
}
