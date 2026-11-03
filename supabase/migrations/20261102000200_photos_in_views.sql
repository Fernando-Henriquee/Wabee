-- =============================================================================
-- Foto do produto nas telas de produção e de pedido, com a coluna photo_path no fim
-- (mesmas definições das views anteriores).
-- v_print_jobs: a foto do primeiro item da mesa.
-- =============================================================================

create or replace view public.v_print_jobs as
select
  j.id, j.code, j.status, j.equipment_id, e.name as equipment_name, j.planned_for, j.started_at, j.finished_at,
  j.est_minutes, j.actual_minutes, j.time_estimated, j.sales_order_id, j.failure_reason, j.failure_notes, j.notes,
  case when j.status = 'IMPRIMINDO' then j.started_at + make_interval(mins => j.est_minutes) end as expected_end,
  j.rate_mode, j.missing_rates, j.reversed_at, j.reverse_reason, j.replanned_from_id, j.created_at,
  (select coalesce(sum(o.qty_planned), 0) from public.print_job_outputs o where o.print_job_id = j.id)::integer as qty_planned,
  (select coalesce(sum(o.qty_good), 0) from public.print_job_outputs o where o.print_job_id = j.id)::integer as qty_good,
  (select coalesce(sum(o.qty_failed), 0) from public.print_job_outputs o where o.print_job_id = j.id)::integer as qty_failed,
  (select count(*) from public.print_job_outputs o where o.print_job_id = j.id and o.status = 'AGUARDANDO_ACABAMENTO')::integer as outputs_waiting,
  (select string_agg(p.name || ' — ' || v.name || ' ×' || o.qty_planned, ', ' order by o.sort_order)
     from public.print_job_outputs o join public.product_variants v on v.id = o.variant_id join public.products p on p.id = v.product_id
    where o.print_job_id = j.id) as outputs_summary,
  (select coalesce(sum(m.est_g), 0) from public.print_job_materials m where m.print_job_id = j.id) as est_grams,
  (select sum(m.actual_g) from public.print_job_materials m where m.print_job_id = j.id) as actual_grams,
  case when private.can_view_costs() then j.cost_material end as cost_material,
  case when private.can_view_costs() then j.cost_energy end as cost_energy,
  case when private.can_view_costs() then j.cost_depreciation end as cost_depreciation,
  case when private.can_view_costs() then j.cost_operational end as cost_operational,
  case when private.can_view_costs() then j.cost_labor end as cost_labor,
  case when private.can_view_costs() then j.cost_total end as cost_total,
  case when private.can_view_costs() then j.cost_scrap end as cost_scrap,
  (select p.photo_path from public.print_job_outputs o join public.product_variants v on v.id = o.variant_id join public.products p on p.id = v.product_id
    where o.print_job_id = j.id and p.photo_path is not null order by o.sort_order limit 1) as photo_path
from public.print_jobs j
join public.equipment e on e.id = j.equipment_id
where private.is_member();

-- v_sales_order_lines: a foto do item (a do produto, para produto pronto).
create or replace view public.v_sales_order_lines with (security_invoker = true) as
select
  l.id, l.order_id, l.item_id, l.variant_id, coalesce(i.name, l.custom_description) as description, i.sku,
  l.custom_description, l.qty, l.unit_price, l.discount, round(l.qty * l.unit_price, 2) - l.discount as line_total,
  l.is_gift, l.qty_reserved, l.qty_delivered, l.qty - l.qty_reserved - l.qty_delivered as qty_pending,
  b.qty_on_hand - b.qty_reserved as item_free_qty,
  l.unit_cogs_material, l.unit_cogs_energy, l.unit_cogs_depreciation, l.unit_cogs_operational, l.unit_cogs_labor,
  l.cogs_total, l.historical_unit_cost, l.sort_order,
  i.photo_path
from public.sales_order_lines l
left join public.items i on i.id = l.item_id
left join public.stock_balances b on b.item_id = l.item_id;

select private.apply_grants();
