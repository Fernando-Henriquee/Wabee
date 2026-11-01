-- =============================================================================
-- Visão geral: análises extras (todas somente leitura, para dono e leitura).
--   * period_compare     — dois períodos lado a lado
--   * weekly_summary     — últimos 7 dias × 7 anteriores
--   * product_mix        — curva ABC, pontuais × catálogo e cores mais vendidas
--   * delivery_stats     — tempo de entrega e encomendas no prazo
--   * order_backlog      — carteira de encomendas e capacidade × demanda das impressoras
--   * owner_withdrawal   — quanto o dono pode retirar
--   * dashboard_insights — alertas de margem, ritmo da meta, clientes, prejuízo e despesas
-- =============================================================================

alter table public.settings
  add column printer_hours_per_day numeric(4,1) not null default 10 check (printer_hours_per_day > 0 and printer_hours_per_day <= 24),
  add column cash_reserve_months numeric(4,1) not null default 1 check (cash_reserve_months >= 0 and cash_reserve_months <= 24);

comment on column public.settings.printer_hours_per_day is 'Horas por dia que cada impressora ativa costuma imprimir (capacidade da Visão geral).';
comment on column public.settings.cash_reserve_months is 'Meses de despesas fixas mantidos em caixa antes de sugerir retirada ao dono.';

create or replace function public.save_settings(p_settings jsonb)
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
           then nullif(p_settings ->> 'default_order_packaging_item_id', '')::bigint else s.default_order_packaging_item_id end,
         monthly_fixed_expenses = case when p_settings ? 'monthly_fixed_expenses'
           then nullif(p_settings ->> 'monthly_fixed_expenses', '')::numeric else s.monthly_fixed_expenses end,
         monthly_profit_target = coalesce(nullif(p_settings ->> 'monthly_profit_target', '')::numeric, s.monthly_profit_target),
         printer_hours_per_day = coalesce(nullif(p_settings ->> 'printer_hours_per_day', '')::numeric, s.printer_hours_per_day),
         cash_reserve_months = coalesce(nullif(p_settings ->> 'cash_reserve_months', '')::numeric, s.cash_reserve_months)
   where s.id;
end;
$$;

