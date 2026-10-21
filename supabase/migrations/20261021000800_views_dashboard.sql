-- =============================================================================
-- Wabee — 0800 Views de leitura, Visão geral, DRE, fluxo de caixa e fechamento
-- (Módulos 7 e 8, seções 13 e 14)
--
-- O dashboard não grava nada: só lê os dados que os outros módulos produziram,
-- com agregação no banco (seção 14.7). Views com "(definer)" usam os privilégios
-- do dono das tabelas, filtram por private.is_member() e escondem valores do
-- perfil Produção (US-0.3); as demais respeitam a RLS de quem consulta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Estoque (definer): posição, carretéis e extrato
-- -----------------------------------------------------------------------------

create view public.v_items as
with consumption as (
  select m.item_id, sum(-m.qty) / 30.0 as daily
  from public.stock_movements m
  where m.qty < 0 and m.type not in ('ADJUSTMENT_OUT', 'REVERSAL') and m.occurred_at >= now() - interval '30 days'
  group by m.item_id
),
lots as (
  select l.item_id,
         count(*) filter (where l.status = 'ABERTO' and l.qty_remaining > 0) as open_lots,
         count(*) filter (where l.status = 'FECHADO' and l.qty_remaining > 0) as closed_lots,
         bool_or(l.reference_cost and l.qty_remaining > 0) as reference_cost,
         min(l.qty_remaining) filter (where l.status = 'ABERTO' and l.qty_remaining > 0) as open_lot_remaining
  from public.stock_lots l group by l.item_id
)
select
  i.id, i.sku, i.name, i.kind, i.unit, i.is_stock_tracked, i.is_sellable, i.min_qty, i.reorder_qty, i.location,
  i.default_supplier_id, s.name as default_supplier_name, i.photo_path, i.notes, i.active, i.created_at,
  f.material, f.brand, f.color_name, f.color_hex, f.diameter_mm, f.density_g_cm3, f.nominal_spool_g, f.empty_spool_tare_g, f.needs_drying,
  t.condition as tool_condition, t.acquired_at as tool_acquired_at,
  case when private.can_view_costs() then t.acquisition_value end as tool_acquisition_value,
  v.id as variant_id, v.product_id, p.name as product_name, v.name as variant_name,
  coalesce(b.qty_on_hand, 0) as qty_on_hand,
  coalesce(b.qty_reserved, 0) as qty_reserved,
  coalesce(b.qty_on_hand, 0) - coalesce(b.qty_reserved, 0) as qty_available,
  coalesce(l.open_lots, 0)::integer as open_lots,
  coalesce(l.closed_lots, 0)::integer as closed_lots,
  l.open_lot_remaining,
  coalesce(l.reference_cost, false) as reference_cost,
  round(c.daily, 3) as daily_consumption,
  case when c.daily > 0 then round(coalesce(b.qty_on_hand, 0) / c.daily, 1) end as coverage_days,
  (i.is_stock_tracked and i.kind <> 'FINISHED_GOOD' and (
     (i.min_qty > 0 and coalesce(b.qty_on_hand, 0) < i.min_qty)
     or (c.daily > 0 and coalesce(b.qty_on_hand, 0) / c.daily < (select st.coverage_alert_days from public.settings st where st.id))
  )) as below_minimum,
  b.last_movement_at,
  case when private.can_view_costs() then b.avg_cost_material end as avg_cost_material,
  case when private.can_view_costs() then b.avg_cost_energy end as avg_cost_energy,
  case when private.can_view_costs() then b.avg_cost_depreciation end as avg_cost_depreciation,
  case when private.can_view_costs() then b.avg_cost_operational end as avg_cost_operational,
  case when private.can_view_costs() then b.avg_cost_labor end as avg_cost_labor,
  case when private.can_view_costs() then b.avg_cost_total end as avg_cost_total,
  case when private.can_view_costs() then case when i.kind = 'TOOL' then 0 else b.value_total end end as value_total,
  case when private.can_view_costs() then v.reference_price end as reference_price
from public.items i
left join public.stock_balances b on b.item_id = i.id
left join public.filament_specs f on f.item_id = i.id
left join public.tool_specs t on t.item_id = i.id
left join public.suppliers s on s.id = i.default_supplier_id
left join public.product_variants v on v.item_id = i.id
left join public.products p on p.id = v.product_id
left join lots l on l.item_id = i.id
left join consumption c on c.item_id = i.id
where private.is_member();

create view public.v_stock_lots as
select
  l.id, l.item_id, i.sku, i.name as item_name, f.color_hex, f.material, l.lot_code, l.received_at, l.qty_initial, l.qty_remaining,
  case when l.qty_initial > 0 then round(l.qty_remaining / l.qty_initial, 4) end as remaining_pct,
  l.status, l.opened_at, l.finished_at, l.reference_cost, l.source_type, l.source_id,
  case when private.can_view_costs() then l.unit_cost_in end as unit_cost_in
from public.stock_lots l
join public.items i on i.id = l.item_id
left join public.filament_specs f on f.item_id = l.item_id
where private.is_member();

create view public.v_stock_movements as
select
  m.id, m.item_id, i.sku, i.name as item_name, i.kind as item_kind, i.unit, m.lot_id, l.lot_code, m.occurred_at, m.type, m.qty,
  m.qty_after, m.source_type, m.source_id, m.operation_id, m.reason, m.reverses_id,
  exists (select 1 from public.stock_movements r where r.reverses_id = m.id) as is_reversed,
  m.source_type in ('stock_opening', 'stock_issue', 'stock_adjustment', 'lot_discard') as is_standalone,
  case m.source_type
    when 'purchase' then (select c.number from public.purchases c where c.id = m.source_id)
    when 'print_job' then (select j.code from public.print_jobs j where j.id = m.source_id)
    when 'print_job_output' then (select j.code from public.print_job_outputs o join public.print_jobs j on j.id = o.print_job_id where o.id = m.source_id)
    when 'delivery' then (select o.number from public.deliveries d join public.sales_orders o on o.id = d.order_id where d.id = m.source_id)
    else null end as source_ref,
  case m.source_type
    when 'print_job_output' then (select o.print_job_id from public.print_job_outputs o where o.id = m.source_id)
    when 'delivery' then (select d.order_id from public.deliveries d where d.id = m.source_id)
    else m.source_id end as source_doc_id,
  m.created_by, pr.display_name as created_by_name, m.created_at,
  case when private.can_view_costs() then m.unit_cost_material end as unit_cost_material,
  case when private.can_view_costs() then m.unit_cost_energy + m.unit_cost_depreciation + m.unit_cost_operational end as unit_cost_operational_group,
  case when private.can_view_costs() then m.unit_cost_labor end as unit_cost_labor,
  case when private.can_view_costs() then m.unit_cost_total end as unit_cost_total,
  case when private.can_view_costs() then m.total_cost end as total_cost,
  case when private.can_view_costs() then m.avg_cost_after end as avg_cost_after
from public.stock_movements m
join public.items i on i.id = m.item_id
left join public.stock_lots l on l.id = m.lot_id
left join public.profiles pr on pr.id = m.created_by
where private.is_member();

