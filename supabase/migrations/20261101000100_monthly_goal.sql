-- =============================================================================
-- Meta do mês (ponto de equilíbrio) na Visão geral.
--
-- Quanto a empresa precisa faturar no mês para pagar as despesas fixas, dada a
-- margem de contribuição: meta = (despesas fixas + lucro desejado) ÷ margem %.
--   * Despesas fixas: as de natureza DESPESA_OPERACIONAL e DESPESA_FINANCEIRA do DRE
--     (as variáveis — CMV, taxas, embalagem, frete, impostos — já saem da margem).
--     Valor manual em settings.monthly_fixed_expenses; sem ele, o maior entre o já
--     lançado no mês (mais o DAS do MEI ainda não lançado) e a média dos 3 meses anteriores.
--   * Margem %: a realizada nos últimos 90 dias na camada escolhida; sem vendas, a
--     margem alvo das configurações.
-- =============================================================================

alter table public.settings
  add column monthly_fixed_expenses numeric(14,2) check (monthly_fixed_expenses is null or monthly_fixed_expenses >= 0),
  add column monthly_profit_target numeric(14,2) not null default 0 check (monthly_profit_target >= 0);

comment on column public.settings.monthly_fixed_expenses is
  'Despesas fixas mensais previstas para a meta da Visão geral. Nulo = estimar pelos lançamentos.';
comment on column public.settings.monthly_profit_target is
  'Lucro desejado por mês, somado às despesas fixas na meta da Visão geral.';

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
         monthly_profit_target = coalesce(nullif(p_settings ->> 'monthly_profit_target', '')::numeric, s.monthly_profit_target)
   where s.id;
end;
$$;

-- Despesas fixas (operacionais e financeiras do DRE) no período, em valor positivo.
create function private.fixed_expenses_sum(p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(-sum(e.amount), 0)
  from public.result_entries e join public.financial_categories c on c.id = e.category_id
  where e.occurred_on between p_from and p_to and c.in_income_statement
    and c.nature in ('DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA');
$$;

create function public.monthly_goal(p_layer text default 'operational', p_month date default null)
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
  v_month_expenses numeric;
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
begin
  perform private.assert_role(array['dono', 'leitura']);
  -- Dias passados (inclui hoje) e restantes (inclui hoje) do mês consultado.
  v_elapsed := greatest(0, least(v_days, v_today - v_from + 1));
  v_left := case when v_today > v_to then 0 when v_today < v_from then v_days else v_to - v_today + 1 end;

  v_month_expenses := private.fixed_expenses_sum(v_from, v_to);
  -- MEI: o DAS do mês entra na previsão mesmo antes de ser lançado.
  if v_settings.tax_regime = 'MEI' and v_settings.mei_monthly_das > 0 then
    v_das_pending := greatest(v_settings.mei_monthly_das + private.result_sum(v_from, v_to, array['4.5']), 0);
  end if;
  -- Média dos 3 meses anteriores, contando só os meses desde o primeiro lançamento.
  select date_trunc('month', min(e.occurred_on))::date into v_first_month from public.result_entries e;
  v_avg_from := greatest((v_from - interval '3 months')::date, coalesce(v_first_month, v_from));
  v_avg_months := greatest(0, (extract(year from age(v_from, v_avg_from)) * 12 + extract(month from age(v_from, v_avg_from)))::integer);
  if v_avg_months > 0 then
    v_avg3 := round(private.fixed_expenses_sum(v_avg_from, v_from - 1) / v_avg_months, 2);
  end if;

  if v_settings.monthly_fixed_expenses is not null then
    v_basis := v_settings.monthly_fixed_expenses;
    v_basis_source := 'MANUAL';
  elsif coalesce(v_avg3, 0) > v_month_expenses + v_das_pending then
    v_basis := v_avg3;
    v_basis_source := 'MEDIA_3M';
  elsif v_month_expenses + v_das_pending > 0 then
    v_basis := v_month_expenses + v_das_pending;
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
      'month', v_month_expenses, 'das_pending', v_das_pending, 'avg_3m', v_avg3, 'avg_months', v_avg_months,
      'manual', v_settings.monthly_fixed_expenses, 'categories', v_categories),
    'margin_pct', v_pct, 'margin_source', v_pct_source,
    'profit_target', v_settings.monthly_profit_target,
    'breakeven_revenue', v_breakeven,
    'target_revenue', v_target,
    'revenue', v_revenue,
    'margin', v_margin,
    -- Resultado até agora: margem do mês menos as despesas fixas já lançadas.
    'result', v_margin - v_month_expenses,
    'remaining', v_remaining,
    'per_day', case when v_remaining is not null and v_left > 0 then round(v_remaining / v_left, 2) end,
    'projection', case when v_elapsed > 0 then round(v_revenue / v_elapsed * v_days, 2) end,
    'avg_ticket', v_ticket,
    'orders_needed', case when v_ticket > 0 and v_remaining > 0 then ceil(v_remaining / v_ticket)::integer end
  );
end;
$$;

select private.apply_grants();