-- Linhas entregues no período com receita líquida, CMV e a parte das taxas e
-- embalagem da entrega rateada pela receita da linha.
create function private.delivered_lines(p_from date, p_to date)
returns table (
  delivery_id bigint, order_id bigint, channel_id bigint, variant_id bigint, product_name text, variant_name text,
  is_custom boolean, qty numeric, revenue numeric, cogs numeric, selling numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.order_id, o.channel_id, v.id, p.name, v.name, (p.is_custom or v.is_hidden),
         dl.qty, x.revenue, dl.cogs_total,
         case when d.revenue > 0 then round((d.channel_fee + d.packaging_cost) * x.revenue / d.revenue, 2) else 0 end
  from public.delivery_lines dl
  join public.deliveries d on d.id = dl.delivery_id
  join public.sales_orders o on o.id = d.order_id
  join public.sales_order_lines l on l.id = dl.order_line_id
  join public.product_variants v on v.id = l.variant_id
  join public.products p on p.id = v.product_id
  cross join lateral (select round(dl.qty * l.unit_price, 2) - round(l.discount * dl.qty / l.qty, 2) as revenue) x
  where private.local_date(d.delivered_at) between p_from and p_to and not l.is_gift;
$$;

-- Números de um período (base da comparação e do resumo da semana).
create function private.period_metrics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_margin jsonb := private.margin_block(p_from, p_to);
  v_fixed numeric := private.fixed_expenses_sum(p_from, p_to);
  v_orders integer;
  v_units numeric;
  v_custom numeric;
  v_hours numeric;
  v_pieces numeric;
  v_failed integer;
  v_new_customers integer;
begin
  select count(distinct d.order_id) into v_orders from public.deliveries d where private.local_date(d.delivered_at) between p_from and p_to;
  select coalesce(sum(x.qty), 0), coalesce(sum(x.revenue) filter (where x.is_custom), 0) into v_units, v_custom
  from private.delivered_lines(p_from, p_to) x;
  select coalesce(round(sum(coalesce(j.actual_minutes, j.est_minutes)) / 60.0, 1), 0),
         coalesce(sum((select sum(o.qty_good) from public.print_job_outputs o where o.print_job_id = j.id)), 0)
    into v_hours, v_pieces
  from public.print_jobs j where j.status = 'CONCLUIDA' and private.local_date(j.finished_at) between p_from and p_to;
  select count(*) into v_failed from public.print_jobs j where j.status = 'FALHOU' and private.local_date(j.finished_at) between p_from and p_to;
  select count(*) into v_new_customers from (
    select o.customer_id from public.sales_orders o join public.deliveries d on d.order_id = o.id
    where o.customer_id is not null group by o.customer_id
    having private.local_date(min(d.delivered_at)) between p_from and p_to) c;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'net_revenue', (v_margin ->> 'net_revenue')::numeric,
    'margin_direct', (v_margin ->> 'direct')::numeric,
    'margin_operational', (v_margin ->> 'operational')::numeric,
    'margin_full', (v_margin ->> 'full')::numeric,
    'margin_operational_pct', (v_margin ->> 'operational_pct')::numeric,
    'orders', v_orders,
    'units', v_units,
    'avg_ticket', case when v_orders > 0 then round((v_margin ->> 'net_revenue')::numeric / v_orders, 2) end,
    'custom_revenue', v_custom,
    'fixed_expenses', v_fixed,
    'result', (v_margin ->> 'operational')::numeric - v_fixed,
    'machine_hours', v_hours,
    'pieces_produced', v_pieces,
    'failed_jobs', v_failed,
    'new_customers', v_new_customers
  );
end;
$$;

