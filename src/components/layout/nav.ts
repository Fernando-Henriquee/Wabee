import {
  Boxes,
  ClipboardCheck,
  Factory,
  House,
  type LucideIcon,
  Package,
  Printer,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import type { Capability } from '@/features/member/member-context';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Exige a capacidade (perfil) para aparecer. */
  capability?: Capability;
}

/** Menu lateral (US-0.7). */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Visão geral', icon: House, end: true },
  { to: '/estoque', label: 'Estoque', icon: Boxes },
  { to: '/produtos', label: 'Produtos', icon: Package },
  { to: '/producao', label: 'Produção', icon: Factory, capability: 'production' },
  { to: '/vendas', label: 'Vendas', icon: ShoppingBag, capability: 'costs' },
  { to: '/compras', label: 'Compras', icon: ShoppingCart, capability: 'costs' },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet, capability: 'costs' },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

/** Barra inferior no celular (o botão central "+" abre os atalhos). */
export const MOBILE_PRIMARY = ['/', '/producao', '/vendas', '/estoque'];

export interface QuickAction {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  capability: Capability;
}

/** Atalhos do botão "+" (US-0.7). */
export const QUICK_ACTIONS: QuickAction[] = [
  { to: '/producao/impressoes/nova', label: 'Nova impressão', description: 'Planejar uma mesa', icon: Printer, capability: 'production' },
  { to: '/producao?status=IMPRIMINDO', label: 'Finalizar impressão', description: 'Tempo, gramas, boas e falhas', icon: ClipboardCheck, capability: 'production' },
  { to: '/vendas/rapida', label: 'Nova venda', description: 'Pronta entrega em poucos toques', icon: ShoppingBag, capability: 'write' },
  { to: '/compras/nova', label: 'Nova compra', description: 'Filamento, componentes, equipamento', icon: ShoppingCart, capability: 'write' },
  { to: '/estoque/ajuste', label: 'Ajuste de estoque', description: 'Contagem, pesagem, perda', icon: Boxes, capability: 'write' },
  { to: '/financeiro/pagar', label: 'Pagar parcela', description: 'Contas a pagar', icon: Receipt, capability: 'write' },
];
