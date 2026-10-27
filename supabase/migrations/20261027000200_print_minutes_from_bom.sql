-- Tempo de máquina da impressão: o horário em que o cartão ficou no quadro não é tempo de
-- máquina (um cartão pode ficar "imprimindo" de um dia para o outro). Sem minutos informados,
-- o custo operacional usa o tempo previsto pela ficha técnica (est_minutes) e marca
-- "tempo estimado" — nunca finished_at - started_at.

-- Consome o filamento e calcula/rateia os custos da impressão (RN-06 a RN-09).
-- p_outputs: [{output_id, qty_good, qty_failed, failure_reason}] — com p_total_failure, todas falham.
-- p_materials: [{item_id, actual_g, lot_id?, per_output?: {"<output_id>": gramas}}]
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
  if v_job.status not in ('PLANEJADA', 'IMPRIMINDO') then
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

select private.apply_grants();
