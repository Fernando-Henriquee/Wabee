import { rpc } from './api';
import { useAppQuery } from './hooks';

/** Dados da Visão geral (seção 14). Tudo é calculado no banco. */

export type * from './dashboard-types';
import type {
  CashProjection,
  DashboardAlert,
  DeliveryStats,
  MonthlyGoal,
  NowPrinting,
  OrderBacklog,
  OwnerInvestment,
  OwnerWithdrawal,
  Overview,
  PeriodMetrics,
  ProductMix,
  StockValue,
  SalesBucket,
  TopProduct,
  ValuePath,
  WeeklySummary,
} from './dashboard-types';

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

export function useMonthlyGoal(layer: 'direct' | 'operational' | 'full', enabled = true) {
  return useAppQuery(['dashboard', 'monthly-goal', layer], () => rpc<MonthlyGoal>('monthly_goal', { p_layer: layer }), { enabled });
}

export function useInsights(enabled = true) {
  return useAppQuery(['dashboard', 'insights'], () => rpc<DashboardAlert[]>('dashboard_insights'), { enabled });
}

export function useWeeklySummary(enabled = true) {
  return useAppQuery(['dashboard', 'weekly-summary'], () => rpc<WeeklySummary>('weekly_summary'), { enabled });
}

export function usePeriodCompare(a: { from: string; to: string }, b: { from: string; to: string }, enabled = true) {
  return useAppQuery(['dashboard', 'compare', a.from, a.to, b.from, b.to], () =>
    rpc<{ a: PeriodMetrics; b: PeriodMetrics }>('period_compare', { p_a_from: a.from, p_a_to: a.to, p_b_from: b.from, p_b_to: b.to }), { enabled });
}

export function useProductMix(from: string, to: string, enabled = true) {
  return useAppQuery(['dashboard', 'product-mix', from, to], () => rpc<ProductMix>('product_mix', { p_from: from, p_to: to }), { enabled });
}

export function useDeliveryStats(from: string, to: string, enabled = true) {
  return useAppQuery(['dashboard', 'delivery-stats', from, to], () => rpc<DeliveryStats>('delivery_stats', { p_from: from, p_to: to }), { enabled });
}

export function useOrderBacklog(days = 14, enabled = true) {
  return useAppQuery(['dashboard', 'order-backlog', days], () => rpc<OrderBacklog>('order_backlog', { p_days: days }), { enabled });
}

export function useOwnerWithdrawal(enabled = true) {
  return useAppQuery(['dashboard', 'owner-withdrawal'], () => rpc<OwnerWithdrawal>('owner_withdrawal'), { enabled });
}

export function useStockValue(enabled = true) {
  return useAppQuery(['dashboard', 'stock-value'], () => rpc<StockValue>('stock_value'), { enabled });
}
