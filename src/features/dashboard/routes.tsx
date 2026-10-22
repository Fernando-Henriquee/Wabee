import { lazy } from 'react';
import { Route } from 'react-router';

const DashboardPage = lazy(() => import('./dashboard-page').then((m) => ({ default: m.DashboardPage })));
const OnboardingPage = lazy(() => import('@/features/onboarding/onboarding-page').then((m) => ({ default: m.OnboardingPage })));

export function dashboardRoutes() {
  return (
    <>
      <Route index element={<DashboardPage />} />
      <Route path="/inicio/assistente" element={<OnboardingPage />} />
    </>
  );
}
