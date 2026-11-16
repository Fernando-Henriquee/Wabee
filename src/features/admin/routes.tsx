import { lazy } from 'react';
import { Route } from 'react-router';

const AccountsPage = lazy(() => import('./accounts-page').then((m) => ({ default: m.AccountsPage })));

/** Administração da plataforma (aprovar cadastros novos). A página confere se a conta é administradora. */
export function adminRoutes() {
  return <Route path="/admin/cadastros" element={<AccountsPage />} />;
}