-- Saldo de um item numa data, recalculado pelo razão (RN-30, relatório 14.6).
create function public.stock_position_at(p_at timestamptz)
returns table (item_id bigint, sku text, name text, kind text, unit text, qty numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_role(array['dono', 'producao', 'leitura']);
  return query
    select i.id, i.sku, i.name, i.kind, i.unit, coalesce(sum(m.qty), 0)
    from public.items i
    left join public.stock_movements m on m.item_id = i.id and m.occurred_at <= p_at
    where i.is_stock_tracked
    group by i.id
    order by i.kind, i.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Produtos, fichas e equipamentos (definer)
-- -----------------------------------------------------------------------------

create view public.v_product_variants as
select
  v.id, v.product_id, p.name as product_name, p.category, p.slug, p.photo_path, p.model_source, p.license_notes,
  p.license_allows_commercial, p.is_custom, p.active as product_active,
  v.sku, v.name, p.name || ' — ' || v.name as full_name, v.item_id, v.is_hidden, v.active,
  b.id as active_bom_id, b.version as active_bom_version, b.units_per_plate, b.est_print_minutes_per_plate,
  b.est_post_process_minutes_per_unit,
  (select d.id from public.bom_versions d where d.variant_id = v.id and d.status = 'RASCUNHO') as draft_bom_id,
  coalesce(sb.qty_on_hand, 0) as qty_on_hand,
  coalesce(sb.qty_reserved, 0) as qty_reserved,
  coalesce(sb.qty_on_hand, 0) - coalesce(sb.qty_reserved, 0) as qty_available,
  (select coalesce(sum(o.qty_good), 0) from public.print_job_outputs o where o.variant_id = v.id and o.status = 'AGUARDANDO_ACABAMENTO') as qty_in_finishing,
  case when private.can_view_costs() then v.reference_price end as reference_price,
  case when private.can_view_costs() then sb.avg_cost_total end as avg_cost_total,
  case when private.can_view_costs() then sb.value_total end as value_total
from public.product_variants v
join public.products p on p.id = v.product_id
left join public.bom_versions b on b.variant_id = v.id and b.status = 'ATIVA'
left join public.stock_balances sb on sb.item_id = v.item_id
where private.is_member();

create view public.v_bom_versions as
select
  b.id, b.variant_id, b.version, b.status, b.units_per_plate, b.est_print_minutes_per_plate, b.est_post_process_minutes_per_unit,
  b.default_equipment_id, e.name as default_equipment_name, b.slicer_import_id, b.notes, b.activated_at, b.created_at,
  round(b.est_print_minutes_per_plate::numeric / b.units_per_plate, 3) as machine_minutes_per_unit,
  private.bom_grams_per_unit(b.id) as grams_per_unit
from public.bom_versions b
left join public.equipment e on e.id = b.default_equipment_id
where private.is_member();

create view public.v_bom_lines as
select
  l.id, l.bom_version_id, l.item_id, i.sku, i.name as item_name, i.kind as item_kind, i.unit, f.color_hex,
  l.line_kind, l.qty_per_unit, l.waste_pct, l.consumed_at, l.sort_order,
  case when private.can_view_costs() then sb.avg_cost_total end as avg_cost_total
from public.bom_lines l
join public.items i on i.id = l.item_id
left join public.filament_specs f on f.item_id = l.item_id
left join public.stock_balances sb on sb.item_id = l.item_id
where private.is_member();

create view public.v_equipment as
with usage as (
  select j.equipment_id,
         sum(j.actual_minutes) / 60.0 as hours,
         sum(j.actual_minutes / 60.0 * j.rate_depreciation_h) as depreciation,
         sum(j.actual_minutes) filter (where j.finished_at >= date_trunc('month', now())) / 60.0 as hours_month
  from public.print_jobs j where j.status in ('CONCLUIDA', 'FALHOU') group by j.equipment_id
),
maint as (
  select m.equipment_id, max(m.hours_at) as last_hours, max(m.performed_at) as last_date
  from public.maintenance_logs m group by m.equipment_id
)
select
  e.id, e.name, e.kind, e.brand, e.model, e.serial, e.acquired_at, e.useful_life_hours, e.avg_power_w, e.initial_hours,
  e.maintenance_interval_hours, e.status, e.notes, e.purchase_line_id, e.created_at,
  round(e.initial_hours + coalesce(u.hours, 0), 2) as hours_used,
  round(coalesce(u.hours_month, 0), 2) as hours_this_month,
  round(coalesce(u.hours_month, 0) / greatest(extract(epoch from (now() - date_trunc('month', now()))) / 3600.0, 1), 4) as occupancy_month,
  round(e.initial_hours + coalesce(u.hours, 0) - coalesce(mt.last_hours, 0), 2) as hours_since_maintenance,
  mt.last_date as last_maintenance_at,
  (e.maintenance_interval_hours is not null
    and e.initial_hours + coalesce(u.hours, 0) - coalesce(mt.last_hours, 0) >= 0.9 * e.maintenance_interval_hours) as maintenance_due,
  (e.useful_life_hours is not null and e.initial_hours + coalesce(u.hours, 0) >= e.useful_life_hours) as fully_depreciated,
  (select j.code from public.print_jobs j where j.equipment_id = e.id and j.status = 'IMPRIMINDO') as printing_code,
  case when private.can_view_costs() then e.acquisition_cost end as acquisition_cost,
  case when private.can_view_costs() then e.residual_value end as residual_value,
  case when private.can_view_costs() then round(coalesce(u.depreciation, 0), 2) end as accumulated_depreciation,
  case when private.can_view_costs() then e.acquisition_cost - round(coalesce(u.depreciation, 0), 2) end as book_value
from public.equipment e
left join usage u on u.equipment_id = e.id
left join maint mt on mt.equipment_id = e.id
where private.is_member();

create view public.v_cost_rates with (security_invoker = true) as
select
  r.id, r.rate_type, r.equipment_id, e.name as equipment_name, r.value, r.valid_from, r.valid_to, r.source, r.calc_params, r.notes,
  r.created_at,
  (r.valid_from <= private.today() and (r.valid_to is null or r.valid_to >= private.today())) as is_current,
  (select count(*) from public.print_jobs j where r.id = any (j.rate_ids))::integer as used_by_jobs
from public.cost_rates r
left join public.equipment e on e.id = r.equipment_id;

-- -----------------------------------------------------------------------------
-- Compras e financeiro (respeitam a RLS: dono e leitura)
-- -----------------------------------------------------------------------------

create view public.v_purchases with (security_invoker = true) as
select
  c.id, c.number, c.supplier_id, s.name as supplier_name, c.purchased_at, c.invoice_ref, c.status,
  c.goods_total, c.freight_total, c.discount_total, c.cash_price_total, coalesce(c.installments_total, c.cash_price_total) as total,
  c.interest_total, c.interest_unknown, c.payment_method, c.payment_account_id, a.name as payment_account_name,
  c.payer, c.owner_funding_type, c.installments_count, c.first_due_date, c.is_opening, c.manually_allocated, c.payable_id,
  c.notes, c.confirmed_at, c.canceled_at, c.cancel_reason, c.created_at,
  coalesce(x.paid_count, 0)::integer as installments_paid,
  coalesce(x.total_count, 0)::integer as installments_total_count,
  coalesce(x.paid_by_owner, 0) as paid_by_owner,
  coalesce(x.paid_by_company, 0) as paid_by_company,
  coalesce(x.open_amount, 0) as open_amount,
  x.next_due_date,
  (select string_agg(l.description, ', ' order by l.sort_order) from public.purchase_lines l where l.purchase_id = c.id) as lines_summary
from public.purchases c
left join public.suppliers s on s.id = c.supplier_id
left join public.payment_accounts a on a.id = c.payment_account_id
left join lateral (
  select count(*) filter (where i.status = 'PAGA') as paid_count,
         count(*) filter (where i.status <> 'CANCELADA') as total_count,
         sum(i.paid_amount) filter (where i.status = 'PAGA' and i.payer = 'DONO') as paid_by_owner,
         sum(i.paid_amount) filter (where i.status = 'PAGA' and i.payer = 'EMPRESA') as paid_by_company,
         sum(i.amount) filter (where i.status = 'ABERTA') as open_amount,
         min(i.due_date) filter (where i.status = 'ABERTA') as next_due_date
  from public.installments i where i.payable_id = c.payable_id
) x on true;

create view public.v_purchase_lines with (security_invoker = true) as
select
  l.id, l.purchase_id, l.line_kind, l.item_id, i.sku, i.name as item_name, i.kind as item_kind, i.unit, i.is_stock_tracked,
  f.color_hex, f.nominal_spool_g, l.equipment_id, l.expense_category_id, fc.code as expense_category_code, fc.name as expense_category_name,
  l.description, l.qty, l.unit_price, l.line_total, l.freight_alloc, l.discount_alloc, l.landed_total, l.landed_unit_cost,
  l.qty_received, l.qty - l.qty_received as qty_pending, l.sort_order
from public.purchase_lines l
left join public.items i on i.id = l.item_id
left join public.filament_specs f on f.item_id = l.item_id
left join public.financial_categories fc on fc.id = l.expense_category_id;

create view public.v_payment_accounts with (security_invoker = true) as
select
  a.*,
  case when a.owner = 'EMPRESA' then a.opening_balance + coalesce((
    select sum(case t.direction when 'IN' then t.amount else -t.amount end)
    from public.cash_transactions t where t.account_id = a.id and t.occurred_on >= a.opening_date), 0) end as balance,
  (select max(t.occurred_on) from public.cash_transactions t where t.account_id = a.id) as last_activity_on,
  (select count(*) from public.cash_transactions t where t.account_id = a.id and not t.reconciled)::integer as unreconciled_count
from public.payment_accounts a;

create view public.v_cash_transactions with (security_invoker = true) as
select
  t.id, t.account_id, a.name as account_name, t.occurred_on, t.direction, t.amount,
  case t.direction when 'IN' then t.amount else -t.amount end as signed_amount,
  t.category_id, c.code as category_code, c.name as category_name, t.description, t.installment_id, t.transfer_group,
  t.owner_movement_id, t.reconciled, t.source_type, t.source_id, t.reverses_id,
  exists (select 1 from public.cash_transactions r where r.reverses_id = t.id) as is_reversed, t.created_at
from public.cash_transactions t
join public.payment_accounts a on a.id = t.account_id
join public.financial_categories c on c.id = t.category_id;

create view public.v_owner_movements with (security_invoker = true) as
select
  m.id, m.kind, m.occurred_on, m.amount, m.direction,
  case when m.reverses_id is not null then case m.direction when 'DONO_PARA_EMPRESA' then -m.amount else m.amount end
       when m.direction = 'DONO_PARA_EMPRESA' then m.amount else -m.amount end as invested_delta,
  m.installment_id, m.purchase_id, p.number as purchase_number, m.cash_transaction_id, m.stock_movement_id, m.notes, m.reverses_id,
  exists (select 1 from public.owner_movements r where r.reverses_id = m.id) as is_reversed, m.created_at
from public.owner_movements m
left join public.purchases p on p.id = m.purchase_id;

create view public.v_result_entries with (security_invoker = true) as
select
  e.id, e.occurred_on, e.category_id, c.code as category_code, c.name as category_name, c.nature, e.amount,
  e.source_type, e.source_id, e.description, e.channel_id, e.item_id, e.reverses_id, e.created_at,
  case e.source_type
    when 'purchase' then (select x.number from public.purchases x where x.id = e.source_id)
    when 'print_job' then (select j.code from public.print_jobs j where j.id = e.source_id)
    when 'print_job_output' then (select j.code from public.print_job_outputs o join public.print_jobs j on j.id = o.print_job_id where o.id = e.source_id)
    when 'delivery' then (select o.number from public.deliveries d join public.sales_orders o on o.id = d.order_id where d.id = e.source_id)
    when 'sales_order' then (select o.number from public.sales_orders o where o.id = e.source_id)
    when 'payable' then (select p.number from public.payables p where p.id = e.source_id)
    when 'installment' then (select coalesce(p.number, r.number) from public.installments i left join public.payables p on p.id = i.payable_id
                             left join public.receivables r on r.id = i.receivable_id where i.id = e.source_id)
    when 'installment_payment' then (select coalesce(p.number, r.number) from public.installments i left join public.payables p on p.id = i.payable_id
                             left join public.receivables r on r.id = i.receivable_id where i.id = e.source_id)
    else null end as source_ref
from public.result_entries e
join public.financial_categories c on c.id = e.category_id;

create view public.v_audit_logs with (security_invoker = true) as
select a.id, a.user_id, coalesce(p.display_name, 'Sistema') as user_name, a.action, a.model_label, a.object_id, a.object_ref,
       a.summary, a.changes, a.ip, a.occurred_at
from public.audit_logs a
left join public.profiles p on p.id = a.user_id;

-- Membros (dono vê todos, com e-mail).
create view public.v_members as
select m.user_id, m.role, m.active, m.created_at, p.display_name, u.email
from public.app_members m
left join public.profiles p on p.id = m.user_id
left join auth.users u on u.id = m.user_id
where m.user_id = (select auth.uid()) or private.has_role(array['dono']);

-- -----------------------------------------------------------------------------
-- Indicadores (seção 14). Funções somente leitura para dono e leitura.
-- -----------------------------------------------------------------------------

-- Soma dos lançamentos de resultado por códigos de categoria no período.
create function private.result_sum(p_from date, p_to date, p_codes text[])
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.amount), 0)
  from public.result_entries e join public.financial_categories c on c.id = e.category_id
  where e.occurred_on between p_from and p_to and c.code = any (p_codes);
