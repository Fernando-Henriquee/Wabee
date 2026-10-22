import { Route, Routes } from 'react-router';
import { dashboardRoutes } from '@/features/dashboard/routes';
import { financeRoutes } from '@/features/finance/routes';
import { inventoryRoutes } from '@/features/inventory/routes';
import { productionRoutes } from '@/features/production/routes';
import { productsRoutes } from '@/features/products/routes';
import { purchasingRoutes } from '@/features/purchasing/routes';
import { salesRoutes } from '@/features/sales/routes';
import { settingsRoutes } from '@/features/settings/routes';
import { NotFoundPage } from './screens';

/**
 * Cada módulo expõe suas rotas em src/features/<módulo>/routes.tsx (páginas
 * carregadas sob demanda). A proteção real dos dados está no banco (RLS e RPCs).
 */
export function AppRoutes() {
  return (
    <Routes>
      {dashboardRoutes()}
      {inventoryRoutes()}
      {productsRoutes()}
      {productionRoutes()}
      {salesRoutes()}
      {purchasingRoutes()}
      {financeRoutes()}
      {settingsRoutes()}
      <Route path="/entrar" element={<NotFoundRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function NotFoundRedirect() {
  // Depois do login, /entrar volta para a visão geral.
  window.history.replaceState(null, '', '/');
  return null;
}
