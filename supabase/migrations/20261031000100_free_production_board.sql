-- Quadro de produção livre, como cards de projeto.
-- Planejada ↔ Imprimindo ↔ Acabamento são só etapas visuais: mover não mexe em estoque nem
-- em custo, não conta tempo e não trava a impressora (várias mesas podem estar "imprimindo").
-- Ir para Concluída baixa o filamento e lança o custo pela ficha e libera as peças no estoque.
-- Voltar de Concluída desfaz tudo (estorno) e devolve o MESMO card para a etapa escolhida.

alter table public.print_jobs drop constraint print_jobs_status_check;
alter table public.print_jobs add constraint print_jobs_status_check
  check (status in ('PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO', 'CONCLUIDA', 'FALHOU', 'CANCELADA', 'ESTORNADA'));
drop index public.print_jobs_one_printing;

create or replace function private.close_print_job(
  p_job_id bigint,
  p_finished_at timestamptz,
  p_minutes integer,
  p_materials jsonb,
  p_outputs jsonb,
  p_total_failure boolean,
  p_failure_reason text,
  p_failure_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.print_jobs;
  v_settings public.settings := private.settings();
  v_finished timestamptz := coalesce(p_finished_at, now());
  v_minutes integer;
  v_estimated boolean := false;
  v_on date;
  v_rates public.rate_set;
  v_mat jsonb;
  v_issue private.issue_result;
  v_material_total numeric := 0;
  v_mat_costs jsonb := '[]'::jsonb;
  v_hours numeric;
  v_energy numeric;
  v_dep numeric;
  v_op numeric;
  v_output_ids bigint[];
  v_weights numeric[];
  v_qty_weights numeric[];
  v_alloc_material numeric[];
  v_alloc_energy numeric[];
  v_alloc_dep numeric[];
  v_alloc_op numeric[];
  v_part numeric[];
  v_grams numeric[];
  v_out public.print_job_outputs;
  v_req jsonb;
  v_good integer;
  v_failed integer;
  v_total_w numeric;
  v_scrap_total numeric := 0;
  v_good_layers private.cost_layers;
  v_c private.cost_layers;
  v_scrap numeric;
  v_auto jsonb := '[]'::jsonb;
  v_material_row bigint;
  v_cost_m numeric;
  v_item_kind text;
  v_n integer;
begin
  select * into v_job from public.print_jobs j where j.id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Impressão não encontrada.' using errcode = '22023';
  end if;
  if v_job.status not in ('PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO') then
    raise exception 'A impressão % já foi finalizada ou cancelada.', v_job.code using errcode = '22023';
  end if;
  v_minutes := p_minutes;
  if v_minutes is null then
    v_minutes := v_job.est_minutes;
    v_estimated := true;
  end if;
  v_on := private.local_date(v_finished);
  perform private.assert_open_period(v_on);
  if jsonb_array_length(coalesce(p_materials, '[]'::jsonb)) = 0 then
    raise exception 'Informe os gramas reais de cada filamento.' using errcode = '22023';
  end if;

  -- 1. Consumo real de filamento (modelo + suporte + purga), do carretel aberto (US-1.6).
  for v_mat in select * from jsonb_array_elements(p_materials) loop
    select i.kind into v_item_kind from public.items i where i.id = (v_mat ->> 'item_id')::bigint;
    if v_item_kind is distinct from 'FILAMENT' then
      raise exception 'Material da impressão precisa ser filamento.' using errcode = '22023';
    end if;
    if coalesce((v_mat ->> 'actual_g')::numeric, 0) > 0 then
      v_issue := private.issue_stock((v_mat ->> 'item_id')::bigint, (v_mat ->> 'actual_g')::numeric, 'PRODUCTION_CONSUMPTION', v_finished,
        'print_job', v_job.id, null, nullif(v_mat ->> 'lot_id', '')::bigint);
      v_cost_m := v_issue.total_cost;
    else
      v_issue := row('{}'::bigint[], 0, 0, 0, 0, 0, 0, 0)::private.issue_result;
      v_cost_m := 0;
    end if;
    v_material_total := v_material_total + v_cost_m;
    select m.id into v_material_row from public.print_job_materials m
    where m.print_job_id = v_job.id and m.item_id = (v_mat ->> 'item_id')::bigint and m.actual_g is null order by m.id limit 1;
    if v_material_row is null then
      insert into public.print_job_materials (print_job_id, item_id, lot_id, est_g) values (v_job.id, (v_mat ->> 'item_id')::bigint, nullif(v_mat ->> 'lot_id', '')::bigint, 0)
      returning id into v_material_row;
    end if;
    update public.print_job_materials
       set actual_g = round((v_mat ->> 'actual_g')::numeric, 3), cost_total = v_cost_m, movement_ids = v_issue.movement_ids,
           unit_cost_snapshot = case when (v_mat ->> 'actual_g')::numeric > 0 then round(v_cost_m / (v_mat ->> 'actual_g')::numeric, 6) end,
           lot_id = coalesce(nullif(v_mat ->> 'lot_id', '')::bigint, lot_id)
     where id = v_material_row;
    v_mat_costs := v_mat_costs || jsonb_build_object('item_id', (v_mat ->> 'item_id')::bigint, 'cost', v_cost_m, 'per_output', v_mat -> 'per_output');
  end loop;
  -- Materiais planejados que não foram usados ficam com zero.
  update public.print_job_materials set actual_g = 0, cost_total = 0 where print_job_id = v_job.id and actual_g is null;

  -- 2. Operacional pelas taxas vigentes na data (RN-06, RN-07).
  v_rates := public.get_rates(v_job.equipment_id, v_on);
  v_hours := v_minutes / 60.0;
  v_energy := round(v_hours * v_rates.energy_h, 2);
  v_dep := round(v_hours * v_rates.depreciation_h, 2);
  v_op := round(v_hours * v_rates.operational_h, 2);

  -- 3. Rateio entre as saídas (RN-08): peso estimado × quantidade planejada; sem peso, por quantidade.
  select array_agg(o.id order by o.sort_order, o.id),
         array_agg(o.est_weight_g_per_unit * o.qty_planned order by o.sort_order, o.id),
         array_agg(o.qty_planned::numeric order by o.sort_order, o.id)
    into v_output_ids, v_weights, v_qty_weights
  from public.print_job_outputs o where o.print_job_id = v_job.id;
  if exists (select 1 from unnest(v_weights) w where w is null or w = 0) then
    v_weights := v_qty_weights;
  end if;
  v_n := array_length(v_output_ids, 1);
  v_alloc_material := array_fill(0::numeric, array[v_n]);
  for v_mat in select * from jsonb_array_elements(v_mat_costs) loop
    -- Mesa multicor: se informou gramas reais por saída deste filamento, usa os gramas diretos.
    if jsonb_typeof(v_mat -> 'per_output') = 'object' then
      v_grams := array(select coalesce((v_mat -> 'per_output' ->> x::text)::numeric, 0) from unnest(v_output_ids) x);
      v_part := private.allocate_cost((v_mat ->> 'cost')::numeric,
        case when (select sum(g) from unnest(v_grams) g) > 0 then v_grams else v_weights end);
    else
      v_part := private.allocate_cost((v_mat ->> 'cost')::numeric, v_weights);
    end if;
    for i in 1..v_n loop
      v_alloc_material[i] := v_alloc_material[i] + v_part[i];
    end loop;
  end loop;
  v_alloc_energy := private.allocate_cost(v_energy, v_weights);
  v_alloc_dep := private.allocate_cost(v_dep, v_weights);
  v_alloc_op := private.allocate_cost(v_op, v_weights);
  select sum(w) into v_total_w from unnest(v_weights) w;

  -- 4. Boas e falhas por saída (RN-09).
  for i in 1..v_n loop
    select * into v_out from public.print_job_outputs o where o.id = v_output_ids[i] for update;
    if p_total_failure then
      v_good := 0;
      v_failed := v_out.qty_planned;
    else
      select r into v_req from jsonb_array_elements(coalesce(p_outputs, '[]'::jsonb)) r where (r ->> 'output_id')::bigint = v_out.id;
      if v_req is null then
        raise exception 'Informe peças boas e com falha de todas as saídas.' using errcode = '22023';
      end if;
      v_good := (v_req ->> 'qty_good')::integer;
      v_failed := coalesce((v_req ->> 'qty_failed')::integer, v_out.qty_planned - v_good);
      if v_good is null or v_good < 0 or v_failed < 0 or v_good + v_failed <> v_out.qty_planned then
        raise exception 'Boas + falhas precisa ser igual ao planejado (%) em cada saída.', v_out.qty_planned using errcode = '22023';
      end if;
      if v_failed > 0 and nullif(v_req ->> 'failure_reason', '') is null then
        raise exception 'Informe o motivo das peças com falha.' using errcode = '22023';
      end if;
    end if;
    v_c := row(v_alloc_material[i], v_alloc_energy[i], v_alloc_dep[i], v_alloc_op[i], 0)::private.cost_layers;
    if v_good = 0 then
      v_good_layers := row(0, 0, 0, 0, 0)::private.cost_layers;
    elsif v_failed = 0 or v_settings.absorb_scrap_cost then
      -- Sem falhas, ou falhas absorvidas pelas boas (absorb_scrap_cost): u = C ÷ q_good.
      v_good_layers := v_c;
    else
      v_good_layers := row(round(v_good * v_c.material / v_out.qty_planned, 6), round(v_good * v_c.energy / v_out.qty_planned, 6),
                           round(v_good * v_c.depreciation / v_out.qty_planned, 6), round(v_good * v_c.operational / v_out.qty_planned, 6), 0)::private.cost_layers;
    end if;
    v_scrap := (v_c.material + v_c.energy + v_c.depreciation + v_c.operational)
             - (v_good_layers.material + v_good_layers.energy + v_good_layers.depreciation + v_good_layers.operational);
    v_scrap_total := v_scrap_total + v_scrap;
    update public.print_job_outputs o
       set qty_good = v_good, qty_failed = v_failed,
           failure_reason = case when p_total_failure then p_failure_reason else nullif(v_req ->> 'failure_reason', '') end,
           allocation_share = round(v_weights[i] / nullif(v_total_w, 0), 8),
           alloc_material = v_c.material, alloc_energy = v_c.energy, alloc_depreciation = v_c.depreciation, alloc_operational = v_c.operational,
           good_material = v_good_layers.material, good_energy = v_good_layers.energy,
           good_depreciation = v_good_layers.depreciation, good_operational = v_good_layers.operational,
           scrap_cost = v_scrap,
           needs_finishing = private.output_needs_finishing(o.bom_version_id),
           status = case when v_good > 0 then 'AGUARDANDO_ACABAMENTO' else 'LIBERADA' end,
           qty_released = case when v_good = 0 then 0 end,
           released_at = case when v_good = 0 then v_finished end
     where o.id = v_out.id;
  end loop;

  update public.print_jobs
     set status = case when p_total_failure then 'FALHOU' else 'CONCLUIDA' end,
         finished_at = v_finished,
         started_at = coalesce(started_at, v_finished - make_interval(mins => v_minutes)),
         actual_minutes = v_minutes, time_estimated = v_estimated,
         failure_reason = case when p_total_failure then p_failure_reason else failure_reason end,
         failure_notes = coalesce(nullif(btrim(coalesce(p_failure_notes, '')), ''), failure_notes),
         rate_mode = v_rates.mode, rate_ids = v_rates.rate_ids, missing_rates = v_rates.mode = 'MISSING',
         rate_energy_h = v_rates.energy_h, rate_depreciation_h = v_rates.depreciation_h,
         rate_operational_h = v_rates.operational_h, rate_labor_h = v_rates.labor_h,
         cost_material = v_material_total, cost_energy = v_energy, cost_depreciation = v_dep, cost_operational = v_op,
         cost_total = v_material_total + v_energy + v_dep + v_op,
         cost_scrap = round(v_scrap_total, 2)
   where id = v_job.id;

  -- Falhas viram despesa de produção do mês (RN-09, RN-26).
  perform private.post_result(v_on, '2.6', -v_scrap_total, 'print_job', v_job.id,
    case when p_total_failure then 'Impressão com falha total — ' || v_job.code else 'Peças com falha — ' || v_job.code end);

  -- 5. Saídas sem pós-processamento na ficha são liberadas na hora (RN-10).
  for v_out in
    select o.* from public.print_job_outputs o
    where o.print_job_id = v_job.id and o.status = 'AGUARDANDO_ACABAMENTO' and not o.needs_finishing
    order by o.sort_order, o.id
  loop
    v_auto := v_auto || private.release_output_core(v_out.id, v_out.qty_good, null, false, v_finished);
  end loop;

  return jsonb_build_object('print_job_id', v_job.id, 'code', v_job.code, 'minutes', v_minutes, 'time_estimated', v_estimated,
    'rate_mode', v_rates.mode, 'cost_total', v_material_total + v_energy + v_dep + v_op, 'cost_scrap', round(v_scrap_total, 2),
    'released', v_auto);
end;
$$;

create or replace function public.start_print_job(p_request_id uuid, p_print_job_id bigint, p_started_at timestamptz default null, p_confirm_shortage boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_job public.print_jobs;
  v_short text;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'start_print_job');
  if v_done is not null then
    return v_done;
  end if;
  select * into v_job from public.print_jobs j where j.id = p_print_job_id for update;
  if v_job.id is null or v_job.status <> 'PLANEJADA' then
    raise exception 'Só impressões planejadas podem ser iniciadas.' using errcode = '22023';
  end if;
  select string_agg(i.name, ', ') into v_short
  from public.print_job_materials m join public.items i on i.id = m.item_id
  join public.stock_balances b on b.item_id = m.item_id
  where m.print_job_id = v_job.id and b.qty_on_hand - b.qty_reserved < m.est_g;
  if v_short is not null and not p_confirm_shortage then
    raise exception 'Material insuficiente para esta impressão: %. Confirme para iniciar mesmo assim.', v_short
      using errcode = 'P0001', hint = 'confirmacao_necessaria';
  end if;
  update public.print_jobs set status = 'IMPRIMINDO', started_at = coalesce(p_started_at, now()) where id = v_job.id;
  perform private.audit('UPDATE', 'print_job', v_job.id, v_job.code, 'Impressão iniciada', '{}'::jsonb);
  return private.idem_finish(p_request_id, jsonb_build_object('print_job_id', v_job.id,
    'expected_end', coalesce(p_started_at, now()) + make_interval(mins => v_job.est_minutes)));
end;
$$;

create or replace function public.cancel_print_job(p_request_id uuid, p_print_job_id bigint, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_job public.print_jobs;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'cancel_print_job');
  if v_done is not null then
    return v_done;
  end if;
  select * into v_job from public.print_jobs j where j.id = p_print_job_id for update;
  if v_job.id is null or v_job.status not in ('PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO') then
    raise exception 'Só impressões que ainda não foram concluídas podem ser canceladas. Concluídas são estornadas.' using errcode = '22023';
  end if;
  update public.print_jobs set status = 'CANCELADA', notes = left(concat_ws(' · ', notes, nullif(btrim(coalesce(p_reason, '')), '')), 1000)
   where id = v_job.id;
  perform private.audit('CANCEL', 'print_job', v_job.id, v_job.code, 'Impressão cancelada' || coalesce(': ' || nullif(btrim(p_reason), ''), ''), '{}'::jsonb);
  return private.idem_finish(p_request_id, jsonb_build_object('print_job_id', v_job.id));
end;
$$;

create or replace function private.refresh_order_status(p_order_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
  v_status text;
  v_pending boolean;
  v_all_delivered boolean;
  v_production boolean;
begin
  select * into v_order from public.sales_orders o where o.id = p_order_id;
  if v_order.status in ('RASCUNHO', 'CANCELADO', 'ENTREGUE') then
    return v_order.status;
  end if;
  select bool_and(l.qty_delivered >= l.qty) into v_all_delivered from public.sales_order_lines l where l.order_id = p_order_id and l.item_id is not null;
  select bool_or(l.qty_reserved + l.qty_delivered < l.qty) into v_pending from public.sales_order_lines l where l.order_id = p_order_id and l.item_id is not null;
  v_production := exists (select 1 from public.print_jobs j where j.sales_order_id = p_order_id and j.status in ('PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO'))
               or exists (select 1 from public.print_job_outputs o join public.print_jobs j on j.id = o.print_job_id
                          where j.sales_order_id = p_order_id and o.status = 'AGUARDANDO_ACABAMENTO');
  v_status := case
    when coalesce(v_all_delivered, false) then 'ENTREGUE'
    when not coalesce(v_pending, false) then 'PRONTO'
    when v_production then 'EM_PRODUCAO'
    else 'CONFIRMADO' end;
  update public.sales_orders set status = v_status where id = p_order_id and status <> v_status;
  return v_status;
end;
$$;

create or replace function public.value_path(p_from date, p_to date)
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
    from public.print_job_outputs o join public.print_jobs j on j.id = o.print_job_id where j.status in ('IMPRIMINDO', 'ACABAMENTO')
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

create or replace function public.dashboard_alerts()
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

create or replace function public.month_close_checklist(p_month date)
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
    'open_print_jobs', (select count(*) from public.print_jobs j where j.status in ('PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO') and private.local_date(coalesce(j.started_at, j.planned_for)) <= v_end),
    'outputs_in_finishing', (select count(*) from public.print_job_outputs o where o.status = 'AGUARDANDO_ACABAMENTO'),
    'purchases_not_received', (select count(*) from public.purchases p where p.status in ('CONFIRMADA', 'RECEBIDA_PARCIAL') and p.purchased_at <= v_end),
    'overdue_installments', (select count(*) from public.installments i where i.status = 'ABERTA' and i.due_date <= v_end),
    'draft_purchases', (select count(*) from public.purchases p where p.status = 'RASCUNHO' and p.purchased_at <= v_end),
    'stock_ok', (public.check_stock_integrity() ->> 'ok')::boolean
  );
end;
$$;

create or replace view public.v_equipment as
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
  (select string_agg(j.code, ', ' order by j.code) from public.print_jobs j where j.equipment_id = e.id and j.status = 'IMPRIMINDO') as printing_code,
  case when private.can_view_costs() then e.acquisition_cost end as acquisition_cost,
  case when private.can_view_costs() then e.residual_value end as residual_value,
  case when private.can_view_costs() then round(coalesce(u.depreciation, 0), 2) end as accumulated_depreciation,
  case when private.can_view_costs() then e.acquisition_cost - round(coalesce(u.depreciation, 0), 2) end as book_value
from public.equipment e
left join usage u on u.equipment_id = e.id
left join maint mt on mt.equipment_id = e.id
where private.is_member();

-- Volta uma impressão concluída (ou com falha) para uma etapa do quadro: solta as reservas
-- que a liberação fez para encomendas, estorna estoque e resultado (reverse_print_job) e
-- limpa os números apurados, para concluir de novo depois.
create function private.reopen_print_job(p_job_id bigint, p_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
begin
  for v_res in
    select r.* from public.reservations r
    join public.print_job_outputs o on o.id = r.print_job_output_id
    where o.print_job_id = p_job_id and r.status = 'ATIVA'
    for update of r
  loop
    update public.reservations set status = 'CANCELADA', released_at = now() where id = v_res.id;
    update public.sales_order_lines set qty_reserved = qty_reserved - v_res.qty where id = v_res.order_line_id;
    update public.stock_balances set qty_reserved = qty_reserved - v_res.qty where item_id = v_res.item_id;
  end loop;
  perform public.reverse_print_job(gen_random_uuid(), p_job_id,
    'Voltou no quadro para ' || case p_to when 'PLANEJADA' then 'Planejada' when 'IMPRIMINDO' then 'Imprimindo' else 'Acabamento' end);
  update public.print_job_outputs
     set qty_good = null, qty_failed = null, qty_released = null, qty_rejected = 0, failure_reason = null, reject_reason = null,
         allocation_share = null, alloc_material = 0, alloc_energy = 0, alloc_depreciation = 0, alloc_operational = 0,
         good_material = 0, good_energy = 0, good_depreciation = 0, good_operational = 0,
         scrap_cost = 0, components_cost = 0, labor_cost = 0,
         unit_material = null, unit_energy = null, unit_depreciation = null, unit_operational = null, unit_labor = null, unit_total = null,
         status = null, needs_finishing = false, released_at = null
   where print_job_id = p_job_id;
  update public.print_job_materials set actual_g = null, cost_total = null, unit_cost_snapshot = null, movement_ids = '{}'
   where print_job_id = p_job_id;
  update public.print_jobs
     set status = p_to, finished_at = null, actual_minutes = null, time_estimated = false,
         started_at = case when p_to = 'PLANEJADA' then null else started_at end,
         failure_reason = null, failure_notes = null, reversed_at = null, reverse_reason = null,
         rate_mode = null, rate_ids = '{}', missing_rates = false,
         rate_energy_h = 0, rate_depreciation_h = 0, rate_operational_h = 0, rate_labor_h = 0,
         cost_material = 0, cost_energy = 0, cost_depreciation = 0, cost_operational = 0, cost_labor = 0, cost_total = 0, cost_scrap = 0
   where id = p_job_id;
end;
$$;

-- Move o card no quadro. Entre Planejada, Imprimindo e Acabamento é só a etapa (nada de
-- estoque ou custo). De Concluída/Falhou para trás desfaz a conclusão (só o dono, como estorno).
create function public.move_print_job(p_request_id uuid, p_print_job_id bigint, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_job public.print_jobs;
begin
  perform private.assert_production();
  if p_to is null or p_to not in ('PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO') then
    raise exception 'Etapa inválida.' using errcode = '22023';
  end if;
  v_done := private.idem_begin(p_request_id, 'move_print_job');
  if v_done is not null then
    return v_done;
  end if;
  select * into v_job from public.print_jobs j where j.id = p_print_job_id for update;
  if v_job.id is null then
    raise exception 'Impressão não encontrada.' using errcode = '22023';
  end if;
  if v_job.status in ('PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO') then
    if v_job.status <> p_to then
      update public.print_jobs
         set status = p_to,
             started_at = case when p_to = 'PLANEJADA' then null else coalesce(started_at, now()) end
       where id = v_job.id;
    end if;
  elsif v_job.status in ('CONCLUIDA', 'FALHOU') then
    perform private.assert_owner();
    perform private.reopen_print_job(v_job.id, p_to);
  else
    raise exception 'Impressão % está %: não volta para o quadro.', v_job.code, lower(v_job.status) using errcode = '22023';
  end if;
  perform private.audit('UPDATE', 'print_job', v_job.id, v_job.code, format('Quadro: %s → %s', v_job.status, p_to), '{}'::jsonb);
  if v_job.sales_order_id is not null then
    perform private.refresh_order_status(v_job.sales_order_id);
  end if;
  return private.idem_finish(p_request_id, jsonb_build_object('print_job_id', v_job.id, 'from', v_job.status, 'to', p_to));
end;
$$;

-- Arrastar para Concluída: baixa o filamento previsto, lança o custo pelo tempo da ficha,
-- considera todas as peças boas e libera tudo no estoque (com montagem de componentes).
-- Falhas ou gramas diferentes: use finish_print_job ("Concluir com ajustes").
create function public.complete_print_job(p_request_id uuid, p_print_job_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_job public.print_jobs;
  v_materials jsonb;
  v_outputs jsonb;
  v_result jsonb;
  v_out public.print_job_outputs;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'complete_print_job');
  if v_done is not null then
    return v_done;
  end if;
  select * into v_job from public.print_jobs j where j.id = p_print_job_id for update;
  if v_job.id is null or v_job.status not in ('PLANEJADA', 'IMPRIMINDO', 'ACABAMENTO') then
    raise exception 'Só impressões do quadro que ainda não foram concluídas podem ser concluídas.' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('item_id', m.item_id, 'actual_g', m.est_g, 'lot_id', m.lot_id) order by m.id)
    into v_materials
  from public.print_job_materials m where m.print_job_id = v_job.id and m.est_g > 0;
  if v_materials is null then
    raise exception 'A impressão % não tem filamento previsto. Use "Concluir com ajustes" e informe os gramas.', v_job.code using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('output_id', o.id, 'qty_good', o.qty_planned, 'qty_failed', 0) order by o.sort_order, o.id)
    into v_outputs
  from public.print_job_outputs o where o.print_job_id = v_job.id;
  v_result := private.close_print_job(v_job.id, now(), null, v_materials, v_outputs, false, null, null);
  for v_out in
    select o.* from public.print_job_outputs o
    where o.print_job_id = v_job.id and o.status = 'AGUARDANDO_ACABAMENTO' order by o.sort_order, o.id
  loop
    perform private.release_output_core(v_out.id, v_out.qty_good, null, false, now());
  end loop;
  perform private.audit('UPDATE', 'print_job', v_job.id, v_job.code, 'Quadro: concluída pela ficha', '{}'::jsonb);
  if v_job.sales_order_id is not null then
    perform private.refresh_order_status(v_job.sales_order_id);
  end if;
  return private.idem_finish(p_request_id, v_result);
end;
$$;

select private.apply_grants();