$$;

-- Margem de contribuição nas três camadas (RN-13 e princípio 14.1.2).
create function private.margin_block(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_net numeric := private.result_sum(p_from, p_to, array['1.1', '1.2', '1.4']);
  v_cmv_material numeric := private.result_sum(p_from, p_to, array['2.1']);
  v_cmv_op numeric := private.result_sum(p_from, p_to, array['2.2', '2.3', '2.4']);
  v_cmv_labor numeric := private.result_sum(p_from, p_to, array['2.5']);
  v_selling numeric := private.result_sum(p_from, p_to, array['3.1', '3.2', '3.3', '3.4', '3.5', '3.7']);
  v_direct numeric;
  v_operational numeric;
  v_full numeric;
begin
  v_direct := v_net + v_cmv_material + v_selling;
  v_operational := v_direct + v_cmv_op;
  v_full := v_operational + v_cmv_labor;
  return jsonb_build_object(
    'net_revenue', v_net,
    'cmv_material', -v_cmv_material, 'cmv_operational', -v_cmv_op, 'cmv_labor', -v_cmv_labor, 'selling_expenses', -v_selling,
    'direct', v_direct, 'operational', v_operational, 'full', v_full,
    'direct_pct', case when v_net <> 0 then round(v_direct / v_net, 4) end,
    'operational_pct', case when v_net <> 0 then round(v_operational / v_net, 4) end,
    'full_pct', case when v_net <> 0 then round(v_full / v_net, 4) end
  );
end;
$$;

-- Saldo de caixa das contas da empresa numa data.
create function private.cash_balance_at(p_on date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(a.opening_balance) filter (where a.opening_date <= p_on), 0)
       + coalesce((select sum(case t.direction when 'IN' then t.amount else -t.amount end)
                   from public.cash_transactions t join public.payment_accounts a2 on a2.id = t.account_id
                   where t.occurred_on <= p_on and t.occurred_on >= a2.opening_date and a2.owner = 'EMPRESA'), 0)
  from public.payment_accounts a where a.owner = 'EMPRESA';
$$;

-- Investimento do dono (RN-19, RN-27).
create function public.owner_investment()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_in numeric;
  v_out numeric;
  v_by_kind jsonb;
  v_loans numeric;
  v_reimb numeric;
  v_future jsonb;
  v_return numeric;
  v_net numeric;
  v_months integer;
  v_avg3 numeric;
  v_today date := private.today();
  v_committed numeric;
  v_paid numeric;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select coalesce(sum(m.invested_delta) filter (where m.invested_delta > 0 and m.reverses_id is null and not m.is_reversed), 0),
         coalesce(-sum(m.invested_delta) filter (where m.invested_delta < 0 and m.reverses_id is null and not m.is_reversed), 0)
    into v_in, v_out
  from public.v_owner_movements m;
  select coalesce(jsonb_object_agg(k.kind, k.total), '{}'::jsonb) into v_by_kind
  from (select m.kind, sum(m.amount) as total from public.v_owner_movements m where m.reverses_id is null and not m.is_reversed group by m.kind) k;
  v_loans := coalesce((v_by_kind ->> 'OWNER_LOAN')::numeric, 0) - coalesce((v_by_kind ->> 'LOAN_REPAYMENT')::numeric, 0);
  v_reimb := coalesce((v_by_kind ->> 'OWNER_PAID_EXPENSE')::numeric, 0) - coalesce((v_by_kind ->> 'OWNER_REIMBURSEMENT')::numeric, 0);
  -- Compromissos futuros em parcelas pagas pelo dono, por mês.
  select coalesce(jsonb_agg(jsonb_build_object('month', x.month, 'amount', x.amount) order by x.month), '[]'::jsonb) into v_future
  from (select date_trunc('month', i.due_date)::date as month, sum(i.amount) as amount
        from public.installments i where i.payable_id is not null and i.status = 'ABERTA' and i.payer = 'DONO'
        group by 1) x;
  select coalesce(sum(i.amount) filter (where i.status <> 'CANCELADA'), 0), coalesce(sum(i.paid_amount) filter (where i.status = 'PAGA'), 0)
    into v_committed, v_paid
  from public.installments i where i.payable_id is not null and i.payer = 'DONO';
  -- Retorno acumulado = resultado operacional acumulado desde o início (RN-27).
  select coalesce(sum(e.amount), 0) into v_return
  from public.result_entries e join public.financial_categories c on c.id = e.category_id
  where c.in_income_statement and c.nature not in ('DESPESA_FINANCEIRA', 'NAO_OPERACIONAL');
  v_net := v_in - v_out;
  -- Previsão só com 3 meses de histórico.
  select count(distinct date_trunc('month', e.occurred_on)) into v_months from public.result_entries e where e.occurred_on <= v_today;
  if v_months >= 3 then
    select avg(x.total) into v_avg3 from (
      select date_trunc('month', e.occurred_on) as m, sum(e.amount) as total
      from public.result_entries e join public.financial_categories c on c.id = e.category_id
      where c.in_income_statement and c.nature not in ('DESPESA_FINANCEIRA', 'NAO_OPERACIONAL')
        and e.occurred_on >= (date_trunc('month', v_today) - interval '3 months') and e.occurred_on < date_trunc('month', v_today)
      group by 1) x;
  end if;
  return jsonb_build_object(
    'invested', v_in, 'withdrawn', v_out, 'net_investment', v_net, 'by_kind', v_by_kind,
    'loan_balance', greatest(v_loans, 0), 'pending_reimbursements', greatest(v_reimb, 0),
    'owner_committed_total', v_committed, 'owner_paid_total', v_paid, 'owner_future_installments', v_future,
    'accumulated_return', v_return,
    'recovered_pct', case when v_net > 0 then round(v_return / v_net, 4) end,
    'remaining_to_recover', greatest(v_net - v_return, 0),
    'avg_result_3m', round(v_avg3, 2),
    'months_to_recover', case when v_avg3 > 0 and v_net > v_return then ceil((v_net - v_return) / v_avg3) end
  );
end;
$$;

-- Receita e margem potencial do saldo livre de produto pronto (RN-14).
create function private.potential_margin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.settings := private.settings();
  v_on date := private.today();
  v_fee public.sales_channel_fees := private.channel_fee_at(v_settings.default_channel_id, v_on);
  v_tax numeric := private.sales_tax_pct();
  v_row record;
  v_revenue numeric := 0;
  v_cost numeric := 0;
  v_fees numeric := 0;
  v_pack numeric := 0;
  v_taxes numeric := 0;
  v_units numeric := 0;
  v_unpriced integer := 0;
  v_price numeric;
  v_packaging numeric;
begin
  for v_row in
    select v.id as variant_id, b.qty_on_hand - b.qty_reserved as free, b.avg_cost_total
    from public.product_variants v join public.stock_balances b on b.item_id = v.item_id
    where b.qty_on_hand - b.qty_reserved > 0
  loop
    v_price := private.reference_price(v_row.variant_id, v_settings.default_channel_id, v_on);
    if v_price is null then
      v_unpriced := v_unpriced + 1;
      continue;
    end if;
    select coalesce(sum(l.qty_per_unit * (1 + l.waste_pct) * (select ic.unit_cost from private.item_estimate_cost(l.item_id) ic)), 0)
      into v_packaging
    from public.bom_versions bv join public.bom_lines l on l.bom_version_id = bv.id
    where bv.variant_id = v_row.variant_id and bv.status = 'ATIVA' and l.consumed_at = 'DELIVERY';
    v_units := v_units + v_row.free;
    v_revenue := v_revenue + v_row.free * v_price;
    v_cost := v_cost + v_row.free * v_row.avg_cost_total;
    v_fees := v_fees + v_row.free * v_price * (coalesce(v_fee.fee_pct, 0) + coalesce(v_fee.payment_fee_pct, 0))
            + case when v_fee.fee_fixed_per = 'UNIDADE' then v_row.free * coalesce(v_fee.fee_fixed, 0) else 0 end;
    v_pack := v_pack + v_row.free * v_packaging;
    v_taxes := v_taxes + v_row.free * v_price * v_tax;
  end loop;
  return jsonb_build_object('units', v_units, 'potential_revenue', round(v_revenue, 2), 'stock_cost', round(v_cost, 2),
    'est_fees', round(v_fees, 2), 'est_packaging', round(v_pack, 2), 'est_taxes', round(v_taxes, 2),
    'potential_margin', round(v_revenue - v_cost - v_fees - v_pack - v_taxes, 2), 'variants_without_price', v_unpriced);
end;
$$;

-- Os 8 indicadores do topo da Visão geral (14.2), com o período anterior equivalente.
create function public.dashboard_overview(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
  v_len integer := p_to - p_from + 1;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_prev_to date := p_from - 1;
  v_pay jsonb;
  v_rec jsonb;
  v_fg jsonb;
  v_flags jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select jsonb_build_object(
           'company', coalesce(sum(i.amount) filter (where i.payer = 'EMPRESA'), 0),
           'owner', coalesce(sum(i.amount) filter (where i.payer = 'DONO'), 0),
           'overdue', coalesce(sum(i.amount) filter (where i.due_date < v_today), 0))
    into v_pay
  from public.installments i where i.payable_id is not null and i.status = 'ABERTA' and i.due_date <= v_today + 30;
  select jsonb_build_object('open', coalesce(sum(i.amount), 0), 'overdue', coalesce(sum(i.amount) filter (where i.due_date < v_today), 0),
                            'count', count(*))
    into v_rec
  from public.installments i where i.receivable_id is not null and i.status = 'ABERTA';
  select jsonb_build_object(
           'units', coalesce(sum(b.qty_on_hand - b.qty_reserved), 0),
           'cost', coalesce(round(sum((b.qty_on_hand - b.qty_reserved) * b.avg_cost_total), 2), 0),
           'sale_value', coalesce(round(sum((b.qty_on_hand - b.qty_reserved)
              * private.reference_price(v.id, (private.settings()).default_channel_id, v_today)), 2), 0))
    into v_fg
  from public.product_variants v join public.stock_balances b on b.item_id = v.item_id
  where b.qty_on_hand - b.qty_reserved > 0;
  select jsonb_build_object(
    'combined_rate_period', exists (select 1 from public.print_jobs j where j.rate_mode = 'COMBINED' and private.local_date(j.finished_at) between p_from and p_to),
    'missing_rates', exists (select 1 from public.print_jobs j where j.missing_rates and private.local_date(j.finished_at) between p_from and p_to),
    'labor_not_valued', private.rate_at('LABOR_PER_HOUR', null, v_today) is null,
    'reference_cost_items', (select count(distinct l.item_id) from public.stock_lots l where l.reference_cost and l.qty_remaining > 0)
  ) into v_flags;
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'previous_from', v_prev_from, 'previous_to', v_prev_to, 'days', v_len),
    'cash_available', private.cash_balance_at(v_today),
    'payable_30d', v_pay,
    'receivable', v_rec,
    'sales', jsonb_build_object('current', private.result_sum(p_from, p_to, array['1.1', '1.2', '1.4']),
                                'previous', private.result_sum(v_prev_from, v_prev_to, array['1.1', '1.2', '1.4']),
                                'orders', (select count(distinct d.order_id) from public.deliveries d where private.local_date(d.delivered_at) between p_from and p_to)),
    'margin', private.margin_block(p_from, p_to),
    'margin_previous', private.margin_block(v_prev_from, v_prev_to),
    'finished_stock', v_fg,
    'potential', private.potential_margin(),
    'investment', public.owner_investment(),
    'flags', v_flags
  );
