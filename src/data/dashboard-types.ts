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