create function public.period_compare(p_a_from date, p_a_to date, p_b_from date, p_b_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_role(array['dono', 'leitura']);
  if p_a_to < p_a_from or p_b_to < p_b_from then
    raise exception 'Período inválido: o fim vem antes do início.' using errcode = '22023';
  end if;
  return jsonb_build_object('a', private.period_metrics(p_a_from, p_a_to), 'b', private.period_metrics(p_b_from, p_b_to));
end;
$$;

-- Resumo da semana: últimos 7 dias × os 7 anteriores, melhor produto e melhor canal.
create function public.weekly_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
  v_best_product jsonb;
  v_best_channel jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select jsonb_build_object('name', x.product_name || ' — ' || x.variant_name, 'units', sum(x.qty), 'revenue', sum(x.revenue))
    into v_best_product
  from private.delivered_lines(v_today - 6, v_today) x
  group by x.variant_id, x.product_name, x.variant_name order by sum(x.revenue) desc limit 1;
  select jsonb_build_object('name', c.name, 'revenue', sum(x.revenue)) into v_best_channel
  from private.delivered_lines(v_today - 6, v_today) x join public.sales_channels c on c.id = x.channel_id
  group by c.id, c.name order by sum(x.revenue) desc limit 1;
  return jsonb_build_object(
    'current', private.period_metrics(v_today - 6, v_today),
    'previous', private.period_metrics(v_today - 13, v_today - 7),
    'best_product', v_best_product,
    'best_channel', v_best_channel
  );
end;
$$;

-- Curva ABC por margem, pontuais × catálogo e cores (gramas de filamento das fichas
-- ativas × unidades vendidas).
create function public.product_mix(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_products jsonb;
  v_split jsonb;
  v_colors jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  with per_variant as (
    select x.variant_id, x.product_name || ' — ' || x.variant_name as name, bool_or(x.is_custom) as is_custom,
           sum(x.qty) as units, sum(x.revenue) as revenue, sum(x.revenue - x.cogs - x.selling) as margin
    from private.delivered_lines(p_from, p_to) x group by x.variant_id, x.product_name, x.variant_name
  ), ranked as (
    select r.*, sum(greatest(r.margin, 0)) over (order by r.margin desc, r.variant_id rows unbounded preceding) as running,
           sum(greatest(r.margin, 0)) over () as total
    from per_variant r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', r.variant_id, 'name', r.name, 'is_custom', r.is_custom, 'units', r.units, 'revenue', r.revenue, 'margin', r.margin,
           'share', case when r.total > 0 then round(greatest(r.margin, 0) / r.total, 4) end,
           'abc', case when r.total <= 0 or r.margin <= 0 then 'C'
                       when r.running - greatest(r.margin, 0) < 0.8 * r.total then 'A'
                       when r.running - greatest(r.margin, 0) < 0.95 * r.total then 'B' else 'C' end)
         order by r.margin desc, r.variant_id), '[]'::jsonb)
    into v_products
  from ranked r;

  select jsonb_build_object(
    'custom', jsonb_build_object('revenue', coalesce(sum(x.revenue) filter (where x.is_custom), 0),
                                 'margin', coalesce(sum(x.revenue - x.cogs - x.selling) filter (where x.is_custom), 0),
                                 'units', coalesce(sum(x.qty) filter (where x.is_custom), 0),
                                 'orders', count(distinct x.order_id) filter (where x.is_custom)),
    'catalog', jsonb_build_object('revenue', coalesce(sum(x.revenue) filter (where not x.is_custom), 0),
                                  'margin', coalesce(sum(x.revenue - x.cogs - x.selling) filter (where not x.is_custom), 0),
                                  'units', coalesce(sum(x.qty) filter (where not x.is_custom), 0),
                                  'orders', count(distinct x.order_id) filter (where not x.is_custom)))
    into v_split
  from private.delivered_lines(p_from, p_to) x;

  select coalesce(jsonb_agg(jsonb_build_object('color_name', c.color_name, 'color_hex', c.color_hex, 'material', c.material,
                                               'grams', c.grams, 'units', c.units) order by c.grams desc), '[]'::jsonb)
    into v_colors
  from (
    select fs.color_name, min(fs.color_hex) as color_hex, string_agg(distinct fs.material, ', ') as material,
           round(sum(s.units * l.qty_per_unit * (1 + l.waste_pct)), 1) as grams, sum(s.units) as units
    from (select x.variant_id, sum(x.qty) as units from private.delivered_lines(p_from, p_to) x group by x.variant_id) s
    join public.bom_versions b on b.variant_id = s.variant_id and b.status = 'ATIVA'
    join public.bom_lines l on l.bom_version_id = b.id and l.line_kind like 'FILAMENT\_%' and l.consumed_at = 'PRODUCTION'
    join public.filament_specs fs on fs.item_id = l.item_id
    group by fs.color_name
  ) c;

  return jsonb_build_object('products', v_products, 'split', v_split, 'colors', v_colors);
end;
$$;

-- Tempo entre o pedido e a entrega, por tipo; encomendas entregues no prazo.
create function public.delivery_stats(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kinds jsonb;
  v_late jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select coalesce(jsonb_object_agg(k.kind, jsonb_build_object('orders', k.orders, 'avg_days', k.avg_days, 'on_time', k.on_time, 'with_due', k.with_due)), '{}'::jsonb)
    into v_kinds
  from (
    select o.kind, count(*) as orders,
           round(avg(extract(epoch from (o.delivered_at - o.ordered_at)) / 86400.0), 1) as avg_days,
           count(*) filter (where o.due_date is not null and private.local_date(o.delivered_at) <= o.due_date) as on_time,
           count(*) filter (where o.due_date is not null) as with_due
    from public.sales_orders o
    where o.status = 'ENTREGUE' and not o.is_historical and o.delivered_at is not null
      and private.local_date(o.delivered_at) between p_from and p_to
    group by o.kind
  ) k;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'number', l.number, 'customer', l.customer, 'days_late', l.days_late) order by l.days_late desc), '[]'::jsonb)
    into v_late
  from (
    select o.id, o.number, c.name as customer, private.local_date(o.delivered_at) - o.due_date as days_late
    from public.sales_orders o left join public.customers c on c.id = o.customer_id
    where o.status = 'ENTREGUE' and o.due_date is not null and private.local_date(o.delivered_at) > o.due_date
      and private.local_date(o.delivered_at) between p_from and p_to
    order by 4 desc limit 5
  ) l;
  return jsonb_build_object('kinds', v_kinds, 'late', v_late);
