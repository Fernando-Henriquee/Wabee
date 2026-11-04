import { lazy } from 'react';
import { Route } from 'react-router';

const PersonalShell = lazy(() => import('./shell').then((m) => ({ default: m.PersonalShell })));
const TodayPage = lazy(() => import('./today-page').then((m) => ({ default: m.TodayPage })));
const CalendarPage = lazy(() => import('./calendar-page').then((m) => ({ default: m.CalendarPage })));
const TransactionsPage = lazy(() => import('./transactions-page').then((m) => ({ default: m.TransactionsPage })));
const PlansPage = lazy(() => import('./plans-page').then((m) => ({ default: m.PlansPage })));
const PlanDetailPage = lazy(() => import('./plan-detail-page').then((m) => ({ default: m.PlanDetailPage })));
const PersonalSettingsPage = lazy(() => import('./settings-page').then((m) => ({ default: m.PersonalSettingsPage })));

/** Finanças pessoais: uma entrada no menu, com abas internas e dados separados da empresa. */
export function personalRoutes() {
  return (
    <Route path="/pessoal" element={<PersonalShell />}>
      <Route index element={<TodayPage />} />
      <Route path="calendario" element={<CalendarPage />} />
      <Route path="lancamentos" element={<TransactionsPage />} />
      <Route path="parcelas" element={<PlansPage />} />
      <Route path="parcelas/:id" element={<PlanDetailPage />} />
      <Route path="ajustes" element={<PersonalSettingsPage />} />
    </Route>
  );
}
