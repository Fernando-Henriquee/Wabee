/** Tipos dos dados da Visão geral (sem dependências, usados também nos testes de banco). */

export interface MarginBlock {
  net_revenue: number;
  cmv_material: number;
  cmv_operational: number;
  cmv_labor: number;
  selling_expenses: number;
  direct: number;
  operational: number;
  full: number;
  direct_pct: number | null;
  operational_pct: number | null;
  full_pct: number | null;
}

export interface OwnerInvestment {
  invested: number;
  withdrawn: number;
  net_investment: number;
  by_kind: Record<string, number>;
  loan_balance: number;
  pending_reimbursements: number;
  owner_committed_total: number;
  owner_paid_total: number;
  owner_future_installments: Array<{ month: string; amount: number }>;
  accumulated_return: number;
  recovered_pct: number | null;
  remaining_to_recover: number;
  avg_result_3m: number | null;
  months_to_recover: number | null;
}

export interface Overview {
  period: { from: string; to: string; previous_from: string; previous_to: string; days: number };
  cash_available: number;
  payable_30d: { company: number; owner: number; overdue: number };
  receivable: { open: number; overdue: number; count: number };
  sales: { current: number; previous: number; orders: number };
  margin: MarginBlock;
  margin_previous: MarginBlock;
  finished_stock: { units: number; cost: number; sale_value: number };
  potential: {
    units: number;
    potential_revenue: number;
    stock_cost: number;
    est_fees: number;
    est_packaging: number;
    est_taxes: number;
    potential_margin: number;
    variants_without_price: number;
  };
  investment: OwnerInvestment;
  flags: { combined_rate_period: boolean; missing_rates: boolean; labor_not_valued: boolean; reference_cost_items: number };
}

export interface ValueStage {
  pieces: number;
  cost: number;
  sale_value: number;
  orders?: number;
  potential_margin?: number;
  stale_30d?: number;
}

export interface ValuePath {
  production: ValueStage;
  stock: ValueStage;
  reserved: ValueStage;
  to_receive: ValueStage;
  received: ValueStage;
}

export interface DashboardAlert {
  kind: string;
  severity: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
  href?: string;
  ref_id?: number;
  suggested_qty?: number;
}

export interface NowPrinting {
  printing: Array<{ id: number; code: string; equipment_name: string; started_at: string; expected_end: string; outputs_summary: string }>;
  queue: Array<{ id: number; code: string; equipment_name: string; planned_for: string; est_minutes: number; outputs_summary: string }>;
  finishing: number;
}

export interface SalesBucket {
  bucket: string;
  net_revenue: number;
  cmv_material: number;
  cmv_energy: number;
  cmv_depreciation: number;
  cmv_operational: number;
  cmv_labor: number;
  selling: number;
  margin_direct: number;
  margin_operational: number;
  margin_full: number;
}

export interface CashProjection {
  months: Array<{ month: string; opening: number; inflows: number; outflows: number; closing: number; owner_paid: number }>;
  first_negative_month: string | null;
  current_balance: number;
}

export interface TopProduct {
  variant_id: number;
  name: string;
  units: number;
  revenue: number;
  cogs: number;
  margin: number;
  hours_per_unit: number | null;
  mhm: number | null;
}

export type GoalExpenseSource = 'MANUAL' | 'MEDIA_3M' | 'MES' | 'NENHUMA';

/** Meta do mês: quanto faturar para pagar as despesas fixas (e o lucro desejado). */
export interface MonthlyGoal {
  month: string;
  layer: 'direct' | 'operational' | 'full';
  days: number;
  days_elapsed: number;
  days_left: number;
  expenses: {
    basis: number;
    source: GoalExpenseSource;
    month: number;
    das_pending: number;
    avg_3m: number | null;
    avg_months: number;
    manual: number | null;
    categories: Array<{ code: string; name: string; month: number; avg_3m: number | null }>;
  };
  margin_pct: number | null;
  margin_source: 'REALIZADA_90D' | 'ALVO';
  profit_target: number;
  breakeven_revenue: number | null;
  target_revenue: number | null;
  revenue: number;
  margin: number;
  result: number;
  remaining: number | null;
  per_day: number | null;
  projection: number | null;
  avg_ticket: number | null;
  orders_needed: number | null;
}

/** Números de um período (comparação lado a lado e resumo da semana). */
export interface PeriodMetrics {
  from: string;
  to: string;
  net_revenue: number;
  margin_direct: number;
  margin_operational: number;
  margin_full: number;
  margin_operational_pct: number | null;
  orders: number;
  units: number;
  avg_ticket: number | null;
  custom_revenue: number;
  fixed_expenses: number;
  result: number;
  machine_hours: number;
  pieces_produced: number;
  failed_jobs: number;
  new_customers: number;
}

export interface WeeklySummary {
  current: PeriodMetrics;
  previous: PeriodMetrics;
  best_product: { name: string; units: number; revenue: number } | null;
  best_channel: { name: string; revenue: number } | null;
}

export interface MixSplit {
  revenue: number;
  margin: number;
  units: number;
  orders: number;
}

export interface ProductMix {
  products: Array<{ variant_id: number; name: string; is_custom: boolean; units: number; revenue: number; margin: number; share: number | null; abc: 'A' | 'B' | 'C' }>;
  split: { custom: MixSplit; catalog: MixSplit };
  colors: Array<{ color_name: string; color_hex: string; material: string; grams: number; units: number }>;
}

export interface DeliveryStats {
  kinds: Partial<Record<'PRONTA_ENTREGA' | 'ENCOMENDA', { orders: number; avg_days: number | null; on_time: number; with_due: number }>>;
  late: Array<{ id: number; number: string; customer: string | null; days_late: number }>;
}

export interface BacklogOrder {
  id: number;
  number: string;
  kind: 'PRONTA_ENTREGA' | 'ENCOMENDA';
  status: string;
  customer: string | null;
  due_date: string | null;
  total: number;
  received: number;
  to_receive: number;
  hours: number;
  cumulative_hours: number;
  hours_until_due: number | null;
  at_risk: boolean;
}

export interface OrderBacklog {
  days: number;
  printers: number;
  hours_per_day: number;
  capacity_hours: number;
  demand_hours: number;
  stock_job_hours: number;
  summary: { orders: number; value: number; received: number; to_receive: number; order_hours: number; at_risk: number };
  list: BacklogOrder[];
}

export interface OwnerWithdrawal {
  cash: number;
  payables_30d: number;
  reserve: number;
  reserve_months: number;
  cash_room: number;
  previous_month: string;
  previous_result: number;
  month_result: number;
  suggested: number;
}
