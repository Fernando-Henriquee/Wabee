-- =============================================================================
-- Meta do mês pelas CONTAS QUE VENCEM no mês (parcelas a pagar), e não pelas
-- despesas lançadas no DRE: uma compra parcelada em 18x lançada como despesa
-- entrava inteira no mês da compra e inflava a meta. Agora conta só a parcela
-- de cada mês (paga pela empresa ou pelo dono), mais o DAS do MEI ainda não lançado.
-- O resultado do mês, a comparação de períodos e a retirada do dono seguem a mesma base.
-- =============================================================================

-- Parcelas a pagar (não canceladas) que vencem no período.
create function private.bills_due_sum(p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(i.amount), 0)
  from public.installments i
  where i.payable_id is not null and i.status <> 'CANCELADA' and i.due_date between p_from and p_to;
$$;

create or replace function public.monthly_goal(p_layer text default 'operational', p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.settings := private.settings();
  v_today date := private.today();
  v_from date := date_trunc('month', coalesce(p_month, v_today))::date;
  v_to date := (date_trunc('month', coalesce(p_month, v_today)) + interval '1 month - 1 day')::date;
  v_days integer := v_to - v_from + 1;
  v_elapsed integer;
  v_left integer;
  v_layer text := case when p_layer in ('direct', 'operational', 'full') then p_layer else 'operational' end;
  v_first_month date;
  v_avg_from date;
  v_avg_months integer;
  v_bills numeric;
  v_das_pending numeric := 0;
  v_avg3 numeric;
  v_basis numeric;
  v_basis_source text;
  v_margin_90 jsonb := private.margin_block(v_today - 89, v_today);
  v_margin_month jsonb := private.margin_block(v_from, least(v_to, v_today));
  v_pct numeric;
  v_pct_source text;
  v_revenue numeric;
  v_margin numeric;
  v_breakeven numeric;
  v_target numeric;
  v_orders_90 integer;
  v_ticket numeric;
  v_remaining numeric;
  v_categories jsonb;
  v_bill_list jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  v_elapsed := greatest(0, least(v_days, v_today - v_from + 1));
  v_left := case when v_today > v_to then 0 when v_today < v_from then v_days else v_to - v_today + 1 end;

  v_bills := private.bills_due_sum(v_from, v_to);
  -- MEI: o DAS do mês entra mesmo antes de ser lançado.
  if v_settings.tax_regime = 'MEI' and v_settings.mei_monthly_das > 0 then
    v_das_pending := greatest(v_settings.mei_monthly_das + private.result_sum(v_from, v_to, array['4.5']), 0);
  end if;
  -- Média das contas dos 3 meses anteriores (só informativa), desde o primeiro vencimento.
  select date_trunc('month', min(i.due_date))::date into v_first_month from public.installments i where i.payable_id is not null;
  v_avg_from := greatest((v_from - interval '3 months')::date, coalesce(v_first_month, v_from));
  v_avg_months := greatest(0, (extract(year from age(v_from, v_avg_from)) * 12 + extract(month from age(v_from, v_avg_from)))::integer);
  if v_avg_months > 0 then
    v_avg3 := round(private.bills_due_sum(v_avg_from, v_from - 1) / v_avg_months, 2);
  end if;

  if v_settings.monthly_fixed_expenses is not null then
    v_basis := v_settings.monthly_fixed_expenses;
    v_basis_source := 'MANUAL';
  elsif v_bills + v_das_pending > 0 then
    v_basis := v_bills + v_das_pending;
    v_basis_source := 'MES';
  else
    v_basis := 0;
    v_basis_source := 'NENHUMA';
  end if;

  if (v_margin_90 ->> 'net_revenue')::numeric > 0 then
    v_pct := (v_margin_90 ->> (v_layer || '_pct'))::numeric;
    v_pct_source := 'REALIZADA_90D';
  else
    v_pct := v_settings.margin_target_pct;
    v_pct_source := 'ALVO';
  end if;

  v_revenue := (v_margin_month ->> 'net_revenue')::numeric;
  v_margin := (v_margin_month ->> v_layer)::numeric;
  if v_pct > 0 then
    v_breakeven := round(v_basis / v_pct, 2);
    v_target := round((v_basis + v_settings.monthly_profit_target) / v_pct, 2);
  end if;
  v_remaining := case when v_target is not null then greatest(v_target - v_revenue, 0) end;

  select count(distinct d.order_id) into v_orders_90
  from public.deliveries d where private.local_date(d.delivered_at) between v_today - 89 and v_today;
  if v_orders_90 > 0 then
    v_ticket := round((v_margin_90 ->> 'net_revenue')::numeric / v_orders_90, 2);
  end if;

  -- Contas do mês, uma linha por conta a pagar.
  select coalesce(jsonb_agg(jsonb_build_object('description', b.description, 'category', b.category, 'payer', b.payer,
                                               'amount', b.amount, 'paid', b.paid, 'installment', b.installment)
                            order by b.amount desc), '[]'::jsonb)
    into v_bill_list
  from (
    select py.description, c.name as category, min(i.payer) as payer, sum(i.amount) as amount, bool_and(i.status = 'PAGA') as paid,
           string_agg(i.number || '/' || i.of_total, ', ' order by i.number) as installment
    from public.installments i
    join public.payables py on py.id = i.payable_id
    join public.financial_categories c on c.id = py.category_id
    where i.status <> 'CANCELADA' and i.due_date between v_from and v_to
    group by py.id, py.description, c.name
  ) b;

  -- Despesas por categoria no DRE (competência): usadas no alerta de despesa acima da média.
  select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'month', x.month, 'avg_3m', x.avg_3m)
                            order by greatest(x.month, coalesce(x.avg_3m, 0)) desc, x.code), '[]'::jsonb)
    into v_categories
  from (
    select c.code, c.name,
           coalesce(-sum(e.amount) filter (where e.occurred_on between v_from and v_to), 0) as month,
           case when v_avg_months > 0
             then round(coalesce(-sum(e.amount) filter (where e.occurred_on between v_avg_from and v_from - 1), 0) / v_avg_months, 2) end as avg_3m
    from public.result_entries e join public.financial_categories c on c.id = e.category_id
    where c.in_income_statement and c.nature in ('DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA')
      and e.occurred_on between v_avg_from and v_to
    group by c.code, c.name
  ) x
  where x.month <> 0 or coalesce(x.avg_3m, 0) <> 0;

  return jsonb_build_object(
    'month', v_from, 'layer', v_layer,
    'days', v_days, 'days_elapsed', v_elapsed, 'days_left', v_left,
    'expenses', jsonb_build_object(
      'basis', v_basis, 'source', v_basis_source,
      'month', v_bills, 'das_pending', v_das_pending, 'avg_3m', v_avg3, 'avg_months', v_avg_months,
      'manual', v_settings.monthly_fixed_expenses, 'bills', v_bill_list, 'categories', v_categories),
    'margin_pct', v_pct, 'margin_source', v_pct_source,
    'profit_target', v_settings.monthly_profit_target,
    'breakeven_revenue', v_breakeven,
    'target_revenue', v_target,
    'revenue', v_revenue,
    'margin', v_margin,
    -- Resultado do mês: margem das vendas menos as contas que vencem no mês.
    'result', v_margin - v_bills,
    'remaining', v_remaining,
    'per_day', case when v_remaining is not null and v_left > 0 then round(v_remaining / v_left, 2) end,
    'projection', case when v_elapsed > 0 then round(v_revenue / v_elapsed * v_days, 2) end,
    'avg_ticket', v_ticket,
    'orders_needed', case when v_ticket > 0 and v_remaining > 0 then ceil(v_remaining / v_ticket)::integer end
  );
end;
$$;

-- Comparação e resumo: "contas do período" = parcelas que vencem no período.
create or replace function private.period_metrics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_margin jsonb := private.margin_block(p_from, p_to);
  v_bills numeric := private.bills_due_sum(p_from, p_to);
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
    'fixed_expenses', v_bills,
    'result', (v_margin ->> 'operational')::numeric - v_bills,
    'machine_hours', v_hours,
    'pieces_produced', v_pieces,
    'failed_jobs', v_failed,
    'new_customers', v_new_customers
  );
end;
$$;

create or replace function public.owner_withdrawal()
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
  v_prev_result := (private.margin_block(v_prev_from, v_prev_to) ->> 'operational')::numeric - private.bills_due_sum(v_prev_from, v_prev_to);
  v_month_result := (v_goal ->> 'result')::numeric;
  return jsonb_build_object(
    'cash', v_cash, 'payables_30d', v_payables, 'reserve', v_reserve, 'reserve_months', v_settings.cash_reserve_months,
    'cash_room', v_room,
    'previous_month', v_prev_from, 'previous_result', v_prev_result, 'month_result', v_month_result,
    'suggested', case when v_prev_result > 0 then least(v_room, v_prev_result) else 0 end
  );
end;
$$;

select private.apply_grants();
