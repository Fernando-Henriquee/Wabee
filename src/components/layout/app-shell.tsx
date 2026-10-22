import { LogOut, Menu as MenuIcon, Plus, UserRound } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useAuth } from '@/features/auth/auth-context';
import { ROLE_LABELS, useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { LocalEnvBanner, OfflineBanner } from './banners';
import { BrandMark, BrandName } from './brand';
import { MOBILE_PRIMARY, NAV_ITEMS, type NavItem, QUICK_ACTIONS } from './nav';
import { PwaUpdatePrompt } from './pwa-update';

function useVisibleItems() {
  const { can } = useMember();
  return NAV_ITEMS.filter((item) => !item.capability || can(item.capability));
}

function useQuickActions() {
  const { can } = useMember();
  return QUICK_ACTIONS.filter((action) => can(action.capability));
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-ink text-brand-fg' : 'text-ink-soft hover:bg-subtle hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn('size-[1.1rem] shrink-0', isActive && 'text-accent')} aria-hidden />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, signOut } = useAuth();
  const { role, settings } = useMember();
  const name = (user?.user_metadata?.display_name as string | undefined) ?? user?.email ?? '';
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className={cn('flex min-w-0 items-center gap-2 rounded-lg text-left hover:bg-subtle', compact ? 'p-1.5' : 'w-full px-2 py-2')}
          aria-label="Menu da conta"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-ink">
            {name.slice(0, 1).toUpperCase() || <UserRound className="size-4" />}
          </span>
          {compact ? null : (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{name}</span>
              <span className="block truncate text-xs text-muted">{ROLE_LABELS[role]}</span>
            </span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent align={compact ? 'end' : 'start'}>
        <div className="px-2.5 py-2 text-xs text-muted">
          <p className="truncate font-medium text-ink">{user?.email}</p>
          <p className="truncate">
            {settings.company_name} · {ROLE_LABELS[role]}
          </p>
        </div>
        <MenuSeparator />
        <MenuItem asChild>
          <Link to="/perfil">
            <UserRound /> Meu perfil
          </Link>
        </MenuItem>
        <MenuItem onSelect={() => void signOut('local')}>
          <LogOut /> Sair
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Atalhos do "+" (US-0.7): folha inferior no celular, menu no computador. */
function QuickActionsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const actions = useQuickActions();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="O que você quer registrar?" size="sm">
        <ul className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <li key={action.to}>
                <Link
                  to={action.to}
                  onClick={() => onOpenChange(false)}
                  className="flex h-full flex-col gap-1.5 rounded-xl border border-line bg-panel p-3 hover:border-ink active:bg-subtle"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-ink">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="text-sm font-semibold text-ink">{action.label}</span>
                  <span className="text-xs leading-snug text-muted">{action.description}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function Sidebar({ onQuick }: { onQuick: () => void }) {
  const items = useVisibleItems();
  const actions = useQuickActions();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-panel/80 lg:flex">
      <Link to="/" className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <BrandName className="text-2xl" store />
      </Link>
      {actions.length > 0 ? (
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={onQuick}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-ink shadow-sm hover:bg-accent-hover"
          >
            <Plus className="size-4" /> Registrar
          </button>
        </div>
      ) : null}
      <nav aria-label="Navegação principal" className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {items.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="border-t border-line p-3">
        <UserMenu />
      </div>
    </aside>
  );
}

function MobileNav({ onQuick }: { onQuick: () => void }) {
  const items = useVisibleItems();
  const actions = useQuickActions();
  const primary = MOBILE_PRIMARY.map((to) => items.find((item) => item.to === to)).filter((item): item is NavItem => Boolean(item));

  const tab = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.7rem] font-medium', isActive ? 'text-ink' : 'text-muted')}
      >
        {({ isActive }) => (
          <>
            <span className={cn('grid h-6 w-10 place-items-center rounded-full', isActive && 'bg-accent-soft')}>
              <Icon className="size-5" aria-hidden />
            </span>
            {item.label === 'Visão geral' ? 'Início' : item.label}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur safe-bottom lg:hidden">
      <div className="mx-auto flex max-w-lg items-stretch">
        {primary.slice(0, 2).map(tab)}
        {actions.length > 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={onQuick}
              aria-label="Registrar (atalhos)"
              className="-mt-5 grid size-14 place-items-center rounded-full bg-accent text-ink shadow-[var(--shadow-pop)] ring-4 ring-cream"
            >
              <Plus className="size-6" strokeWidth={2.5} />
            </button>
          </div>
        ) : null}
        {primary.slice(2).map(tab)}
      </div>
    </nav>
  );
}

function MobileMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const items = useVisibleItems();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Menu" size="sm">
        <div className="grid grid-cols-2 gap-1">
          {items.map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={() => onOpenChange(false)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  return (
    <div className="flex min-h-dvh flex-col">
      <LocalEnvBanner />
      <div className="flex flex-1">
        <Sidebar onQuick={() => setQuickOpen(true)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-cream/95 px-3 py-2 backdrop-blur safe-top lg:hidden">
            <div className="flex min-w-0 items-center gap-1">
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu" className="grid size-10 place-items-center rounded-lg text-ink-soft hover:bg-subtle">
                <MenuIcon className="size-5" />
              </button>
              <Link to="/" className="flex items-center gap-2" aria-label="Visão geral">
                <BrandMark className="size-7 rounded-lg" />
                <BrandName />
              </Link>
            </div>
            <UserMenu compact />
          </header>
          <OfflineBanner />
          <main id="conteudo" key={location.pathname} className="flex-1 pb-24 lg:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav onQuick={() => setQuickOpen(true)} />
      <QuickActionsSheet open={quickOpen} onOpenChange={setQuickOpen} />
      <MobileMenu open={menuOpen} onOpenChange={setMenuOpen} />
      <PwaUpdatePrompt />
    </div>
  );
}