end;
$$;

-- Caminho do valor (14.3): cada peça aparece em uma única etapa.
create function public.value_path(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_channel bigint := (private.settings()).default_channel_id;
  v_today date := private.today();
  v_production jsonb;
  v_stock jsonb;
  v_reserved jsonb;
  v_to_receive jsonb;
  v_received jsonb;
  v_potential jsonb := private.potential_margin();
  v_stale numeric;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select jsonb_build_object(
    'pieces', coalesce(sum(x.pieces), 0), 'cost', round(coalesce(sum(x.cost), 0), 2), 'sale_value', round(coalesce(sum(x.value), 0), 2))
    into v_production
  from (
    select o.qty_good as pieces, o.good_material + o.good_energy + o.good_depreciation + o.good_operational as cost,
           o.qty_good * coalesce(private.reference_price(o.variant_id, v_channel, v_today), 0) as value
    from public.print_job_outputs o where o.status = 'AGUARDANDO_ACABAMENTO'
    union all
    select o.qty_planned, 0, o.qty_planned * coalesce(private.reference_price(o.variant_id, v_channel, v_today), 0)
    from public.print_job_outputs o join public.print_jobs j on j.id = o.print_job_id where j.status = 'IMPRIMINDO'
  ) x;
  select jsonb_build_object('pieces', coalesce(sum(b.qty_on_hand - b.qty_reserved), 0),
                            'cost', round(coalesce(sum((b.qty_on_hand - b.qty_reserved) * b.avg_cost_total), 0), 2),
                            'sale_value', v_potential -> 'potential_revenue',
                            'potential_margin', v_potential -> 'potential_margin')
    into v_stock
  from public.product_variants v join public.stock_balances b on b.item_id = v.item_id where b.qty_on_hand - b.qty_reserved > 0;
  -- Peças sem saída há mais de 30 dias.
  select coalesce(sum(b.qty_on_hand - b.qty_reserved), 0) into v_stale
  from public.product_variants v join public.stock_balances b on b.item_id = v.item_id
  where b.qty_on_hand - b.qty_reserved > 0
    and not exists (select 1 from public.stock_movements m where m.item_id = v.item_id and m.qty < 0 and m.occurred_at >= now() - interval '30 days')
    and not exists (select 1 from public.stock_movements m where m.item_id = v.item_id and m.qty > 0 and m.occurred_at >= now() - interval '30 days');
  v_stock := v_stock || jsonb_build_object('stale_30d', v_stale);
  -- Reservado (margem comprometida, com o preço dos pedidos).
  select jsonb_build_object('pieces', coalesce(sum(r.qty), 0), 'cost', round(coalesce(sum(r.qty * b.avg_cost_total), 0), 2),
                            'sale_value', round(coalesce(sum(r.qty * (l.unit_price - l.discount / l.qty)), 0), 2))
    into v_reserved
  from public.reservations r join public.sales_order_lines l on l.id = r.order_line_id join public.stock_balances b on b.item_id = r.item_id
  where r.status = 'ATIVA';
  -- Vendido a receber: entregas com parcela a receber aberta.
  select jsonb_build_object('pieces', coalesce(sum(x.units), 0), 'cost', coalesce(sum(x.cogs), 0), 'sale_value', coalesce(sum(x.open_amount), 0), 'orders', count(*))
    into v_to_receive
  from (select o.id, (select sum(l.qty_delivered) from public.sales_order_lines l where l.order_id = o.id) as units, o.cogs_total as cogs,
               (select sum(i.amount) from public.installments i where i.receivable_id = o.receivable_id and i.status = 'ABERTA') as open_amount
        from public.sales_orders o
        where o.status = 'ENTREGUE' and exists (select 1 from public.installments i where i.receivable_id = o.receivable_id and i.status = 'ABERTA')) x;
  -- Recebido no período: entregas totalmente recebidas cujo último recebimento caiu no período.
  select jsonb_build_object('pieces', coalesce(sum(x.units), 0), 'cost', coalesce(sum(x.cogs), 0), 'sale_value', coalesce(sum(x.received), 0), 'orders', count(*))
    into v_received
  from (select o.id, (select sum(l.qty_delivered) from public.sales_order_lines l where l.order_id = o.id) as units, o.cogs_total as cogs,
               (select sum(i.paid_amount) from public.installments i where i.receivable_id = o.receivable_id and i.status = 'PAGA') as received
        from public.sales_orders o
        where o.status = 'ENTREGUE' and o.receivable_id is not null
          and not exists (select 1 from public.installments i where i.receivable_id = o.receivable_id and i.status = 'ABERTA')
          and (select max(i.paid_on) from public.installments i where i.receivable_id = o.receivable_id) between p_from and p_to) x;
  return jsonb_build_object('production', v_production, 'stock', v_stock, 'reserved', v_reserved, 'to_receive', v_to_receive, 'received', v_received);
end;
$$;

-- Alertas da Visão geral (14.4). Produção vê os alertas operacionais.
create function public.dashboard_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
  v_costs boolean := private.can_view_costs();
  v_alerts jsonb := '[]'::jsonb;
  v_row record;
  v_onboarding jsonb := (private.settings()).onboarding_state;
begin
  perform private.assert_role(array['dono', 'producao', 'leitura']);
  if v_costs then
    for v_row in
      select i.id, i.due_date, i.amount, case when i.payable_id is not null then 'pagar' else 'receber' end as kind, v.counterparty_name, v.description
      from public.installments i join public.v_installments v on v.id = i.id
      where i.status = 'ABERTA' and i.due_date <= v_today + 3 order by i.due_date limit 20
    loop
      v_alerts := v_alerts || jsonb_build_object('kind', 'installment', 'severity', case when v_row.due_date < v_today then 'danger' else 'warning' end,
        'title', case when v_row.due_date < v_today then 'Parcela vencida' else 'Parcela vencendo' end || ' (' || v_row.kind || ')',
        'detail', format('%s — %s em %s', coalesce(v_row.counterparty_name, v_row.description), private.fmt_money(v_row.amount), to_char(v_row.due_date, 'DD/MM')),
        'ref_id', v_row.id, 'href', case when v_row.kind = 'pagar' then '/financeiro/pagar' else '/financeiro/receber' end);
    end loop;
    for v_row in
      select o.id, o.number, o.due_date, c.name from public.sales_orders o left join public.customers c on c.id = o.customer_id
      where o.kind = 'ENCOMENDA' and o.status in ('CONFIRMADO', 'EM_PRODUCAO') and o.due_date <= v_today + 3 order by o.due_date
    loop
      v_alerts := v_alerts || jsonb_build_object('kind', 'order_due', 'severity', 'danger', 'title', 'Encomenda sem peças prontas',
        'detail', format('%s%s — prazo %s', v_row.number, coalesce(' (' || v_row.name || ')', ''), to_char(v_row.due_date, 'DD/MM')),
        'ref_id', v_row.id, 'href', '/vendas/' || v_row.id);
    end loop;
  end if;
  for v_row in select i.id, i.name, i.qty_on_hand, i.min_qty, i.coverage_days, i.reorder_qty, i.unit from public.v_items i where i.below_minimum and i.active order by i.coverage_days nulls last limit 20 loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'stock_low', 'severity', 'warning', 'title', 'Estoque baixo',
      'detail', format('%s: %s %s%s', v_row.name, private.fmt_num(v_row.qty_on_hand), lower(v_row.unit),
        case when v_row.coverage_days is not null then format(' (%s dias)', private.fmt_num(v_row.coverage_days, 0)) else '' end),
      'ref_id', v_row.id, 'href', '/estoque/itens/' || v_row.id, 'suggested_qty', v_row.reorder_qty);
  end loop;
  for v_row in
    select l.id, l.lot_code, l.qty_remaining, i.name from public.stock_lots l join public.items i on i.id = l.item_id
    where l.status = 'ABERTO' and l.qty_remaining > 0 and l.qty_remaining < 100
  loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'spool_low', 'severity', 'info', 'title', 'Carretel acabando',
      'detail', format('%s (%s): %s g', v_row.name, v_row.lot_code, private.fmt_num(v_row.qty_remaining)), 'ref_id', v_row.id, 'href', '/estoque/carreteis');
  end loop;
  for v_row in select e.id, e.name, e.hours_since_maintenance, e.maintenance_interval_hours from public.v_equipment e where e.maintenance_due and e.status <> 'BAIXADO' loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'maintenance', 'severity', 'warning', 'title', 'Manutenção próxima',
      'detail', format('%s: %s h desde a última (intervalo %s h)', v_row.name, private.fmt_num(v_row.hours_since_maintenance, 0), v_row.maintenance_interval_hours),
      'ref_id', v_row.id, 'href', '/producao/equipamentos/' || v_row.id);
  end loop;
  for v_row in
    select j.id, j.code, j.started_at, j.est_minutes from public.print_jobs j
    where j.status = 'IMPRIMINDO' and now() > j.started_at + make_interval(mins => j.est_minutes + 30)
  loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'job_overdue', 'severity', 'warning', 'title', 'Impressão passou do tempo',
      'detail', format('%s está imprimindo há %s min (estimado %s min)', v_row.code, round(extract(epoch from (now() - v_row.started_at)) / 60), v_row.est_minutes),
      'ref_id', v_row.id, 'href', '/producao/impressoes/' || v_row.id);
  end loop;
  if v_costs and jsonb_typeof(v_onboarding -> 'skipped') = 'array' and jsonb_array_length(v_onboarding -> 'skipped') > 0 then
    v_alerts := v_alerts || jsonb_build_object('kind', 'onboarding', 'severity', 'info', 'title', 'Configuração inicial pendente',
      'detail', format('%s passo(s) pulado(s) no assistente', jsonb_array_length(v_onboarding -> 'skipped')), 'href', '/inicio/assistente');
  end if;
  if v_costs and (private.settings()).go_live_date < date_trunc('month', v_today)::date
     and not exists (select 1 from public.month_closes c where c.month = (date_trunc('month', v_today) - interval '1 month')::date and c.status = 'FECHADO') then
    v_alerts := v_alerts || jsonb_build_object('kind', 'month_open', 'severity', 'info', 'title', 'Mês anterior não fechado',
      'detail', 'Feche ' || to_char(date_trunc('month', v_today) - interval '1 month', 'MM/YYYY') || ' para travar os números.', 'href', '/financeiro/fechamento');
  end if;
  return v_alerts;
