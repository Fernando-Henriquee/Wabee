import { Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router';
import { Page } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { usePfSpaceReady } from '@/data/personal';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { PersonalActionsContext } from './actions';
import { PrivacyProvider, PrivacyToggle } from './privacy';
import { QuickAddDialog } from './quick-add';

const TABS = [
  { to: '/pessoal', label: 'Hoje', end: true },
  { to: '/pessoal/calendario', label: 'Calendário' },
  { to: '/pessoal/lancamentos', label: 'Lançamentos' },
  { to: '/pessoal/parcelas', label: 'Parcelas e contas' },
  { to: '/pessoal/ajustes', label: 'Ajustes' },
];

/** Moldura da aba Pessoal: separada do resto do sistema, com abas internas e o botão de lançar. */
export function PersonalShell() {
  const { can } = useMember();
  const ready = usePfSpaceReady();
  const [params, setParams] = useSearchParams();
  const [add, setAdd] = useState<{ open: boolean; date?: string }>({ open: params.get('novo') === '1' });

  if (!can('write')) {
    return (
      <Page>
        <EmptyState icon={<Lock />} title="Só para o perfil Dono" description="As finanças pessoais ficam disponíveis apenas para quem tem perfil Dono." />
      </Page>
    );
  }
  if (ready.isError) return <Page><ErrorState error={ready.error} onRetry={() => void ready.refetch()} /></Page>;
  if (!ready.data) return <Page><LoadingBlock /></Page>;

  const openAdd = (date?: string) => setAdd({ open: true, date });
  const closeAdd = (open: boolean) => {
    setAdd({ open });
    if (!open && params.get('novo')) {
      const next = new URLSearchParams(params);
      next.delete('novo');
      setParams(next, { replace: true });
    }
  };

  return (
    <PrivacyProvider>
      <PersonalActionsContext.Provider value={{ openAdd }}>
        <div className="border-b border-info/20 bg-info-soft/60">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-1.5 text-xs text-info sm:px-6">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">Pessoal: separado da empresa. Só você e quem você convidou veem.</span>
            <PrivacyToggle />
          </div>
        </div>
        <Page>
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold sm:text-[1.75rem]">Pessoal</h1>
            <Button onClick={() => openAdd()} className="hidden sm:inline-flex">
              <Plus /> Lançar
            </Button>
          </header>
          <nav aria-label="Seções das finanças pessoais" className="-mx-1 mb-5 overflow-x-auto px-1">
            <ul className="inline-flex min-w-full gap-1 rounded-xl border border-line bg-subtle p-1">
              {TABS.map((tab) => (
                <li key={tab.to}>
                  <NavLink
                    to={tab.to}
                    end={tab.end}
                    className={({ isActive }) =>
                      cn('inline-flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors', isActive ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink')
                    }
                  >
                    {tab.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <Outlet />
        </Page>
        <Button
          size="icon"
          onClick={() => openAdd()}
          aria-label="Lançar gasto"
          className="fixed bottom-24 right-4 z-30 size-14 rounded-full shadow-[var(--shadow-pop)] sm:hidden"
        >
          <Plus className="!size-6" />
        </Button>
        <QuickAddDialog open={add.open} onOpenChange={closeAdd} initialDate={add.date} />
      </PersonalActionsContext.Provider>
    </PrivacyProvider>
  );
}