end;
$$;

-- Carteira de encomendas abertas e capacidade × demanda das impressoras nos próximos dias.
-- Demanda = impressões planejadas/imprimindo + peças de pedidos ainda sem impressão
-- (pelo tempo da ficha). Capacidade = impressoras ativas × horas por dia × dias.
create function public.order_backlog(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
  v_days integer := greatest(coalesce(p_days, 14), 1);
  v_settings public.settings := private.settings();
  v_printers integer;
  v_jobs_minutes numeric;
  v_orders jsonb;
  v_summary jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select count(*) into v_printers from public.equipment e where e.kind = 'PRINTER' and e.status = 'ATIVO';
  select coalesce(sum(j.est_minutes), 0) into v_jobs_minutes from public.print_jobs j where j.status in ('PLANEJADA', 'IMPRIMINDO');

  with open_orders as (
    select o.id, o.number, o.kind, o.status, o.due_date, o.total, c.name as customer,
           coalesce((select sum(i.paid_amount) from public.installments i where i.receivable_id = o.receivable_id and i.status = 'PAGA'), 0) as received
    from public.sales_orders o left join public.customers c on c.id = o.customer_id
    where o.status in ('CONFIRMADO', 'EM_PRODUCAO', 'PRONTO')
  ), uncovered as (
    -- Peças que faltam e ainda não estão numa impressão ativa do pedido, em minutos de máquina.
    select l.order_id,
           sum(greatest(l.qty - l.qty_reserved - l.qty_delivered - coalesce((
                 select sum(po.qty_planned) from public.print_job_outputs po join public.print_jobs j on j.id = po.print_job_id
                 where j.sales_order_id = l.order_id and po.variant_id = l.variant_id and j.status in ('PLANEJADA', 'IMPRIMINDO')), 0), 0)
               * b.est_print_minutes_per_plate::numeric / b.units_per_plate) as minutes
    from public.sales_order_lines l join public.bom_versions b on b.variant_id = l.variant_id and b.status = 'ATIVA'
    where l.order_id in (select id from open_orders) and not l.is_gift
    group by l.order_id
  ), per_order as (
    select o.*, round((coalesce(u.minutes, 0)
                 + coalesce((select sum(j.est_minutes) from public.print_jobs j where j.sales_order_id = o.id and j.status in ('PLANEJADA', 'IMPRIMINDO')), 0)) / 60.0, 1) as hours
    from open_orders o left join uncovered u on u.order_id = o.id
  ), timeline as (
    select p.*, sum(p.hours) over (order by p.due_date nulls last, p.id rows unbounded preceding) as cumulative_hours
    from per_order p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'number', t.number, 'kind', t.kind, 'status', t.status, 'customer', t.customer, 'due_date', t.due_date,
           'total', t.total, 'received', t.received, 'to_receive', greatest(t.total - t.received, 0), 'hours', t.hours,
           'cumulative_hours', t.cumulative_hours,
           'hours_until_due', case when t.due_date is not null then v_printers * v_settings.printer_hours_per_day * greatest(t.due_date - v_today + 1, 0) end,
           'at_risk', t.due_date is not null and t.hours > 0
                      and t.cumulative_hours > v_printers * v_settings.printer_hours_per_day * greatest(t.due_date - v_today + 1, 0))
         order by t.due_date nulls last, t.id), '[]'::jsonb)
    into v_orders
  from timeline t;

  select jsonb_build_object(
    'orders', count(*),
    'value', coalesce(sum((o ->> 'total')::numeric), 0),
    'received', coalesce(sum((o ->> 'received')::numeric), 0),
    'to_receive', coalesce(sum((o ->> 'to_receive')::numeric), 0),
    'order_hours', coalesce(sum((o ->> 'hours')::numeric), 0),
    'at_risk', count(*) filter (where (o ->> 'at_risk')::boolean))
    into v_summary
  from jsonb_array_elements(v_orders) o;

  return jsonb_build_object(
    'days', v_days,
    'printers', v_printers,
    'hours_per_day', v_settings.printer_hours_per_day,
    'capacity_hours', v_printers * v_settings.printer_hours_per_day * v_days,
    -- Demanda: todas as impressões ativas (de pedido ou de estoque) + peças de pedido ainda sem impressão.
    'demand_hours', round(v_jobs_minutes / 60.0, 1)
                    + coalesce((select sum((o ->> 'hours')::numeric) from jsonb_array_elements(v_orders) o), 0)
                    - round(coalesce((select sum(j.est_minutes) from public.print_jobs j
                                      where j.status in ('PLANEJADA', 'IMPRIMINDO') and j.sales_order_id in (
                                        select (o ->> 'id')::bigint from jsonb_array_elements(v_orders) o)), 0) / 60.0, 1),
    'stock_job_hours', round(coalesce((select sum(j.est_minutes) from public.print_jobs j
                                       where j.status in ('PLANEJADA', 'IMPRIMINDO') and j.sales_order_id is null), 0) / 60.0, 1),
    'summary', v_summary,
    'list', v_orders
  );