end;
$$;

-- "Agora na impressora": em andamento e fila do dia (14.4).
create function public.now_printing()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_role(array['dono', 'producao', 'leitura']);
  return jsonb_build_object(
    'printing', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'code', j.code, 'equipment_name', j.equipment_name,
        'started_at', j.started_at, 'expected_end', j.expected_end, 'outputs_summary', j.outputs_summary) order by j.started_at), '[]'::jsonb)
      from public.v_print_jobs j where j.status = 'IMPRIMINDO'),
    'queue', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'code', j.code, 'equipment_name', j.equipment_name,
        'planned_for', j.planned_for, 'est_minutes', j.est_minutes, 'outputs_summary', j.outputs_summary) order by j.planned_for), '[]'::jsonb)
      from public.v_print_jobs j where j.status = 'PLANEJADA' and private.local_date(j.planned_for) <= private.today()),
    'finishing', (select coalesce(sum(o.qty_good), 0) from public.print_job_outputs o where o.status = 'AGUARDANDO_ACABAMENTO')
  );
end;
$$;

-- Séries para os gráficos (14.4): vendas × margem e composição do custo das peças vendidas.
create function public.sales_series(p_from date, p_to date, p_grain text default 'week')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_grain text := case when p_grain in ('day', 'week', 'month') then p_grain else 'week' end;
begin
  perform private.assert_role(array['dono', 'leitura']);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'bucket', b.bucket, 'net_revenue', b.net, 'cmv_material', -b.cmv_material, 'cmv_energy', -b.cmv_energy,
      'cmv_depreciation', -b.cmv_depreciation, 'cmv_operational', -b.cmv_operational, 'cmv_labor', -b.cmv_labor,
      'selling', -b.selling,
      'margin_direct', b.net + b.cmv_material + b.selling,
      'margin_operational', b.net + b.cmv_material + b.selling + b.cmv_energy + b.cmv_depreciation + b.cmv_operational,
      'margin_full', b.net + b.cmv_material + b.selling + b.cmv_energy + b.cmv_depreciation + b.cmv_operational + b.cmv_labor
    ) order by b.bucket), '[]'::jsonb)
    from (
      select date_trunc(v_grain, e.occurred_on)::date as bucket,
             coalesce(sum(e.amount) filter (where c.code in ('1.1', '1.2', '1.4')), 0) as net,
             coalesce(sum(e.amount) filter (where c.code = '2.1'), 0) as cmv_material,
             coalesce(sum(e.amount) filter (where c.code = '2.2'), 0) as cmv_energy,
             coalesce(sum(e.amount) filter (where c.code = '2.3'), 0) as cmv_depreciation,
             coalesce(sum(e.amount) filter (where c.code = '2.4'), 0) as cmv_operational,
             coalesce(sum(e.amount) filter (where c.code = '2.5'), 0) as cmv_labor,
             coalesce(sum(e.amount) filter (where c.code in ('3.1', '3.2', '3.3', '3.4', '3.5', '3.7')), 0) as selling
      from public.result_entries e join public.financial_categories c on c.id = e.category_id
      where e.occurred_on between p_from and p_to
      group by 1
    ) b
  );
