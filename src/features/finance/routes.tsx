import { lazy } from 'react';
import { Route } from 'react-router';
import { RequireCosts } from './require-costs';

const FinancePage = lazy(() => import('./finance-page').then((m) => ({ default: m.FinancePage })));
const InstallmentsPage = lazy(() => import('./installments-page').then((m) => ({ default: m.InstallmentsPage })));
const ExpensesPage = lazy(() => import('./expenses-page').then((m) => ({ default: m.ExpensesPage })));
const AccountsPage = lazy(() => import('./accounts-page').then((m) => ({ default: m.AccountsPage })));
const AccountDetailPage = lazy(() => import('./account-detail-page').then((m) => ({ default: m.AccountDetailPage })));
const CategoriesPage = lazy(() => import('./categories-page').then((m) => ({ default: m.CategoriesPage })));
const OwnerPage = lazy(() => import('./owner-page').then((m) => ({ default: m.OwnerPage })));
const CashPage = lazy(() => import('./cash-page').then((m) => ({ default: m.CashPage })));
const IncomeStatementPage = lazy(() => import('./income-statement-page').then((m) => ({ default: m.IncomeStatementPage })));
const MonthClosePage = lazy(() => import('./month-close-page').then((m) => ({ default: m.MonthClosePage })));

/** Rotas do financeiro (Módulo 7). */
export function financeRoutes() {
  return (
    <>
      <Route path="/financeiro" element={<RequireCosts><FinancePage /></RequireCosts>} />
      <Route path="/financeiro/pagar" element={<RequireCosts><InstallmentsPage kind="PAGAR" /></RequireCosts>} />
      <Route path="/financeiro/receber" element={<RequireCosts><InstallmentsPage kind="RECEBER" /></RequireCosts>} />
      <Route path="/financeiro/despesas" element={<RequireCosts><ExpensesPage /></RequireCosts>} />
      <Route path="/financeiro/contas" element={<RequireCosts><AccountsPage /></RequireCosts>} />
      <Route path="/financeiro/contas/:id" element={<RequireCosts><AccountDetailPage /></RequireCosts>} />
      <Route path="/financeiro/categorias" element={<RequireCosts><CategoriesPage /></RequireCosts>} />
      <Route path="/financeiro/dono" element={<RequireCosts><OwnerPage /></RequireCosts>} />
      <Route path="/financeiro/caixa" element={<RequireCosts><CashPage /></RequireCosts>} />
      <Route path="/financeiro/dre" element={<RequireCosts><IncomeStatementPage /></RequireCosts>} />
      <Route path="/financeiro/fechamento" element={<RequireCosts><MonthClosePage /></RequireCosts>} />
    </>
  );
}