end;
$$;

-- Quanto o dono pode retirar: o que sobra no caixa depois das contas dos próximos
-- 30 dias e da reserva, limitado ao lucro do mês anterior.
create function public.owner_withdrawal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
  v_settings public.settings := private.settings();
  v_cash numeric := private.cash_balance_at(v_today);
  v_payables numeric;
  v_goal jsonb := public.monthly_goal('operational');
  v_reserve numeric;
  v_room numeric;
  v_prev_from date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_prev_to date := (date_trunc('month', v_today) - interval '1 day')::date;
  v_prev_result numeric;
  v_month_result numeric;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select coalesce(sum(i.amount), 0) into v_payables
  from public.installments i where i.payable_id is not null and i.status = 'ABERTA' and i.payer = 'EMPRESA' and i.due_date <= v_today + 30;
  v_reserve := round(v_settings.cash_reserve_months * (v_goal -> 'expenses' ->> 'basis')::numeric, 2);
  v_room := greatest(v_cash - v_payables - v_reserve, 0);
  v_prev_result := (private.margin_block(v_prev_from, v_prev_to) ->> 'operational')::numeric - private.fixed_expenses_sum(v_prev_from, v_prev_to);
  v_month_result := (v_goal ->> 'result')::numeric;
  return jsonb_build_object(
    'cash', v_cash, 'payables_30d', v_payables, 'reserve', v_reserve, 'reserve_months', v_settings.cash_reserve_months,
    'cash_room', v_room,
    'previous_month', v_prev_from, 'previous_result', v_prev_result, 'month_result', v_month_result,
    'suggested', case when v_prev_result > 0 then least(v_room, v_prev_result) else 0 end
  );
end;
$$;

-- Alertas de análise (somam-se aos de dashboard_alerts na Visão geral).
create function public.dashboard_insights()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
  v_settings public.settings := private.settings();
  v_alerts jsonb := '[]'::jsonb;
  v_week jsonb := private.margin_block(v_today - 6, v_today);
  v_goal jsonb;
  v_expected numeric;
  v_row record;
