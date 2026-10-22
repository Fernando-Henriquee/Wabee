import { rpc } from './api';
import { useAppQuery } from './hooks';

/** Dados da Visão geral (seção 14). Tudo é calculado no banco. */

export type * from './dashboard-types';
import type { CashProjection, DashboardAlert, NowPrinting, OwnerInvestment, Overview, SalesBucket, TopProduct, ValuePath } from './dashboard-types';

export function useOverview(from: string, to: string, enabled = true) {
  return useAppQuery(['dashboard', 'overview', from, to], () => rpc<Overview>('dashboard_overview', { p_from: from, p_to: to }), { enabled });
}

export function useValuePath(from: string, to: string, enabled = true) {
  return useAppQuery(['dashboard', 'value-path', from, to], () => rpc<ValuePath>('value_path', { p_from: from, p_to: to }), { enabled });
}

export function useAlerts() {
  return useAppQuery(['dashboard', 'alerts'], () => rpc<DashboardAlert[]>('dashboard_alerts'));
}

export function useNowPrinting() {
  return useAppQuery(['dashboard', 'now-printing'], () => rpc<NowPrinting>('now_printing'), { refetchInterval: 60_000 });
}

export function useSalesSeries(from: string, to: string, grain: 'day' | 'week' | 'month', enabled = true) {
  return useAppQuery(['dashboard', 'sales-series', from, to, grain], () => rpc<SalesBucket[]>('sales_series', { p_from: from, p_to: to, p_grain: grain }), { enabled });
}

export function useCashProjection(months = 12, enabled = true) {
  return useAppQuery(['dashboard', 'cash-projection', months], () => rpc<CashProjection>('cash_projection', { p_months: months }), { enabled });
}

export function useTopProducts(from: string, to: string, enabled = true) {
  return useAppQuery(['dashboard', 'top-products', from, to], () => rpc<TopProduct[]>('top_products', { p_from: from, p_to: to, p_limit: 5 }), { enabled });
}

export function useOwnerInvestment(enabled = true) {
  return useAppQuery(['dashboard', 'owner-investment'], () => rpc<OwnerInvestment>('owner_investment'), { enabled });
}
