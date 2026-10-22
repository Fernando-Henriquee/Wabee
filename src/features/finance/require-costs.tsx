import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Page } from '@/components/layout/page';
import { EmptyState } from '@/components/ui/states';
import { useMember } from '@/features/member/member-context';

/** O financeiro mostra valores: só dono e leitura entram (o banco também esconde os dados). */
export function RequireCosts({ children }: { children: ReactNode }) {
  const { can } = useMember();
  if (can('costs')) return children;
  return (
    <Page>
      <EmptyState icon={<ShieldOff />} title="Sem acesso" description="O financeiro está disponível só para o dono e para o perfil de leitura." />
    </Page>
  );
}