begin
  perform private.assert_role(array['dono', 'leitura']);

  -- Margem da semana abaixo da alvo.
  if (v_week ->> 'net_revenue')::numeric > 0 and (v_week ->> 'operational_pct')::numeric < v_settings.margin_target_pct then
    v_alerts := v_alerts || jsonb_build_object('kind', 'margin_low', 'severity', 'warning', 'title', 'Margem da semana abaixo da alvo',
      'detail', format('%s%% nos últimos 7 dias (alvo %s%%)', private.fmt_num((v_week ->> 'operational_pct')::numeric * 100, 1),
                       private.fmt_num(v_settings.margin_target_pct * 100, 0)),
      'href', '/financeiro/dre');
  end if;

  -- Abaixo do ritmo da meta (a partir do 5º dia do mês).
  v_goal := public.monthly_goal('operational');
  if (v_goal ->> 'days_elapsed')::integer >= 5 and (v_goal ->> 'target_revenue') is not null and (v_goal ->> 'target_revenue')::numeric > 0 then
    v_expected := (v_goal ->> 'target_revenue')::numeric * (v_goal ->> 'days_elapsed')::numeric / (v_goal ->> 'days')::numeric;
    if (v_goal ->> 'revenue')::numeric < 0.8 * v_expected then
      v_alerts := v_alerts || jsonb_build_object('kind', 'goal_pace', 'severity', 'warning', 'title', 'Abaixo do ritmo da meta',
        'detail', format('faturado %s; o esperado até hoje era %s (%s%% abaixo)', private.fmt_money((v_goal ->> 'revenue')::numeric),
                         private.fmt_money(v_expected), private.fmt_num((1 - (v_goal ->> 'revenue')::numeric / v_expected) * 100, 0)),
        'href', '/');
    end if;
  end if;

  -- Clientes com duas ou mais parcelas atrasadas.
  for v_row in
    select c.id, c.name, count(*) as n, sum(i.amount) as total
    from public.installments i join public.receivables r on r.id = i.receivable_id join public.customers c on c.id = r.customer_id
    where i.status = 'ABERTA' and i.due_date < v_today
    group by c.id, c.name having count(*) >= 2 order by sum(i.amount) desc limit 5
  loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'customer_overdue', 'severity', 'danger', 'title', 'Cliente com parcelas atrasadas',
      'detail', format('%s: %s parcelas, %s', v_row.name, v_row.n, private.fmt_money(v_row.total)),
      'ref_id', v_row.id, 'href', '/financeiro/receber');
  end loop;

  -- Produto vendido abaixo do custo nos últimos 7 dias.
  for v_row in
    select x.product_name || ' — ' || x.variant_name as name, sum(x.qty) as qty, sum(x.revenue - x.cogs - x.selling) as loss
    from private.delivered_lines(v_today - 6, v_today) x
    group by x.variant_id, x.product_name, x.variant_name having sum(x.revenue - x.cogs - x.selling) < 0
    order by 3 limit 5
  loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'sold_below_cost', 'severity', 'danger', 'title', 'Vendido abaixo do custo',
      'detail', format('%s: %s un. com prejuízo de %s nos últimos 7 dias', v_row.name, private.fmt_num(v_row.qty, 0), private.fmt_money(-v_row.loss)),
      'href', '/produtos');
  end loop;

  -- Despesa do mês bem acima da média dos meses anteriores.
  for v_row in
    select c ->> 'name' as name, (c ->> 'month')::numeric as month, (c ->> 'avg_3m')::numeric as avg
    from jsonb_array_elements(v_goal -> 'expenses' -> 'categories') c
    where (c ->> 'avg_3m')::numeric > 0 and (c ->> 'month')::numeric > 1.3 * (c ->> 'avg_3m')::numeric
      and (c ->> 'month')::numeric - (c ->> 'avg_3m')::numeric >= 20
  loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'expense_up', 'severity', 'info', 'title', 'Despesa acima da média',
      'detail', format('%s: %s neste mês, média %s (+%s%%)', v_row.name, private.fmt_money(v_row.month), private.fmt_money(v_row.avg),
                       private.fmt_num((v_row.month / v_row.avg - 1) * 100, 0)),
      'href', '/financeiro/despesas');
  end loop;

  return v_alerts;
end;
$$;

select private.apply_grants();