end;
$$;

-- Caixa projetado (US-7.10, 14.4): saldo atual + recebimentos previstos − pagamentos previstos da empresa.
-- Parcelas pagas pelo dono aparecem numa linha separada, fora do saldo.
create function public.cash_projection(p_months integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
  v_balance numeric := private.cash_balance_at(v_today);
  v_rows jsonb := '[]'::jsonb;
  v_month date := date_trunc('month', v_today)::date;
  v_in numeric;
  v_out numeric;
  v_owner numeric;
  v_overdue_in numeric;
  v_overdue_out numeric;
  v_first_negative date;
begin
  perform private.assert_role(array['dono', 'leitura']);
  -- Vencidos entram no mês atual.
  select coalesce(sum(i.amount) filter (where i.receivable_id is not null), 0),
         coalesce(sum(i.amount) filter (where i.payable_id is not null and i.payer = 'EMPRESA'), 0)
    into v_overdue_in, v_overdue_out
  from public.installments i where i.status = 'ABERTA' and i.due_date < v_today;
  for k in 0..greatest(coalesce(p_months, 12), 1) - 1 loop
    select coalesce(sum(i.amount) filter (where i.receivable_id is not null), 0),
           coalesce(sum(i.amount) filter (where i.payable_id is not null and i.payer = 'EMPRESA'), 0),
           coalesce(sum(i.amount) filter (where i.payable_id is not null and i.payer = 'DONO'), 0)
      into v_in, v_out, v_owner
    from public.installments i
    where i.status = 'ABERTA' and i.due_date >= greatest(v_month, v_today) and i.due_date < (v_month + interval '1 month')::date;
    if k = 0 then
      v_in := v_in + v_overdue_in;
      v_out := v_out + v_overdue_out;
    end if;
    v_rows := v_rows || jsonb_build_object('month', v_month, 'opening', v_balance, 'inflows', v_in, 'outflows', v_out,
                                           'closing', v_balance + v_in - v_out, 'owner_paid', v_owner);
    if v_first_negative is null and v_balance + v_in - v_out < 0 then
      v_first_negative := v_month;
    end if;
    v_balance := v_balance + v_in - v_out;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  return jsonb_build_object('months', v_rows, 'first_negative_month', v_first_negative, 'current_balance', private.cash_balance_at(v_today));
end;
$$;

-- Fluxo de caixa realizado (US-7.10): por dia, semana ou mês, entradas e saídas por categoria.
create function public.cash_flow(p_from date, p_to date, p_grain text default 'month', p_account_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_grain text := case when p_grain in ('day', 'week', 'month') then p_grain else 'month' end;
  v_opening numeric;
  v_buckets jsonb;
  v_categories jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select coalesce(sum(a.opening_balance) filter (where a.opening_date < p_from), 0)
       + coalesce((select sum(case t.direction when 'IN' then t.amount else -t.amount end)
                   from public.cash_transactions t join public.payment_accounts a2 on a2.id = t.account_id
                   where t.occurred_on < p_from and t.occurred_on >= a2.opening_date and (p_account_id is null or t.account_id = p_account_id)), 0)
    into v_opening
  from public.payment_accounts a where a.owner = 'EMPRESA' and (p_account_id is null or a.id = p_account_id);
  select coalesce(jsonb_agg(jsonb_build_object('bucket', x.bucket, 'inflows', x.ins, 'outflows', x.outs, 'net', x.ins - x.outs) order by x.bucket), '[]'::jsonb)
    into v_buckets
  from (select date_trunc(v_grain, t.occurred_on)::date as bucket,
               coalesce(sum(t.amount) filter (where t.direction = 'IN'), 0) as ins,
               coalesce(sum(t.amount) filter (where t.direction = 'OUT'), 0) as outs
        from public.cash_transactions t
        where t.occurred_on between p_from and p_to and (p_account_id is null or t.account_id = p_account_id)
          and t.transfer_group is null
        group by 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'direction', x.direction, 'amount', x.amount) order by x.direction, x.amount desc), '[]'::jsonb)
    into v_categories
  from (select c.code, c.name, t.direction, sum(t.amount) as amount
        from public.cash_transactions t join public.financial_categories c on c.id = t.category_id
        where t.occurred_on between p_from and p_to and (p_account_id is null or t.account_id = p_account_id) and t.transfer_group is null
        group by c.code, c.name, t.direction) x;
  return jsonb_build_object('opening', v_opening, 'buckets', v_buckets, 'categories', v_categories,
    'closing', v_opening + coalesce((select sum((b ->> 'net')::numeric) from jsonb_array_elements(v_buckets) b), 0));
