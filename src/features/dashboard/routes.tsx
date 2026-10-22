import { lazy } from 'react';
import { Route } from 'react-router';
import { ComingSoon } from '@/components/layout/coming-soon';

const DashboardPage = lazy(() => import('./dashboard-page').then((m) => ({ default: m.DashboardPage })));

export function dashboardRoutes() {
  return (
    <>
      <Route index element={<DashboardPage />} />
      <Route path="/inicio/assistente" element={<ComingSoon title="Configuração inicial" />} />
    </>
  );
}
