import { lazy } from 'react';
import { Route } from 'react-router';

const PurchaseListPage = lazy(() => import('./purchase-list-page').then((m) => ({ default: m.PurchaseListPage })));
const PurchaseFormPage = lazy(() => import('./purchase-form-page').then((m) => ({ default: m.PurchaseFormPage })));
const PurchaseDetailPage = lazy(() => import('./purchase-detail-page').then((m) => ({ default: m.PurchaseDetailPage })));
const SupplierListPage = lazy(() => import('./supplier-list-page').then((m) => ({ default: m.SupplierListPage })));
const SupplierDetailPage = lazy(() => import('./supplier-detail-page').then((m) => ({ default: m.SupplierDetailPage })));

/** Rotas de compras e fornecedores (Módulo 3). */
export function purchasingRoutes() {
  return (
    <>
      <Route path="/compras" element={<PurchaseListPage />} />
      <Route path="/compras/nova" element={<PurchaseFormPage />} />
      <Route path="/compras/:id" element={<PurchaseDetailPage />} />
      <Route path="/compras/:id/editar" element={<PurchaseFormPage />} />
      <Route path="/fornecedores" element={<SupplierListPage />} />
      <Route path="/fornecedores/:id" element={<SupplierDetailPage />} />
    </>
  );
}