end;
$$;

-- DRE gerencial (US-7.11, estrutura 13.2) com % da receita líquida e período anterior.
create function public.income_statement(p_from date, p_to date, p_compare_from date default null, p_compare_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cmp_from date := coalesce(p_compare_from, (p_from - interval '1 month')::date);
  v_cmp_to date := coalesce(p_compare_to, (p_from - interval '1 day')::date);
  v_lines jsonb := '[]'::jsonb;
  v_def record;
  v_amount numeric;
  v_prev numeric;
  v_net numeric;
  v_net_prev numeric;
  v_totals jsonb := '{}'::jsonb;
  v_totals_prev jsonb := '{}'::jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  for v_def in
    select * from (values
      (1, 'receita_bruta', 'Receita bruta de vendas', 'line', array['1.1'], null::text[]),
      (2, 'descontos', '(−) Descontos e devoluções', 'line', array['1.4'], null),
      (3, 'frete_cobrado', '(+) Frete cobrado', 'line', array['1.2'], null),
      (4, 'outras_receitas', '(+) Outras receitas', 'line', array['1.3', '1.*'], null),
      (5, 'receita_liquida', '(=) Receita líquida', 'total', null, array['receita_bruta', 'descontos', 'frete_cobrado', 'outras_receitas']),
      (6, 'cmv_material', '(−) CMV — material', 'line', array['2.1'], null),
      (7, 'cmv_operacional', '(−) CMV — energia, depreciação e operacional', 'line', array['2.2', '2.3', '2.4'], null),
      (8, 'cmv_trabalho', '(−) CMV — trabalho', 'line', array['2.5'], null),
      (9, 'lucro_bruto', '(=) Lucro bruto', 'total', null, array['receita_liquida', 'cmv_material', 'cmv_operacional', 'cmv_trabalho']),
      (10, 'taxas', '(−) Taxas de canal e de pagamento', 'line', array['3.1', '3.2'], null),
      (11, 'embalagem_frete', '(−) Embalagem e frete pago', 'line', array['3.3', '3.4'], null),
      (12, 'brindes', '(−) Brindes e amostras', 'line', array['3.5'], null),
      (13, 'impostos', '(−) Impostos sobre vendas', 'line', array['3.7'], null),
      (14, 'margem_contribuicao', '(=) Margem de contribuição', 'total', null, array['lucro_bruto', 'taxas', 'embalagem_frete', 'brindes', 'impostos']),
      (15, 'falhas', '(−) Custo de falhas de produção', 'line', array['2.6'], null),
      (16, 'ajustes_perdas', '(−) Ajustes de estoque e perdas', 'line', array['2.7', '2.*'], null),
      (17, 'despesas_operacionais', '(−) Despesas operacionais', 'line', array['3.6', '3.*', '4.*'], null),
      (18, 'resultado_operacional', '(=) Resultado operacional', 'total', null, array['margem_contribuicao', 'falhas', 'ajustes_perdas', 'despesas_operacionais']),
      (19, 'despesas_financeiras', '(−) Despesas financeiras', 'line', array['5.*'], null),
      (20, 'nao_operacional', '(±) Resultado não operacional', 'line', array['6.*'], null),
      (21, 'resultado', '(=) Resultado do período', 'total', null, array['resultado_operacional', 'despesas_financeiras', 'nao_operacional'])
    ) as d(ord, key, label, kind, codes, parts)
    order by ord
  loop
    if v_def.kind = 'line' then
      -- Códigos "X.*" pegam as categorias do grupo X ainda não usadas por outra linha.
      select coalesce(sum(e.amount) filter (where e.occurred_on between p_from and p_to), 0),
             coalesce(sum(e.amount) filter (where e.occurred_on between v_cmp_from and v_cmp_to), 0)
        into v_amount, v_prev
      from public.result_entries e join public.financial_categories c on c.id = e.category_id
      where c.in_income_statement and (
        c.code = any (v_def.codes)
        or (exists (select 1 from unnest(v_def.codes) x where x like '%.*' and c.code like replace(x, '*', '%'))
            and c.code not in ('1.1', '1.2', '1.4', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '3.1', '3.2', '3.3', '3.4', '3.5', '3.7')));
      v_totals := v_totals || jsonb_build_object(v_def.key, v_amount);
      v_totals_prev := v_totals_prev || jsonb_build_object(v_def.key, v_prev);
    else
      select coalesce(sum((v_totals ->> p)::numeric), 0), coalesce(sum((v_totals_prev ->> p)::numeric), 0)
        into v_amount, v_prev from unnest(v_def.parts) p;
      v_totals := v_totals || jsonb_build_object(v_def.key, v_amount);
      v_totals_prev := v_totals_prev || jsonb_build_object(v_def.key, v_prev);
    end if;
    v_lines := v_lines || jsonb_build_object('key', v_def.key, 'label', v_def.label, 'kind', v_def.kind, 'codes', to_jsonb(v_def.codes),
                                             'amount', v_amount, 'previous', v_prev);
  end loop;
  v_net := (v_totals ->> 'receita_liquida')::numeric;
  v_net_prev := (v_totals_prev ->> 'receita_liquida')::numeric;
  v_lines := (select jsonb_agg(l || jsonb_build_object(
      'pct', case when v_net <> 0 then round((l ->> 'amount')::numeric / v_net, 4) end,
      'previous_pct', case when v_net_prev <> 0 then round((l ->> 'previous')::numeric / v_net_prev, 4) end) order by n)
    from jsonb_array_elements(v_lines) with ordinality as x(l, n));
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'compare_from', v_cmp_from, 'compare_to', v_cmp_to, 'lines', v_lines,
    'warnings', jsonb_build_object(
      -- Com taxa combinada, a conta de luz fica só no caixa: energia não conciliada (13.1).
      'energy_not_reconciled', exists (select 1 from public.print_jobs j where j.rate_mode = 'COMBINED' and private.local_date(j.finished_at) between p_from and p_to),
      'labor_not_valued', private.rate_at('LABOR_PER_HOUR', null, p_to) is null
    )
  );
end;
$$;

