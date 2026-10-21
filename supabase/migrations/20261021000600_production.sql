-- =============================================================================
-- Wabee — 0600 Produção e impressões (Módulo 5, seções 4.7 e 11)
--
-- A impressão (mesa) consome tempo de máquina e filamento; suas saídas são as
-- variações produzidas. Ao finalizar, informa-se só o que aconteceu (tempo,
-- gramas, boas e falhas) e o banco baixa o material, calcula e rateia os custos
-- (RN-07, RN-08), registra as falhas (RN-09) e coloca as peças em acabamento ou
-- no estoque (RN-10). Custos alocados com 6 casas; totais em dinheiro com 2.
-- =============================================================================

create table public.print_jobs (
  id bigint generated always as identity primary key,
  code text not null unique,
  equipment_id bigint not null references public.equipment (id),
  status text not null default 'PLANEJADA' check (status in ('PLANEJADA', 'IMPRIMINDO', 'CONCLUIDA', 'FALHOU', 'CANCELADA', 'ESTORNADA')),
  planned_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  est_minutes integer not null default 0 check (est_minutes >= 0),
  actual_minutes integer check (actual_minutes is null or actual_minutes >= 0),
  time_estimated boolean not null default false,
  sales_order_id bigint,
  slicer_import_id bigint,
  failure_reason text check (failure_reason in (
    'DESCOLOU_MESA', 'ENTUPIMENTO', 'FALTA_FILAMENTO', 'QUEDA_ENERGIA', 'ERRO_MODELO', 'UMIDADE', 'CAMADA_DESLOCADA', 'DEFEITO_ACABAMENTO', 'OUTRO'
  )),
  failure_notes text,
  rate_mode text,
  rate_ids bigint[] not null default '{}',
  rate_energy_h numeric(16,6) not null default 0,
  rate_depreciation_h numeric(16,6) not null default 0,
  rate_operational_h numeric(16,6) not null default 0,
  rate_labor_h numeric(16,6) not null default 0,
  cost_material numeric(14,2) not null default 0,
  cost_energy numeric(14,2) not null default 0,
  cost_depreciation numeric(14,2) not null default 0,
  cost_operational numeric(14,2) not null default 0,
  cost_labor numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  cost_scrap numeric(14,2) not null default 0,
  missing_rates boolean not null default false,
  replanned_from_id bigint references public.print_jobs (id),
  notes text check (notes is null or char_length(notes) <= 1000),
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index print_jobs_status_idx on public.print_jobs (status, planned_for);
create index print_jobs_equipment_idx on public.print_jobs (equipment_id, finished_at);
create unique index print_jobs_one_printing on public.print_jobs (equipment_id) where status = 'IMPRIMINDO';
create trigger print_jobs_touch before update on public.print_jobs for each row execute function private.touch_updated_at();

comment on column public.print_jobs.time_estimated is 'Tempo real não informado: usou o estimado (RN-07).';
comment on column public.print_jobs.missing_rates is 'Sem taxa operacional vigente na data: custo operacional gravado como zero (RN-06).';

create table public.print_job_outputs (
  id bigint generated always as identity primary key,
  print_job_id bigint not null references public.print_jobs (id),
  variant_id bigint not null references public.product_variants (id),
  bom_version_id bigint references public.bom_versions (id),
  qty_planned integer not null check (qty_planned > 0),
  qty_good integer check (qty_good >= 0),
  qty_failed integer check (qty_failed >= 0),
  qty_released integer check (qty_released >= 0),
  qty_rejected integer not null default 0 check (qty_rejected >= 0),
  est_weight_g_per_unit numeric(14,3),
  allocation_share numeric(9,8),
  alloc_material numeric(16,6) not null default 0,
  alloc_energy numeric(16,6) not null default 0,
  alloc_depreciation numeric(16,6) not null default 0,
  alloc_operational numeric(16,6) not null default 0,
  good_material numeric(16,6) not null default 0,
  good_energy numeric(16,6) not null default 0,
  good_depreciation numeric(16,6) not null default 0,
  good_operational numeric(16,6) not null default 0,
  scrap_cost numeric(16,6) not null default 0,
  components_cost numeric(16,6) not null default 0,
  labor_cost numeric(16,6) not null default 0,
  unit_material numeric(16,6),
  unit_energy numeric(16,6),
  unit_depreciation numeric(16,6),
  unit_operational numeric(16,6),
  unit_labor numeric(16,6),
  unit_total numeric(16,6),
  failure_reason text,
  status text check (status in ('AGUARDANDO_ACABAMENTO', 'LIBERADA')),
  needs_finishing boolean not null default false,
  released_at timestamptz,
  reject_reason text,
  sort_order integer not null default 0,
  check (qty_good is null or qty_failed is null or qty_good + qty_failed = qty_planned),
  check (qty_released is null or qty_released + qty_rejected = qty_good)
);

create index print_job_outputs_job_idx on public.print_job_outputs (print_job_id);
create index print_job_outputs_variant_idx on public.print_job_outputs (variant_id, status);

create table public.print_job_materials (
  id bigint generated always as identity primary key,
  print_job_id bigint not null references public.print_jobs (id),
  item_id bigint not null references public.items (id),
  lot_id bigint references public.stock_lots (id),
  est_g numeric(14,3) not null default 0 check (est_g >= 0),
  actual_g numeric(14,3) check (actual_g is null or actual_g >= 0),
  unit_cost_snapshot numeric(16,6),
  cost_total numeric(14,2),
  movement_ids bigint[] not null default '{}'
);

create index print_job_materials_job_idx on public.print_job_materials (print_job_id);

create table public.post_process_entries (
  id bigint generated always as identity primary key,
  output_id bigint not null references public.print_job_outputs (id),
  performed_at timestamptz not null default now(),
  minutes integer not null check (minutes > 0),
  kind text not null check (kind in ('REMOCAO_SUPORTE', 'LIXA', 'PINTURA', 'MONTAGEM', 'INSPECAO')),
  labor_rate numeric(16,6) not null default 0,
  labor_cost numeric(16,6) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index post_process_entries_output_idx on public.post_process_entries (output_id);

-- -----------------------------------------------------------------------------
-- Cálculos
-- -----------------------------------------------------------------------------

-- Rateio de um custo (6 casas) por pesos; a última posição recebe a diferença de
-- arredondamento para que a soma seja exatamente o total (RN-08, RN-25).
create function private.allocate_cost(p_total numeric, p_weights numeric[])
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum numeric := 0;
  v_n integer := coalesce(array_length(p_weights, 1), 0);
  v_result numeric[] := '{}';
  v_used numeric := 0;
  v_value numeric;
begin
  if v_n = 0 then
    return v_result;
  end if;
  for i in 1..v_n loop
    v_sum := v_sum + coalesce(p_weights[i], 0);
  end loop;
  for i in 1..v_n loop
    if i = v_n then
      v_value := round(p_total, 6) - v_used;
    elsif v_sum = 0 then
      v_value := round(p_total / v_n, 6);
    else
      v_value := round(p_total * coalesce(p_weights[i], 0) / v_sum, 6);
    end if;
    v_result := v_result || v_value;
    v_used := v_used + v_value;
  end loop;
  return v_result;
end;
$$;

-- Gramas de filamento por unidade na ficha (modelo + suporte + purga, com desperdício).
create function private.bom_grams_per_unit(p_bom_id bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.qty_per_unit * (1 + l.waste_pct)), 0)
  from public.bom_lines l where l.bom_version_id = p_bom_id and l.line_kind like 'FILAMENT_%';
$$;

-- A saída precisa de acabamento quando a ficha tem minutos de pós-processamento ou
-- componentes/consumíveis montados depois da impressão (RN-10).
create function private.output_needs_finishing(p_bom_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_bom_id is not null and (
    exists (select 1 from public.bom_versions b where b.id = p_bom_id and b.est_post_process_minutes_per_unit > 0)
    or exists (select 1 from public.bom_lines l where l.bom_version_id = p_bom_id and l.consumed_at = 'ASSEMBLY')
  );
$$;

-- Detalhes do planejamento (US-5.1, US-5.2): preenche gramas e minutos pelas fichas ativas,
-- verifica materiais e estima o custo por camada e por saída. Não grava nada.
-- p_job: {equipment_id, planned_for, est_minutes?, outputs: [{variant_id, qty_planned, est_weight_g_per_unit?}],
--         materials?: [{item_id, est_g, lot_id?}]}
create function private.plan_details(p_job jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_equipment public.equipment;
  v_output jsonb;
  v_variant record;
  v_bom public.bom_versions;
  v_qty integer;
  v_weight numeric;
  v_minutes numeric := 0;
  v_missing_bom text[] := '{}';
  v_outputs jsonb := '[]'::jsonb;
  v_materials jsonb := '{}'::jsonb;
  v_components jsonb := '{}'::jsonb;
  v_line record;
  v_mat jsonb;
  v_list jsonb := '[]'::jsonb;
  v_comp_list jsonb := '[]'::jsonb;
  v_warnings text[] := '{}';
  v_key text;
  v_needed numeric;
  v_bal public.stock_balances;
  v_open record;
  v_cost record;
  v_material_cost numeric := 0;
  v_rates public.rate_set;
  v_on date;
  v_est_minutes numeric;
  v_hours numeric;
  v_weights numeric[] := '{}';
  v_alloc numeric[];
  v_alloc_op numeric[];
  v_shortage boolean := false;
  v_item_name text;
  v_show_costs boolean := private.can_view_costs();
  v_i integer := 0;
begin
  select * into v_equipment from public.equipment e where e.id = (p_job ->> 'equipment_id')::bigint;
  if v_equipment.id is null or v_equipment.kind <> 'PRINTER' then
    raise exception 'Escolha uma impressora.' using errcode = '22023';
  end if;
  if v_equipment.status <> 'ATIVO' then
    raise exception 'A impressora "%" está % e não recebe novas impressões.', v_equipment.name,
      case v_equipment.status when 'MANUTENCAO' then 'em manutenção' else 'baixada' end using errcode = '22023';
  end if;
  if jsonb_typeof(p_job -> 'outputs') is distinct from 'array' or jsonb_array_length(p_job -> 'outputs') = 0 then
    raise exception 'Adicione ao menos uma variação à impressão.' using errcode = '22023';
  end if;
  v_on := coalesce(private.local_date(nullif(p_job ->> 'planned_for', '')::timestamptz), private.today());

  for v_output in select * from jsonb_array_elements(p_job -> 'outputs') loop
    select v.id, v.name, v.active, p.name as product_name into v_variant
    from public.product_variants v join public.products p on p.id = v.product_id where v.id = (v_output ->> 'variant_id')::bigint;
    if v_variant.id is null then
      raise exception 'Variação não encontrada.' using errcode = '22023';
    end if;
    if not v_variant.active then
      raise exception 'A variação "% — %" está desativada.', v_variant.product_name, v_variant.name using errcode = '22023';
    end if;
    v_qty := (v_output ->> 'qty_planned')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantidade planejada inválida para "% — %".', v_variant.product_name, v_variant.name using errcode = '22023';
    end if;
    v_bom := private.active_bom(v_variant.id);
    v_weight := coalesce(nullif(v_output ->> 'est_weight_g_per_unit', '')::numeric, case when v_bom.id is not null then private.bom_grams_per_unit(v_bom.id) end);
    if v_bom.id is null then
      v_missing_bom := v_missing_bom || (v_variant.product_name || ' — ' || v_variant.name);
    else
      v_minutes := v_minutes + v_qty::numeric / v_bom.units_per_plate * v_bom.est_print_minutes_per_plate;
      if v_qty > v_bom.units_per_plate then
        v_warnings := v_warnings || format('%s unidades de "%s — %s" passam do que cabe numa mesa (%s): considere dividir em mais mesas.',
          v_qty, v_variant.product_name, v_variant.name, v_bom.units_per_plate);
      end if;
      for v_line in select l.* from public.bom_lines l where l.bom_version_id = v_bom.id loop
        v_needed := v_qty * v_line.qty_per_unit * (1 + v_line.waste_pct);
        if v_line.consumed_at = 'PRODUCTION' then
          v_materials := jsonb_set(v_materials, array[v_line.item_id::text],
            to_jsonb(coalesce((v_materials ->> v_line.item_id::text)::numeric, 0) + v_needed));
        elsif v_line.consumed_at = 'ASSEMBLY' then
          v_components := jsonb_set(v_components, array[v_line.item_id::text],
            to_jsonb(coalesce((v_components ->> v_line.item_id::text)::numeric, 0) + v_needed));
        end if;
      end loop;
    end if;
    v_weights := v_weights || coalesce(v_weight * v_qty, null);
    v_outputs := v_outputs || jsonb_build_object('variant_id', v_variant.id, 'variant_name', v_variant.product_name || ' — ' || v_variant.name,
      'qty_planned', v_qty, 'bom_version_id', v_bom.id, 'est_weight_g_per_unit', round(v_weight, 3),
      'needs_finishing', private.output_needs_finishing(v_bom.id));
  end loop;

  -- Materiais informados na tela substituem os da ficha.
  if jsonb_typeof(p_job -> 'materials') = 'array' and jsonb_array_length(p_job -> 'materials') > 0 then
    v_materials := '{}'::jsonb;
    for v_mat in select * from jsonb_array_elements(p_job -> 'materials') loop
      v_materials := jsonb_set(v_materials, array[(v_mat ->> 'item_id')],
        to_jsonb(coalesce((v_materials ->> (v_mat ->> 'item_id'))::numeric, 0) + coalesce((v_mat ->> 'est_g')::numeric, 0)));
    end loop;
  elsif cardinality(v_missing_bom) > 0 then
    raise exception 'Sem ficha técnica ativa para: %. Informe gramas e minutos manualmente.', array_to_string(v_missing_bom, ', ')
      using errcode = '22023', hint = 'sem_ficha';
  end if;
  v_est_minutes := coalesce(nullif(p_job ->> 'est_minutes', '')::numeric, round(v_minutes));
  if v_est_minutes <= 0 and cardinality(v_missing_bom) > 0 then
    raise exception 'Informe os minutos estimados da impressão.' using errcode = '22023';
  end if;

  -- Verificação de materiais (US-5.2).
  for v_key in select jsonb_object_keys(v_materials) loop
    v_needed := round((v_materials ->> v_key)::numeric, 3);
    select i.name into v_item_name from public.items i where i.id = v_key::bigint;
    select * into v_bal from public.stock_balances b where b.item_id = v_key::bigint;
    select l.id, l.lot_code, l.qty_remaining into v_open from public.stock_lots l
    where l.item_id = v_key::bigint and l.qty_remaining > 0 and l.status in ('ABERTO', 'FECHADO')
    order by (l.status = 'ABERTO') desc, l.opened_at nulls last, l.received_at, l.id limit 1;
    select * into v_cost from private.item_estimate_cost(v_key::bigint);
    v_material_cost := v_material_cost + v_needed * v_cost.unit_cost;
    if coalesce(v_bal.qty_on_hand - v_bal.qty_reserved, 0) < v_needed then
      v_shortage := true;
      v_warnings := v_warnings || format('Falta %s: necessário %s g, disponível %s g.', v_item_name, private.fmt_num(v_needed),
        private.fmt_num(greatest(coalesce(v_bal.qty_on_hand - v_bal.qty_reserved, 0), 0)));
    elsif v_open.id is not null and v_open.qty_remaining < v_needed then
      v_warnings := v_warnings || format('O carretel %s de %s tem %s g: vai trocar de carretel no meio da impressão.',
        v_open.lot_code, v_item_name, private.fmt_num(v_open.qty_remaining));
    end if;
    v_list := v_list || jsonb_build_object('item_id', v_key::bigint, 'item_name', v_item_name, 'needed_g', v_needed,
      'available_g', coalesce(v_bal.qty_on_hand - v_bal.qty_reserved, 0), 'lot_id', v_open.id, 'lot_code', v_open.lot_code,
      'lot_remaining_g', v_open.qty_remaining,
      'unit_cost', case when v_show_costs then v_cost.unit_cost end, 'estimated', v_cost.is_reference);
  end loop;
  for v_key in select jsonb_object_keys(v_components) loop
    v_needed := round((v_components ->> v_key)::numeric, 3);
    select i.name into v_item_name from public.items i where i.id = v_key::bigint;
    select * into v_bal from public.stock_balances b where b.item_id = v_key::bigint;
    if coalesce(v_bal.qty_on_hand - v_bal.qty_reserved, 0) < v_needed then
      v_warnings := v_warnings || format('Para a montagem faltam %s: necessário %s, disponível %s.', v_item_name, private.fmt_num(v_needed),
        private.fmt_num(greatest(coalesce(v_bal.qty_on_hand - v_bal.qty_reserved, 0), 0)));
    end if;
    v_comp_list := v_comp_list || jsonb_build_object('item_id', v_key::bigint, 'item_name', v_item_name, 'needed', v_needed,
      'available', coalesce(v_bal.qty_on_hand - v_bal.qty_reserved, 0));
  end loop;

  -- Custo previsto (RN-07) e rateio por saída (RN-08).
  v_rates := public.get_rates(v_equipment.id, v_on);
  v_hours := v_est_minutes / 60.0;
  if exists (select 1 from unnest(v_weights) w where w is null) then
    v_weights := array(select (o ->> 'qty_planned')::numeric from jsonb_array_elements(v_outputs) o);
  end if;
  v_alloc := private.allocate_cost(v_material_cost, v_weights);
  v_alloc_op := private.allocate_cost(v_hours * (v_rates.energy_h + v_rates.depreciation_h + v_rates.operational_h), v_weights);
  if v_show_costs then
    v_outputs := (select coalesce(jsonb_agg(o || jsonb_build_object(
        'est_material', round(v_alloc[x.n], 6), 'est_operational', round(v_alloc_op[x.n], 6),
        'est_unit_cost', round((v_alloc[x.n] + v_alloc_op[x.n]) / (o ->> 'qty_planned')::numeric, 6)) order by x.n), '[]'::jsonb)
      from jsonb_array_elements(v_outputs) with ordinality as x(o, n));
  end if;

  return jsonb_build_object(
    'equipment_id', v_equipment.id, 'equipment_name', v_equipment.name, 'est_minutes', v_est_minutes,
    'outputs', v_outputs, 'materials', v_list, 'components', v_comp_list, 'warnings', to_jsonb(v_warnings), 'shortage', v_shortage,
    'rate_mode', v_rates.mode,
    'cost', case when v_show_costs then jsonb_build_object(
      'material', round(v_material_cost, 2),
      'energy', round(v_hours * v_rates.energy_h, 2),
      'depreciation', round(v_hours * v_rates.depreciation_h, 2),
      'operational', round(v_hours * v_rates.operational_h, 2),
      'total', round(v_material_cost, 2) + round(v_hours * v_rates.energy_h, 2) + round(v_hours * v_rates.depreciation_h, 2) + round(v_hours * v_rates.operational_h, 2)
    ) end
  );
end;
$$;

create function public.preview_print_job(p_job jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_production();
  return private.plan_details(p_job);
end;
$$;

-- -----------------------------------------------------------------------------
-- Liberação de uma saída para o estoque (RN-09, RN-10)
-- -----------------------------------------------------------------------------

create function private.release_output_core(
  p_output_id bigint,
  p_qty_approved integer,
  p_reject_reason text,
  p_rejected_assembled boolean,
  p_released_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out public.print_job_outputs;
  v_job public.print_jobs;
  v_variant public.product_variants;
  v_bom_line record;
  v_approved integer := p_qty_approved;
  v_rejected integer;
  v_rej private.cost_layers := row(0, 0, 0, 0, 0)::private.cost_layers;
  v_rej_total numeric := 0;
  v_comp numeric := 0;
  v_issue private.issue_result;
  v_labor numeric := 0;
  v_mv public.stock_movements;
  v_unit private.cost_layers;
  v_on date;
  v_label text;
  v_movements bigint[] := '{}';
  v_id bigint;
  v_loss public.stock_movements;
begin
  select * into v_out from public.print_job_outputs o where o.id = p_output_id for update;
  if v_out.id is null then
    raise exception 'Saída de impressão não encontrada.' using errcode = '22023';
  end if;
  if v_out.status is distinct from 'AGUARDANDO_ACABAMENTO' then
    raise exception 'Esta saída não está aguardando acabamento.' using errcode = '22023';
  end if;
  select * into v_job from public.print_jobs j where j.id = v_out.print_job_id;
  select * into v_variant from public.product_variants v where v.id = v_out.variant_id;
  if v_approved is null then
    v_approved := v_out.qty_good;
  end if;
  if v_approved < 0 or v_approved > v_out.qty_good then
    raise exception 'A quantidade aprovada deve ficar entre 0 e % (peças boas da impressão).', v_out.qty_good using errcode = '22023';
  end if;
  v_rejected := v_out.qty_good - v_approved;
  if v_rejected > 0 and char_length(btrim(coalesce(p_reject_reason, ''))) < 3 then
    raise exception 'Informe o motivo das peças reprovadas no acabamento.' using errcode = '22023';
  end if;
  v_on := private.local_date(p_released_at);
  v_label := v_job.code || ' — ' || (select p.name || ' — ' || v_variant.name from public.products p where p.id = v_variant.product_id);

  -- Peças reprovadas no acabamento: o custo de impressão delas vai para falhas.
  if v_rejected > 0 and v_out.qty_good > 0 then
    v_rej := row(round(v_out.good_material * v_rejected / v_out.qty_good, 6), round(v_out.good_energy * v_rejected / v_out.qty_good, 6),
                 round(v_out.good_depreciation * v_rejected / v_out.qty_good, 6), round(v_out.good_operational * v_rejected / v_out.qty_good, 6), 0)::private.cost_layers;
    v_rej_total := v_rej.material + v_rej.energy + v_rej.depreciation + v_rej.operational;
  end if;

  -- Componentes da montagem só para as unidades aprovadas (RN-09).
  for v_bom_line in
    select l.* from public.bom_lines l where l.bom_version_id = v_out.bom_version_id and l.consumed_at = 'ASSEMBLY' order by l.sort_order
  loop
    if v_approved > 0 then
      v_issue := private.issue_stock(v_bom_line.item_id, v_approved * v_bom_line.qty_per_unit * (1 + v_bom_line.waste_pct), 'ASSEMBLY_CONSUMPTION',
        p_released_at, 'print_job_output', v_out.id, null);
      v_comp := v_comp + v_issue.total_cost;
      v_movements := v_movements || v_issue.movement_ids;
    end if;
    if v_rejected > 0 and p_rejected_assembled then
      -- Componentes já montados nas peças reprovadas saem como perda.
      v_issue := private.issue_stock(v_bom_line.item_id, v_rejected * v_bom_line.qty_per_unit * (1 + v_bom_line.waste_pct), 'LOSS',
        p_released_at, 'print_job_output', v_out.id, 'Montado em peça reprovada: ' || btrim(p_reject_reason));
      foreach v_id in array v_issue.movement_ids loop
        select * into v_loss from public.stock_movements m where m.id = v_id;
        perform private.post_stock_result(v_loss, 'Componente perdido no acabamento — ' || v_label);
      end loop;
      v_movements := v_movements || v_issue.movement_ids;
    end if;
  end loop;

  -- Trabalho do pós-processamento dividido pelas unidades aprovadas.
  select coalesce(sum(e.labor_cost), 0) into v_labor from public.post_process_entries e where e.output_id = v_out.id;

  if v_approved > 0 then
    v_unit := row(
      round((v_out.good_material - v_rej.material + v_comp) / v_approved, 6),
      round((v_out.good_energy - v_rej.energy) / v_approved, 6),
      round((v_out.good_depreciation - v_rej.depreciation) / v_approved, 6),
      round((v_out.good_operational - v_rej.operational) / v_approved, 6),
      round(v_labor / v_approved, 6))::private.cost_layers;
    v_mv := private.post_movement(v_variant.item_id, 'PRODUCTION_OUTPUT', v_approved, p_released_at, v_unit, null,
      'print_job_output', v_out.id, null);
    v_movements := v_movements || v_mv.id;
  else
    -- Nada aprovado: o trabalho também se perde.
    v_rej_total := v_rej_total + v_labor;
  end if;

  if v_rej_total > 0 then
    perform private.post_result(v_on, '2.6', -v_rej_total, 'print_job_output', v_out.id,
      format('Reprovadas no acabamento (%s un) — %s — %s', v_rejected, v_label, coalesce(btrim(p_reject_reason), '')),
      null, v_variant.item_id);
  end if;

  update public.print_job_outputs o
     set status = 'LIBERADA', released_at = p_released_at, qty_released = v_approved, qty_rejected = v_rejected,
         reject_reason = nullif(btrim(coalesce(p_reject_reason, '')), ''),
         scrap_cost = o.scrap_cost + v_rej_total,
         components_cost = v_comp, labor_cost = v_labor,
         unit_material = v_unit.material, unit_energy = v_unit.energy, unit_depreciation = v_unit.depreciation,
         unit_operational = v_unit.operational, unit_labor = v_unit.labor,
         unit_total = v_unit.material + v_unit.energy + v_unit.depreciation + v_unit.operational + v_unit.labor
   where o.id = v_out.id;
  update public.print_jobs j
     set cost_scrap = j.cost_scrap + round(v_rej_total, 2), cost_labor = j.cost_labor + round(v_labor, 2)
   where j.id = v_job.id;
  return jsonb_build_object('output_id', v_out.id, 'qty_released', v_approved, 'qty_rejected', v_rejected,
    'unit_cost', case when v_approved > 0 then v_unit.material + v_unit.energy + v_unit.depreciation + v_unit.operational + v_unit.labor end,
    'movement_ids', to_jsonb(v_movements));
end;
$$;

-- Consome o filamento e calcula/rateia os custos da impressão (RN-06 a RN-09).
-- p_outputs: [{output_id, qty_good, qty_failed, failure_reason}] — com p_total_failure, todas falham.
-- p_materials: [{item_id, actual_g, lot_id?, per_output?: {"<output_id>": gramas}}]
create function private.close_print_job(
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
  if v_minutes is null and v_job.started_at is not null and not p_total_failure then
    v_minutes := greatest(round(extract(epoch from (v_finished - v_job.started_at)) / 60)::integer, 0);
  end if;
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

-- -----------------------------------------------------------------------------
-- RPCs públicas
-- -----------------------------------------------------------------------------

-- Planejar (US-5.1): sem efeito no estoque; grava saídas, gramas e minutos previstos.
create function public.plan_print_job(p_request_id uuid, p_job jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_details jsonb;
  v_id bigint;
  v_code text;
  v_output jsonb;
  v_mat jsonb;
  v_order integer := 0;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'plan_print_job');
  if v_done is not null then
    return v_done;
  end if;
  v_details := private.plan_details(p_job);
  v_code := private.next_doc_number('IMP');
  insert into public.print_jobs (code, equipment_id, planned_for, est_minutes, sales_order_id, notes, replanned_from_id)
  values (v_code, (v_details ->> 'equipment_id')::bigint, coalesce(nullif(p_job ->> 'planned_for', '')::timestamptz, now()),
          round((v_details ->> 'est_minutes')::numeric)::integer, nullif(p_job ->> 'sales_order_id', '')::bigint,
          nullif(btrim(coalesce(p_job ->> 'notes', '')), ''), nullif(p_job ->> 'replanned_from_id', '')::bigint)
  returning id into v_id;
  for v_output in select * from jsonb_array_elements(v_details -> 'outputs') loop
    v_order := v_order + 1;
    insert into public.print_job_outputs (print_job_id, variant_id, bom_version_id, qty_planned, est_weight_g_per_unit, needs_finishing, sort_order)
    values (v_id, (v_output ->> 'variant_id')::bigint, nullif(v_output ->> 'bom_version_id', '')::bigint, (v_output ->> 'qty_planned')::integer,
            nullif(v_output ->> 'est_weight_g_per_unit', '')::numeric, coalesce((v_output ->> 'needs_finishing')::boolean, false), v_order);
  end loop;
  for v_mat in select * from jsonb_array_elements(v_details -> 'materials') loop
    insert into public.print_job_materials (print_job_id, item_id, lot_id, est_g)
    values (v_id, (v_mat ->> 'item_id')::bigint, nullif(v_mat ->> 'lot_id', '')::bigint, (v_mat ->> 'needed_g')::numeric);
  end loop;
  perform private.audit('CREATE', 'print_job', v_id, v_code, 'Impressão planejada', jsonb_build_object('saidas', v_details -> 'outputs'));
  return private.idem_finish(p_request_id, jsonb_build_object('print_job_id', v_id, 'code', v_code, 'warnings', v_details -> 'warnings',
                                                              'shortage', v_details -> 'shortage'));
end;
$$;

-- Iniciar (US-5.3). Com falta de material, só com confirmação (US-5.2).
create function public.start_print_job(p_request_id uuid, p_print_job_id bigint, p_started_at timestamptz default null, p_confirm_shortage boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_job public.print_jobs;
  v_busy text;
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
  select j.code into v_busy from public.print_jobs j where j.equipment_id = v_job.equipment_id and j.status = 'IMPRIMINDO';
  if v_busy is not null then
    raise exception 'A impressora já está imprimindo %. Finalize-a antes.', v_busy using errcode = '22023';
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

-- Finalizar (US-5.4): tudo numa transação; faltando filamento, nada é gravado.
-- p_result: {finished_at, actual_minutes, materials: [...], outputs: [...]}
create function public.finish_print_job(p_request_id uuid, p_print_job_id bigint, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_result jsonb;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'finish_print_job');
  if v_done is not null then
    return v_done;
  end if;
  v_result := private.close_print_job(p_print_job_id, nullif(p_result ->> 'finished_at', '')::timestamptz,
    nullif(p_result ->> 'actual_minutes', '')::integer, p_result -> 'materials', p_result -> 'outputs', false, null, p_result ->> 'notes');
  perform private.audit('UPDATE', 'print_job', p_print_job_id, v_result ->> 'code', 'Impressão finalizada',
                        jsonb_build_object('custo', v_result -> 'cost_total', 'falhas', v_result -> 'cost_scrap'));
  return private.idem_finish(p_request_id, v_result);
end;
$$;

-- Falha total (US-5.5): o filamento é baixado e todo o custo vai para falhas.
create function public.fail_print_job(p_request_id uuid, p_print_job_id bigint, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_result jsonb;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'fail_print_job');
  if v_done is not null then
    return v_done;
  end if;
  if nullif(p_result ->> 'failure_reason', '') is null then
    raise exception 'Informe o motivo da falha.' using errcode = '22023';
  end if;
  v_result := private.close_print_job(p_print_job_id, nullif(p_result ->> 'finished_at', '')::timestamptz,
    nullif(p_result ->> 'actual_minutes', '')::integer, p_result -> 'materials', null, true, p_result ->> 'failure_reason', p_result ->> 'notes');
  perform private.audit('UPDATE', 'print_job', p_print_job_id, v_result ->> 'code', 'Impressão falhou: ' || (p_result ->> 'failure_reason'),
                        jsonb_build_object('custo_falha', v_result -> 'cost_scrap'));
  return private.idem_finish(p_request_id, v_result);
end;
$$;

-- "Replanejar" após falha / "Repetir" impressão concluída (US-5.5, US-5.9): usa as fichas ativas atuais.
create function public.replan_print_job(p_request_id uuid, p_print_job_id bigint, p_planned_for timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.print_jobs;
  v_outputs jsonb;
  v_avg integer;
begin
  perform private.assert_production();
  select * into v_job from public.print_jobs j where j.id = p_print_job_id;
  if v_job.id is null then
    raise exception 'Impressão não encontrada.' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('variant_id', o.variant_id, 'qty_planned', o.qty_planned) order by o.sort_order)
    into v_outputs from public.print_job_outputs o where o.print_job_id = v_job.id;
  -- Tempo real médio das impressões concluídas com as mesmas saídas como estimativa.
  select round(avg(j.actual_minutes))::integer into v_avg
  from public.print_jobs j
  where j.status = 'CONCLUIDA' and j.equipment_id = v_job.equipment_id and j.actual_minutes > 0
    and (select jsonb_agg(jsonb_build_object('variant_id', o.variant_id, 'qty_planned', o.qty_planned) order by o.sort_order)
         from public.print_job_outputs o where o.print_job_id = j.id) = v_outputs;
  return public.plan_print_job(p_request_id, jsonb_build_object(
    'equipment_id', v_job.equipment_id, 'planned_for', coalesce(p_planned_for, now()), 'outputs', v_outputs,
    'est_minutes', coalesce(v_avg, case when v_job.status = 'FALHOU' then v_job.est_minutes end),
    'sales_order_id', v_job.sales_order_id, 'replanned_from_id', v_job.id,
    'materials', case when exists (select 1 from public.print_job_outputs o where o.print_job_id = v_job.id and o.bom_version_id is null)
      then (select jsonb_agg(jsonb_build_object('item_id', m.item_id, 'est_g', m.est_g)) from public.print_job_materials m where m.print_job_id = v_job.id) end));
end;
$$;

create function public.cancel_print_job(p_request_id uuid, p_print_job_id bigint, p_reason text default null)
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
  if v_job.id is null or v_job.status not in ('PLANEJADA', 'IMPRIMINDO') then
    raise exception 'Só impressões planejadas ou em andamento podem ser canceladas. Concluídas são estornadas.' using errcode = '22023';
  end if;
  update public.print_jobs set status = 'CANCELADA', notes = left(concat_ws(' · ', notes, nullif(btrim(coalesce(p_reason, '')), '')), 1000)
   where id = v_job.id;
  perform private.audit('CANCEL', 'print_job', v_job.id, v_job.code, 'Impressão cancelada' || coalesce(': ' || nullif(btrim(p_reason), ''), ''), '{}'::jsonb);
  return private.idem_finish(p_request_id, jsonb_build_object('print_job_id', v_job.id));
end;
$$;

-- Acabamento (US-5.6): cada registro de minutos vira custo de trabalho (taxa vigente na data).
create function public.record_post_process(
  p_request_id uuid,
  p_output_id bigint,
  p_minutes integer,
  p_kind text,
  p_performed_at timestamptz default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_out public.print_job_outputs;
  v_at timestamptz := coalesce(p_performed_at, now());
  v_rate public.cost_rates;
  v_id bigint;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'record_post_process');
  if v_done is not null then
    return v_done;
  end if;
  select * into v_out from public.print_job_outputs o where o.id = p_output_id for update;
  if v_out.id is null or v_out.status is distinct from 'AGUARDANDO_ACABAMENTO' then
    raise exception 'Esta saída não está aguardando acabamento.' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'Informe os minutos de trabalho.' using errcode = '22023';
  end if;
  v_rate := private.rate_at('LABOR_PER_HOUR', null, private.local_date(v_at));
  insert into public.post_process_entries (output_id, performed_at, minutes, kind, labor_rate, labor_cost, notes)
  values (p_output_id, v_at, p_minutes, p_kind, coalesce(v_rate.value, 0), round(p_minutes / 60.0 * coalesce(v_rate.value, 0), 6),
          nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return private.idem_finish(p_request_id, jsonb_build_object('entry_id', v_id, 'labor_valued', v_rate.id is not null));
end;
$$;

-- Liberar (US-5.6): componentes baixados para as aprovadas e entrada no estoque com o custo final.
create function public.release_output(
  p_request_id uuid,
  p_output_id bigint,
  p_qty_approved integer default null,
  p_reject_reason text default null,
  p_rejected_assembled boolean default false,
  p_released_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_result jsonb;
  v_ref text;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'release_output');
  if v_done is not null then
    return v_done;
  end if;
  v_result := private.release_output_core(p_output_id, p_qty_approved, p_reject_reason, p_rejected_assembled, coalesce(p_released_at, now()));
  select j.code into v_ref from public.print_jobs j join public.print_job_outputs o on o.print_job_id = j.id where o.id = p_output_id;
  perform private.audit('UPDATE', 'print_job_output', p_output_id, v_ref, 'Peças liberadas para o estoque', v_result);
  return private.idem_finish(p_request_id, v_result);
end;
$$;

-- Estornar impressão (US-5.10, RN-21): reverte consumos, saídas e falhas numa transação.
-- Bloqueado se peças dela já foram entregues ou reservadas (estorne a venda antes).
create function public.reverse_print_job(p_request_id uuid, p_print_job_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_job public.print_jobs;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_out record;
  v_mv public.stock_movements;
  v_blocked text;
  v_operation uuid := gen_random_uuid();
  v_count integer := 0;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'reverse_print_job');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  select * into v_job from public.print_jobs j where j.id = p_print_job_id for update;
  if v_job.id is null or v_job.status not in ('CONCLUIDA', 'FALHOU') then
    raise exception 'Só impressões concluídas ou com falha podem ser estornadas.' using errcode = '22023';
  end if;
  -- As peças liberadas precisam estar livres no estoque.
  for v_out in
    select o.qty_released, i.name, b.qty_on_hand, b.qty_reserved
    from public.print_job_outputs o
    join public.product_variants v on v.id = o.variant_id
    join public.items i on i.id = v.item_id
    join public.stock_balances b on b.item_id = v.item_id
    where o.print_job_id = v_job.id and o.status = 'LIBERADA' and o.qty_released > 0
    for update of b
  loop
    if v_out.qty_on_hand - v_out.qty_reserved < v_out.qty_released then
      v_blocked := concat_ws(', ', v_blocked, v_out.name);
    end if;
  end loop;
  if v_blocked is not null then
    raise exception 'Peças desta impressão já foram entregues ou reservadas (%). Ajuste os pedidos antes de estornar.', v_blocked
      using errcode = '22023', hint = 'pecas_vendidas';
  end if;
  for v_mv in
    select m.* from public.stock_movements m
    where ((m.source_type = 'print_job' and m.source_id = v_job.id)
        or (m.source_type = 'print_job_output' and m.source_id in (select o.id from public.print_job_outputs o where o.print_job_id = v_job.id)))
      and m.type <> 'REVERSAL'
      and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id)
    order by m.id desc
  loop
    perform private.post_movement(v_mv.item_id, 'REVERSAL', -v_mv.qty, now(),
      row(v_mv.unit_cost_material, v_mv.unit_cost_energy, v_mv.unit_cost_depreciation, v_mv.unit_cost_operational, v_mv.unit_cost_labor)::private.cost_layers,
      v_mv.lot_id, v_mv.source_type, v_mv.source_id, v_reason, v_mv.id, 0, v_operation);
    v_count := v_count + 1;
  end loop;
  perform private.reverse_results('print_job', v_job.id, v_reason);
  for v_out in select o.id from public.print_job_outputs o where o.print_job_id = v_job.id loop
    perform private.reverse_results('print_job_output', v_out.id, v_reason);
  end loop;
  update public.print_jobs set status = 'ESTORNADA', reversed_at = now(), reverse_reason = v_reason where id = v_job.id;
  perform private.audit('REVERSE', 'print_job', v_job.id, v_job.code, 'Impressão estornada: ' || v_reason, jsonb_build_object('movimentos', v_count));
  return private.idem_finish(p_request_id, jsonb_build_object('print_job_id', v_job.id, 'reversed_movements', v_count));
end;
$$;

-- -----------------------------------------------------------------------------
-- Views de leitura. Produção vê quantidades; valores só para dono e leitura.
-- (Views com os privilégios do dono das tabelas, filtradas por private.is_member().)
-- -----------------------------------------------------------------------------

create view public.v_print_jobs as
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
  case when private.can_view_costs() then j.cost_scrap end as cost_scrap
from public.print_jobs j
join public.equipment e on e.id = j.equipment_id
where private.is_member();

create view public.v_print_job_outputs as
select
  o.id, o.print_job_id, j.code as print_job_code, j.status as print_job_status, j.equipment_id, j.finished_at,
  o.variant_id, v.sku as variant_sku, p.id as product_id, p.name || ' — ' || v.name as variant_name, v.item_id,
  o.bom_version_id, o.qty_planned, o.qty_good, o.qty_failed, o.qty_released, o.qty_rejected, o.est_weight_g_per_unit,
  o.allocation_share, o.failure_reason, o.status, o.needs_finishing, o.released_at, o.reject_reason, o.sort_order,
  (select coalesce(sum(e.minutes), 0) from public.post_process_entries e where e.output_id = o.id)::integer as post_process_minutes,
  case when private.can_view_costs() then o.alloc_material + o.alloc_energy + o.alloc_depreciation + o.alloc_operational end as alloc_total,
  case when private.can_view_costs() then o.alloc_material end as alloc_material,
  case when private.can_view_costs() then o.alloc_energy + o.alloc_depreciation + o.alloc_operational end as alloc_operational_group,
  case when private.can_view_costs() then o.good_material + o.good_energy + o.good_depreciation + o.good_operational end as good_cost,
  case when private.can_view_costs() then o.scrap_cost end as scrap_cost,
  case when private.can_view_costs() then o.components_cost end as components_cost,
  case when private.can_view_costs() then o.labor_cost end as labor_cost,
  case when private.can_view_costs() then o.unit_material end as unit_material,
  case when private.can_view_costs() then o.unit_energy end as unit_energy,
  case when private.can_view_costs() then o.unit_depreciation end as unit_depreciation,
  case when private.can_view_costs() then o.unit_operational end as unit_operational,
  case when private.can_view_costs() then o.unit_labor end as unit_labor,
  case when private.can_view_costs() then o.unit_total end as unit_total,
  case when private.can_view_costs() and o.qty_planned > 0
    then (o.alloc_material + o.alloc_energy + o.alloc_depreciation + o.alloc_operational) / o.qty_planned end as print_unit_cost
from public.print_job_outputs o
join public.print_jobs j on j.id = o.print_job_id
join public.product_variants v on v.id = o.variant_id
join public.products p on p.id = v.product_id
where private.is_member();

create view public.v_print_job_materials as
select
  m.id, m.print_job_id, m.item_id, i.sku, i.name as item_name, f.color_hex, f.material, m.lot_id, l.lot_code, m.est_g, m.actual_g,
  case when private.can_view_costs() then m.unit_cost_snapshot end as unit_cost_snapshot,
  case when private.can_view_costs() then m.cost_total end as cost_total
from public.print_job_materials m
join public.items i on i.id = m.item_id
left join public.filament_specs f on f.item_id = m.item_id
left join public.stock_lots l on l.id = m.lot_id
where private.is_member();

create view public.v_post_process_entries as
select
  e.id, e.output_id, e.performed_at, e.minutes, e.kind, e.notes, e.created_by,
  case when private.can_view_costs() then e.labor_rate end as labor_rate,
  case when private.can_view_costs() then e.labor_cost end as labor_cost
from public.post_process_entries e
where private.is_member();

-- -----------------------------------------------------------------------------
-- RLS: tabelas com valores só para dono e leitura; produção lê pelas views
-- -----------------------------------------------------------------------------

alter table public.print_jobs enable row level security;
alter table public.print_job_outputs enable row level security;
alter table public.print_job_materials enable row level security;
alter table public.post_process_entries enable row level security;

create policy print_jobs_select on public.print_jobs for select to authenticated using (private.can_view_costs());
create policy print_job_outputs_select on public.print_job_outputs for select to authenticated using (private.can_view_costs());
create policy print_job_materials_select on public.print_job_materials for select to authenticated using (private.can_view_costs());
create policy post_process_entries_select on public.post_process_entries for select to authenticated using (private.can_view_costs());

select private.apply_grants();
