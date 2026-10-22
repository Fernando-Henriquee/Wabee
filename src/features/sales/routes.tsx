import { lazy } from 'react';
import { Route } from 'react-router';

const OrdersPage = lazy(() => import('./orders-page').then((m) => ({ default: m.OrdersPage })));
const QuickSalePage = lazy(() => import('./quick-sale-page').then((m) => ({ default: m.QuickSalePage })));
const OrderFormPage = lazy(() => import('./order-form-page').then((m) => ({ default: m.OrderFormPage })));
const HistoricalSalePage = lazy(() => import('./historical-sale-page').then((m) => ({ default: m.HistoricalSalePage })));
const OrderDetailPage = lazy(() => import('./order-detail-page').then((m) => ({ default: m.OrderDetailPage })));
const CustomersPage = lazy(() => import('./customers-page').then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = lazy(() => import('./customer-detail-page').then((m) => ({ default: m.CustomerDetailPage })));

/** Rotas de vendas e clientes (Módulo 6). */
export function salesRoutes() {
  return (
    <>
      <Route path="/vendas" element={<OrdersPage />} />
      <Route path="/vendas/rapida" element={<QuickSalePage />} />
      <Route path="/vendas/nova" element={<OrderFormPage />} />
      <Route path="/vendas/historica" element={<HistoricalSalePage />} />
      <Route path="/vendas/:id" element={<OrderDetailPage />} />
      <Route path="/vendas/:id/editar" element={<OrderFormPage />} />
      <Route path="/clientes" element={<CustomersPage />} />
      <Route path="/clientes/:id" element={<CustomerDetailPage />} />
    </>
  );
}