-- Produtos por margem por hora de máquina no período (14.4, RN-15).
create function public.top_products(p_from date, p_to date, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_role(array['dono', 'leitura']);
  return (
    select coalesce(jsonb_agg(to_jsonb(y) order by y.mhm desc nulls last, y.margin desc), '[]'::jsonb)
    from (select x.* from (
      select v.id as variant_id, p.name || ' — ' || v.name as name, sum(dl.qty) as units,
             sum(round(dl.qty * l.unit_price, 2) - round(l.discount * dl.qty / l.qty, 2)) as revenue,
             sum(dl.cogs_total) as cogs,
             sum(round(dl.qty * l.unit_price, 2) - round(l.discount * dl.qty / l.qty, 2)) - sum(dl.cogs_total) as margin,
             private.machine_hours_per_unit(v.id) as hours_per_unit,
             case when private.machine_hours_per_unit(v.id) > 0
               then round((sum(round(dl.qty * l.unit_price, 2) - round(l.discount * dl.qty / l.qty, 2)) - sum(dl.cogs_total)) / sum(dl.qty)
                          / private.machine_hours_per_unit(v.id), 2) end as mhm
      from public.delivery_lines dl
      join public.deliveries d on d.id = dl.delivery_id
      join public.sales_order_lines l on l.id = dl.order_line_id
      join public.product_variants v on v.id = l.variant_id
      join public.products p on p.id = v.product_id
      where private.local_date(d.delivered_at) between p_from and p_to and not l.is_gift
      group by v.id, p.name, v.name
    ) x
    order by x.mhm desc nulls last, x.margin desc
    limit greatest(coalesce(p_limit, 5), 1)) y
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Configurações, membros, integridade e fechamento de mês
-- -----------------------------------------------------------------------------

create function public.save_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  update public.settings s
     set company_name = coalesce(nullif(btrim(p_settings ->> 'company_name'), ''), s.company_name),
         timezone = coalesce(nullif(p_settings ->> 'timezone', ''), s.timezone),
         allow_negative_stock = coalesce((p_settings ->> 'allow_negative_stock')::boolean, s.allow_negative_stock),
         absorb_scrap_cost = coalesce((p_settings ->> 'absorb_scrap_cost')::boolean, s.absorb_scrap_cost),
         default_owner_funding_type = coalesce(nullif(p_settings ->> 'default_owner_funding_type', ''), s.default_owner_funding_type),
         default_channel_id = coalesce(nullif(p_settings ->> 'default_channel_id', '')::bigint, s.default_channel_id),
         margin_target_pct = coalesce(nullif(p_settings ->> 'margin_target_pct', '')::numeric, s.margin_target_pct),
         tax_regime = coalesce(nullif(p_settings ->> 'tax_regime', ''), s.tax_regime),
         sales_tax_pct = coalesce(nullif(p_settings ->> 'sales_tax_pct', '')::numeric, s.sales_tax_pct),
         mei_monthly_das = coalesce(nullif(p_settings ->> 'mei_monthly_das', '')::numeric, s.mei_monthly_das),
         coverage_alert_days = coalesce(nullif(p_settings ->> 'coverage_alert_days', '')::integer, s.coverage_alert_days),
         go_live_date = case when p_settings ? 'go_live_date' then nullif(p_settings ->> 'go_live_date', '')::date else s.go_live_date end,
         filament_reference_cost_g = coalesce(nullif(p_settings ->> 'filament_reference_cost_g', '')::numeric, s.filament_reference_cost_g),
         default_order_packaging_item_id = case when p_settings ? 'default_order_packaging_item_id'
           then nullif(p_settings ->> 'default_order_packaging_item_id', '')::bigint else s.default_order_packaging_item_id end
   where s.id;
end;
$$;

-- Progresso do assistente de configuração inicial (US-0.11).
create function public.save_onboarding_state(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
begin
  perform private.assert_owner();
  update public.settings set onboarding_state = coalesce(p_state, '{}'::jsonb) where id returning onboarding_state into v_state;
  return v_state;
end;
$$;

create function public.set_member_role(p_user_id uuid, p_role text, p_active boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  if p_user_id = (select auth.uid()) and (p_role <> 'dono' or not p_active) then
    raise exception 'Você não pode remover o próprio acesso de dono.' using errcode = '22023';
  end if;
  update public.app_members set role = p_role, active = p_active where user_id = p_user_id;
  if not found then
    raise exception 'Membro não encontrado. Novas contas são convidadas pelo Supabase (docs/SUPABASE.md).' using errcode = '22023';
  end if;
  perform private.audit('UPDATE', 'app_member', null, p_user_id::text, format('Perfil alterado para %s%s', p_role, case when p_active then '' else ' (inativo)' end), '{}'::jsonb);
end;
$$;

create function public.update_my_profile(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  update public.profiles set display_name = left(btrim(coalesce(p_display_name, '')), 80) where id = (select auth.uid());
end;
$$;

-- Conferência do razão (rebuild_balances --check, seção 16.1) e das reservas.
create function public.check_stock_integrity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ledger jsonb;
  v_reservations jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_ledger from private.rebuild_balances(false) r;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', b.item_id, 'cached', b.qty_reserved, 'reservations', coalesce(x.total, 0))), '[]'::jsonb)
    into v_reservations
  from public.stock_balances b
  left join (select r.item_id, sum(r.qty) as total from public.reservations r where r.status = 'ATIVA' group by r.item_id) x on x.item_id = b.item_id
  where b.qty_reserved <> coalesce(x.total, 0);
  return jsonb_build_object('ok', v_ledger = '[]'::jsonb and v_reservations = '[]'::jsonb, 'ledger', v_ledger, 'reservations', v_reservations);
end;
$$;

-- Pendências antes de fechar o mês (US-7.12).
create function public.month_close_checklist(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  perform private.assert_role(array['dono', 'leitura']);
  return jsonb_build_object(
    'month', v_start,
    'open_print_jobs', (select count(*) from public.print_jobs j where j.status in ('PLANEJADA', 'IMPRIMINDO') and private.local_date(coalesce(j.started_at, j.planned_for)) <= v_end),
    'outputs_in_finishing', (select count(*) from public.print_job_outputs o where o.status = 'AGUARDANDO_ACABAMENTO'),
    'purchases_not_received', (select count(*) from public.purchases p where p.status in ('CONFIRMADA', 'RECEBIDA_PARCIAL') and p.purchased_at <= v_end),
    'overdue_installments', (select count(*) from public.installments i where i.status = 'ABERTA' and i.due_date <= v_end),
    'draft_purchases', (select count(*) from public.purchases p where p.status = 'RASCUNHO' and p.purchased_at <= v_end),
    'stock_ok', (public.check_stock_integrity() ->> 'ok')::boolean
  );
end;
$$;

create function public.close_month(p_month date, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_metrics jsonb;
begin
  perform private.assert_owner();
  if v_end >= private.today() then
    raise exception 'Só meses já encerrados podem ser fechados.' using errcode = '22023';
  end if;
  v_metrics := jsonb_build_object('dre', public.income_statement(v_start, v_end), 'checklist', public.month_close_checklist(v_start),
                                  'cash_balance', private.cash_balance_at(v_end));
  insert into public.month_closes (month, status, closed_at, closed_by, metrics, notes)
  values (v_start, 'FECHADO', now(), (select auth.uid()), v_metrics, nullif(btrim(coalesce(p_notes, '')), ''))
  on conflict (month) do update set status = 'FECHADO', closed_at = now(), closed_by = (select auth.uid()), metrics = excluded.metrics,
                                    notes = coalesce(excluded.notes, public.month_closes.notes);
  perform private.audit('CLOSE_MONTH', 'month_close', null, to_char(v_start, 'MM/YYYY'), 'Mês fechado', '{}'::jsonb);
  return v_metrics;
end;
$$;

create function public.reopen_month(p_month date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo da reabertura.' using errcode = '22023';
  end if;
  update public.month_closes set status = 'ABERTO', reopened_at = now(), reopened_by = (select auth.uid()), reopen_reason = btrim(p_reason)
   where month = date_trunc('month', p_month)::date and status = 'FECHADO';
  if not found then
    raise exception 'Este mês não está fechado.' using errcode = '22023';
  end if;
  perform private.audit('REOPEN_MONTH', 'month_close', null, to_char(p_month, 'MM/YYYY'), 'Mês reaberto: ' || btrim(p_reason), '{}'::jsonb);
end;
$$;

select private.apply_grants();
