import { NavLink } from 'react-router';
import { cn } from '@/lib/cn';

const LINKS = [
  { to: '/financeiro', label: 'Resumo', end: true },
  { to: '/financeiro/pagar', label: 'A pagar' },
  { to: '/financeiro/receber', label: 'A receber' },
  { to: '/financeiro/despesas', label: 'Despesas' },
  { to: '/financeiro/caixa', label: 'Caixa' },
  { to: '/financeiro/dre', label: 'DRE' },
  { to: '/financeiro/dono', label: 'Dono' },
  { to: '/financeiro/contas', label: 'Contas' },
  { to: '/financeiro/fechamento', label: 'Fechamento' },
];

/** Navegação entre as telas do financeiro (rolagem horizontal no celular). */
export function FinanceNav() {
  return (
    <nav aria-label="Financeiro" className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="inline-flex min-w-full gap-1 rounded-xl border border-line bg-subtle p-1 sm:min-w-0">
        {LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cn('inline-flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-ink', isActive && 'bg-panel text-ink shadow-sm')
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
