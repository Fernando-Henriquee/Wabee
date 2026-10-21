-- =============================================================================
-- Wabee — 0400 Equipamentos, taxas de custo, produtos e fichas técnicas
-- (Módulos 2 e 4, seções 4.4, 4.6, 8 e 10)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Equipamentos
-- -----------------------------------------------------------------------------

create table public.equipment (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null default 'PRINTER' check (kind in ('PRINTER', 'DRYER', 'POST_PROCESS', 'OTHER')),
  brand text check (brand is null or char_length(brand) <= 60),
  model text check (model is null or char_length(model) <= 60),
  serial text check (serial is null or char_length(serial) <= 60),
  acquired_at date,
  acquisition_cost numeric(14,2) not null default 0 check (acquisition_cost >= 0),
  purchase_line_id bigint,
  residual_value numeric(14,2) not null default 0 check (residual_value >= 0),
  useful_life_hours integer check (useful_life_hours is null or useful_life_hours > 0),
  avg_power_w integer check (avg_power_w is null or avg_power_w >= 0),
  initial_hours numeric(14,3) not null default 0 check (initial_hours >= 0),
  maintenance_interval_hours integer check (maintenance_interval_hours is null or maintenance_interval_hours > 0),
  status text not null default 'ATIVO' check (status in ('ATIVO', 'MANUTENCAO', 'BAIXADO')),
  disposed_at date,
  disposal_value numeric(14,2),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (residual_value <= acquisition_cost or acquisition_cost = 0)
);

comment on column public.equipment.acquisition_cost is 'Valor do bem, sem juros, com frete rateado (RN-02).';

create trigger equipment_touch before update on public.equipment for each row execute function private.touch_updated_at();
create trigger equipment_audit after insert or update on public.equipment for each row execute function private.audit_row('equipment');

-- Taxas com vigência (princípio 5): nenhuma sobreposição por (tipo, equipamento).
create table public.cost_rates (
  id bigint generated always as identity primary key,
  rate_type text not null check (rate_type in (
    'ENERGY_PRICE_KWH', 'ENERGY_PER_HOUR', 'DEPRECIATION_PER_HOUR', 'OPERATIONAL_PER_HOUR', 'MAINTENANCE_PER_HOUR', 'LABOR_PER_HOUR'
  )),
  equipment_id bigint references public.equipment (id),
  value numeric(16,6) not null check (value >= 0),
  valid_from date not null,
  valid_to date,
  source text not null default 'MANUAL' check (source in ('MANUAL', 'CALCULATED')),
  calc_params jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (valid_to is null or valid_to >= valid_from),
  constraint cost_rates_no_overlap exclude using gist (
    rate_type with =,
    (coalesce(equipment_id, 0)) with =,
    daterange(valid_from, valid_to, '[]') with &&
  )
);

comment on table public.cost_rates is 'Valor por unidade de uso (R$/h, R$/kWh) com vigência. Nunca recalcula operações passadas.';

create function private.guard_cost_rate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.value <> old.value or new.rate_type <> old.rate_type or new.equipment_id is distinct from old.equipment_id
                           or new.valid_from <> old.valid_from) then
    raise exception 'O valor de uma taxa não pode ser editado: crie uma nova vigência.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger cost_rates_guard before update on public.cost_rates for each row execute function private.guard_cost_rate();
create trigger cost_rates_audit after insert or update on public.cost_rates for each row execute function private.audit_row('cost_rate');

create table public.maintenance_logs (
  id bigint generated always as identity primary key,
  equipment_id bigint not null references public.equipment (id),
  performed_at date not null,
  kind text not null check (kind in ('PREVENTIVA', 'CORRETIVA', 'TROCA_BICO', 'TROCA_MESA', 'LUBRIFICACAO', 'CALIBRACAO', 'OUTRO')),
  hours_at numeric(14,3) not null default 0,
  cost numeric(14,2) not null default 0 check (cost >= 0),
  payable_id bigint references public.payables (id),
  downtime_hours numeric(8,2) not null default 0 check (downtime_hours >= 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- -----------------------------------------------------------------------------
-- Taxas vigentes (RN-04, RN-05, RN-06) — get_rates da seção 8.1
-- -----------------------------------------------------------------------------

create type public.rate_set as (
  energy_h numeric,
  depreciation_h numeric,
  operational_h numeric,
  labor_h numeric,
  mode text,
  rate_ids bigint[],
  fully_depreciated boolean
);

-- Taxa vigente na data: a específica do equipamento vale antes da global.
create function private.rate_at(p_type text, p_equipment_id bigint, p_on date)
returns public.cost_rates
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.cost_rates r
  where r.rate_type = p_type
    and (r.equipment_id = p_equipment_id or r.equipment_id is null)
    and r.valid_from <= p_on and (r.valid_to is null or r.valid_to >= p_on)
  order by (r.equipment_id is null), r.valid_from desc
  limit 1;
$$;

-- Horas de uso do equipamento até uma data (US-2.6): falhas também desgastam a máquina.
create function private.equipment_hours(p_equipment_id bigint, p_until timestamptz default null)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_initial numeric;
  v_minutes numeric := 0;
begin
  select e.initial_hours into v_initial from public.equipment e where e.id = p_equipment_id;
  if to_regclass('public.print_jobs') is not null then
    execute 'select coalesce(sum(j.actual_minutes), 0) from public.print_jobs j
              where j.equipment_id = $1 and j.status in (''CONCLUIDA'', ''FALHOU'')
                and ($2 is null or j.finished_at < $2)'
      into v_minutes using p_equipment_id, p_until;
  end if;
  return coalesce(v_initial, 0) + v_minutes / 60.0;
end;
$$;

create function public.get_rates(p_equipment_id bigint, p_on date)
returns public.rate_set
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_equipment public.equipment;
  v_energy public.cost_rates;
  v_kwh public.cost_rates;
  v_dep public.cost_rates;
  v_op public.cost_rates;
  v_labor public.cost_rates;
  v_result public.rate_set := row(0, 0, 0, 0, 'MISSING', '{}'::bigint[], false)::public.rate_set;
  v_energy_value numeric;
  v_has_energy boolean := false;
  v_has_dep boolean := false;
begin
  perform private.assert_role(array['dono', 'producao', 'leitura']);
  select * into v_equipment from public.equipment e where e.id = p_equipment_id;
  v_energy := private.rate_at('ENERGY_PER_HOUR', p_equipment_id, p_on);
  v_kwh := private.rate_at('ENERGY_PRICE_KWH', p_equipment_id, p_on);
  v_dep := private.rate_at('DEPRECIATION_PER_HOUR', p_equipment_id, p_on);
  v_op := private.rate_at('OPERATIONAL_PER_HOUR', p_equipment_id, p_on);
  v_labor := private.rate_at('LABOR_PER_HOUR', null, p_on);

  -- Energia: taxa direta, ou calculada pela potência do equipamento × tarifa (RN-04).
  if v_energy.id is not null then
    v_energy_value := v_energy.value;
    v_has_energy := true;
    v_result.rate_ids := v_result.rate_ids || v_energy.id;
  elsif v_kwh.id is not null and v_equipment.avg_power_w is not null then
    v_energy_value := round(v_equipment.avg_power_w / 1000.0 * v_kwh.value, 6);
    v_has_energy := true;
    v_result.rate_ids := v_result.rate_ids || v_kwh.id;
  end if;
  v_has_dep := v_dep.id is not null;

  if (v_has_energy and v_has_dep) or (v_op.id is null and (v_has_energy or v_has_dep)) then
    v_result.mode := 'SPLIT';
    v_result.energy_h := coalesce(v_energy_value, 0);
    v_result.depreciation_h := coalesce(v_dep.value, 0);
    if v_has_dep then
      v_result.rate_ids := v_result.rate_ids || v_dep.id;
    end if;
  elsif v_op.id is not null then
    v_result.mode := 'COMBINED';
    v_result.operational_h := v_op.value;
    v_result.rate_ids := array[v_op.id];
  end if;

  -- Depreciação zera quando as horas usadas alcançam a vida útil (RN-05).
  if v_result.depreciation_h > 0 and v_equipment.useful_life_hours is not null
     and private.equipment_hours(p_equipment_id) >= v_equipment.useful_life_hours then
    v_result.depreciation_h := 0;
    v_result.fully_depreciated := true;
  end if;
  if v_labor.id is not null then
    v_result.labor_h := v_labor.value;
    v_result.rate_ids := v_result.rate_ids || v_labor.id;
  end if;
  return v_result;
end;
$$;

-- Nova vigência (US-2.2): encerra a anterior do mesmo tipo e escopo no dia anterior.
create function public.create_cost_rate(
  p_rate_type text,
  p_value numeric,
  p_valid_from date,
  p_equipment_id bigint default null,
  p_source text default 'MANUAL',
  p_calc_params jsonb default '{}'::jsonb,
  p_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.cost_rates;
  v_id bigint;
begin
  perform private.assert_owner();
  if p_value is null or p_value < 0 then
    raise exception 'Informe um valor válido para a taxa.' using errcode = '22023';
  end if;
  if p_valid_from is null then
    raise exception 'Informe a data de início da vigência.' using errcode = '22023';
  end if;
  if p_rate_type = 'LABOR_PER_HOUR' and p_equipment_id is not null then
    raise exception 'A taxa de trabalho é global (não por equipamento).' using errcode = '22023';
  end if;
  select * into v_current from public.cost_rates r
  where r.rate_type = p_rate_type and coalesce(r.equipment_id, 0) = coalesce(p_equipment_id, 0)
    and (r.valid_to is null or r.valid_to >= p_valid_from)
  order by r.valid_from desc
  limit 1
  for update;
  if v_current.id is not null then
    if v_current.valid_from >= p_valid_from then
      raise exception 'Já existe uma taxa deste tipo a partir de %. Escolha uma data de início posterior.',
        to_char(v_current.valid_from, 'DD/MM/YYYY') using errcode = '23P01';
    end if;
    update public.cost_rates set valid_to = p_valid_from - 1 where id = v_current.id;
  end if;
  insert into public.cost_rates (rate_type, equipment_id, value, valid_from, source, calc_params, notes)
  values (p_rate_type, p_equipment_id, round(p_value, 6), p_valid_from, coalesce(p_source, 'MANUAL'), coalesce(p_calc_params, '{}'::jsonb),
          nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Divide a taxa combinada em energia + depreciação a partir de uma data (US-2.5), numa transação.
create function public.split_operational_rate(
  p_valid_from date,
  p_energy_h numeric,
  p_depreciation_h numeric,
  p_equipment_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_combined public.cost_rates;
  v_energy_id bigint;
  v_dep_id bigint;
begin
  perform private.assert_owner();
  select * into v_combined from public.cost_rates r
  where r.rate_type = 'OPERATIONAL_PER_HOUR' and coalesce(r.equipment_id, 0) = coalesce(p_equipment_id, 0)
    and r.valid_from < p_valid_from and (r.valid_to is null or r.valid_to >= p_valid_from)
  for update;
  if v_combined.id is not null then
    update public.cost_rates set valid_to = p_valid_from - 1 where id = v_combined.id;
  end if;
  v_energy_id := public.create_cost_rate('ENERGY_PER_HOUR', p_energy_h, p_valid_from, p_equipment_id, 'MANUAL',
                                         jsonb_build_object('origem', 'divisão da taxa combinada'));
  v_dep_id := public.create_cost_rate('DEPRECIATION_PER_HOUR', p_depreciation_h, p_valid_from, p_equipment_id, 'MANUAL',
                                      jsonb_build_object('origem', 'divisão da taxa combinada'));
  return jsonb_build_object('energy_rate_id', v_energy_id, 'depreciation_rate_id', v_dep_id, 'closed_rate_id', v_combined.id);
end;
$$;

create function public.save_equipment(p_equipment jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_equipment ->> 'id', '')::bigint;
begin
  perform private.assert_owner();
  if v_id is null then
    insert into public.equipment (name, kind, brand, model, serial, acquired_at, acquisition_cost, residual_value, useful_life_hours,
                                  avg_power_w, initial_hours, maintenance_interval_hours, notes)
    values (
      btrim(p_equipment ->> 'name'), coalesce(nullif(p_equipment ->> 'kind', ''), 'PRINTER'),
      nullif(btrim(coalesce(p_equipment ->> 'brand', '')), ''), nullif(btrim(coalesce(p_equipment ->> 'model', '')), ''),
      nullif(btrim(coalesce(p_equipment ->> 'serial', '')), ''), nullif(p_equipment ->> 'acquired_at', '')::date,
      coalesce(nullif(p_equipment ->> 'acquisition_cost', '')::numeric, 0), coalesce(nullif(p_equipment ->> 'residual_value', '')::numeric, 0),
      nullif(p_equipment ->> 'useful_life_hours', '')::integer, nullif(p_equipment ->> 'avg_power_w', '')::integer,
      coalesce(nullif(p_equipment ->> 'initial_hours', '')::numeric, 0), nullif(p_equipment ->> 'maintenance_interval_hours', '')::integer,
      nullif(btrim(coalesce(p_equipment ->> 'notes', '')), '')
    )
    returning id into v_id;
  else
    update public.equipment e
       set name = btrim(coalesce(p_equipment ->> 'name', e.name)),
           kind = coalesce(nullif(p_equipment ->> 'kind', ''), e.kind),
           brand = nullif(btrim(coalesce(p_equipment ->> 'brand', '')), ''),
           model = nullif(btrim(coalesce(p_equipment ->> 'model', '')), ''),
           serial = nullif(btrim(coalesce(p_equipment ->> 'serial', '')), ''),
           acquired_at = nullif(p_equipment ->> 'acquired_at', '')::date,
           acquisition_cost = case when e.purchase_line_id is null then coalesce(nullif(p_equipment ->> 'acquisition_cost', '')::numeric, e.acquisition_cost) else e.acquisition_cost end,
           residual_value = coalesce(nullif(p_equipment ->> 'residual_value', '')::numeric, e.residual_value),
           useful_life_hours = nullif(p_equipment ->> 'useful_life_hours', '')::integer,
           avg_power_w = nullif(p_equipment ->> 'avg_power_w', '')::integer,
           initial_hours = coalesce(nullif(p_equipment ->> 'initial_hours', '')::numeric, e.initial_hours),
           maintenance_interval_hours = nullif(p_equipment ->> 'maintenance_interval_hours', '')::integer,
           status = case when e.status = 'BAIXADO' then e.status else coalesce(nullif(p_equipment ->> 'status', ''), e.status) end,
           notes = nullif(btrim(coalesce(p_equipment ->> 'notes', '')), '')
     where e.id = v_id;
    if not found then
      raise exception 'Equipamento não encontrado.' using errcode = '22023';
    end if;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Canais de venda, taxas e preços (seção 4.8 e US-4.5, US-6.2)
-- -----------------------------------------------------------------------------

create table public.sales_channels (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('DIRETO', 'REDE_SOCIAL', 'MARKETPLACE', 'FEIRA')),
  payout_days integer not null default 0 check (payout_days between 0 and 120),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sales_channels_name_uq on public.sales_channels (lower(btrim(name)));
create trigger sales_channels_touch before update on public.sales_channels for each row execute function private.touch_updated_at();
create trigger sales_channels_audit after insert or update on public.sales_channels for each row execute function private.audit_row('sales_channel');

create table public.sales_channel_fees (
  id bigint generated always as identity primary key,
  channel_id bigint not null references public.sales_channels (id),
  fee_pct numeric(7,4) not null default 0 check (fee_pct >= 0 and fee_pct < 1),
  fee_fixed numeric(14,2) not null default 0 check (fee_fixed >= 0),
  fee_fixed_per text not null default 'PEDIDO' check (fee_fixed_per in ('PEDIDO', 'UNIDADE')),
  payment_fee_pct numeric(7,4) not null default 0 check (payment_fee_pct >= 0 and payment_fee_pct < 1),
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (valid_to is null or valid_to >= valid_from),
  constraint sales_channel_fees_no_overlap exclude using gist (channel_id with =, daterange(valid_from, valid_to, '[]') with &&)
);

create trigger sales_channel_fees_audit after insert on public.sales_channel_fees for each row execute function private.audit_row('sales_channel_fee');

alter table public.settings
  add constraint settings_default_channel_fk foreign key (default_channel_id) references public.sales_channels (id),
  add constraint settings_default_packaging_fk foreign key (default_order_packaging_item_id) references public.items (id);

insert into public.sales_channels (name, kind, payout_days, active) values
  ('Venda direta', 'DIRETO', 0, true),
  ('Instagram / WhatsApp', 'REDE_SOCIAL', 0, true),
  ('Feira / evento', 'FEIRA', 0, true),
  ('Shopee', 'MARKETPLACE', 14, false),
  ('Mercado Livre', 'MARKETPLACE', 14, false);

insert into public.sales_channel_fees (channel_id, fee_pct, fee_fixed, payment_fee_pct, valid_from)
select c.id, 0, 0, 0, date '2026-01-01' from public.sales_channels c;

update public.settings set default_channel_id = (select id from public.sales_channels where name = 'Venda direta');

create function private.channel_fee_at(p_channel_id bigint, p_on date)
returns public.sales_channel_fees
language sql
stable
security definer
set search_path = ''
as $$
  select f.* from public.sales_channel_fees f
  where f.channel_id = p_channel_id and f.valid_from <= p_on and (f.valid_to is null or f.valid_to >= p_on)
  order by f.valid_from desc
  limit 1;
$$;

create function public.save_sales_channel(p_channel jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_channel ->> 'id', '')::bigint;
  v_fee public.sales_channel_fees;
  v_from date := coalesce(nullif(p_channel ->> 'fees_valid_from', '')::date, private.today());
  v_pct numeric := coalesce(nullif(p_channel ->> 'fee_pct', '')::numeric, 0);
  v_fixed numeric := coalesce(nullif(p_channel ->> 'fee_fixed', '')::numeric, 0);
  v_per text := coalesce(nullif(p_channel ->> 'fee_fixed_per', ''), 'PEDIDO');
  v_pay numeric := coalesce(nullif(p_channel ->> 'payment_fee_pct', '')::numeric, 0);
begin
  perform private.assert_owner();
  if v_id is null then
    insert into public.sales_channels (name, kind, payout_days, active, notes)
    values (btrim(p_channel ->> 'name'), p_channel ->> 'kind', coalesce(nullif(p_channel ->> 'payout_days', '')::integer, 0),
            coalesce((p_channel ->> 'active')::boolean, true), nullif(btrim(coalesce(p_channel ->> 'notes', '')), ''))
    returning id into v_id;
    insert into public.sales_channel_fees (channel_id, fee_pct, fee_fixed, fee_fixed_per, payment_fee_pct, valid_from)
    values (v_id, v_pct, v_fixed, v_per, v_pay, date '2026-01-01');
    return v_id;
  end if;
  update public.sales_channels c
     set name = btrim(coalesce(p_channel ->> 'name', c.name)),
         kind = coalesce(nullif(p_channel ->> 'kind', ''), c.kind),
         payout_days = coalesce(nullif(p_channel ->> 'payout_days', '')::integer, c.payout_days),
         active = coalesce((p_channel ->> 'active')::boolean, c.active),
         notes = nullif(btrim(coalesce(p_channel ->> 'notes', '')), '')
   where c.id = v_id;
  -- Mudança de taxa cria nova vigência (a anterior é encerrada no dia anterior).
  v_fee := private.channel_fee_at(v_id, v_from);
  if v_fee.id is null or (v_fee.fee_pct, v_fee.fee_fixed, v_fee.fee_fixed_per, v_fee.payment_fee_pct) is distinct from (v_pct, v_fixed, v_per, v_pay) then
    if v_fee.id is not null and v_fee.valid_from >= v_from then
      raise exception 'Já existe uma tabela de taxas deste canal começando em %. Escolha uma data posterior.',
        to_char(v_fee.valid_from, 'DD/MM/YYYY') using errcode = '23P01';
    end if;
    if v_fee.id is not null then
      update public.sales_channel_fees set valid_to = v_from - 1 where id = v_fee.id;
    end if;
    insert into public.sales_channel_fees (channel_id, fee_pct, fee_fixed, fee_fixed_per, payment_fee_pct, valid_from)
    values (v_id, v_pct, v_fixed, v_per, v_pay, v_from);
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Produtos, variações e fichas técnicas
-- -----------------------------------------------------------------------------

create table public.products (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique,
  category text not null default 'OUTRO' check (category in ('CHAVEIRO', 'DECORACAO', 'UTILIDADE', 'BRINQUEDO', 'PERSONALIZADO', 'OUTRO')),
  description text check (description is null or char_length(description) <= 2000),
  photo_path text,
  model_source text not null default 'PROPRIO' check (model_source in ('PROPRIO', 'TERCEIRO_LIVRE', 'TERCEIRO_LICENCIADO')),
  license_notes text,
  license_allows_commercial boolean,
  is_custom boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();
create trigger products_audit after insert or update on public.products for each row execute function private.audit_row('product');

create table public.product_variants (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id),
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  item_id bigint not null unique references public.items (id),
  reference_price numeric(14,2) check (reference_price is null or reference_price >= 0),
  is_hidden boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_variants_product_idx on public.product_variants (product_id);
create trigger product_variants_touch before update on public.product_variants for each row execute function private.touch_updated_at();
create trigger product_variants_audit after insert or update on public.product_variants for each row execute function private.audit_row('product_variant');

-- Produto pronto exige variação vinculada (seção 4.2), conferido no fim da transação.
create function private.check_finished_good()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.items i where i.id = new.id and i.kind = 'FINISHED_GOOD')
     and not exists (select 1 from public.product_variants v where v.item_id = new.id) then
    raise exception 'Produto pronto sem variação de produto vinculada.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger items_finished_good_check after insert on public.items
  deferrable initially deferred for each row execute function private.check_finished_good();

create table public.bom_versions (
  id bigint generated always as identity primary key,
  variant_id bigint not null references public.product_variants (id),
  version integer not null check (version >= 1),
  status text not null default 'RASCUNHO' check (status in ('RASCUNHO', 'ATIVA', 'ARQUIVADA')),
  units_per_plate integer not null default 1 check (units_per_plate >= 1),
  est_print_minutes_per_plate integer not null default 0 check (est_print_minutes_per_plate >= 0),
  est_post_process_minutes_per_unit integer not null default 0 check (est_post_process_minutes_per_unit >= 0),
  default_equipment_id bigint references public.equipment (id),
  slicer_import_id bigint,
  notes text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (variant_id, version)
);

create unique index bom_versions_one_active on public.bom_versions (variant_id) where status = 'ATIVA';
create trigger bom_versions_touch before update on public.bom_versions for each row execute function private.touch_updated_at();

create table public.bom_lines (
  id bigint generated always as identity primary key,
  bom_version_id bigint not null references public.bom_versions (id) on delete cascade,
  item_id bigint not null references public.items (id),
  line_kind text not null check (line_kind in ('FILAMENT_MODEL', 'FILAMENT_SUPPORT', 'FILAMENT_PURGE', 'COMPONENT', 'PACKAGING', 'CONSUMABLE')),
  qty_per_unit numeric(14,3) not null check (qty_per_unit > 0),
  waste_pct numeric(7,4) not null default 0 check (waste_pct >= 0 and waste_pct < 1),
  consumed_at text not null check (consumed_at in ('PRODUCTION', 'ASSEMBLY', 'DELIVERY')),
  sort_order integer not null default 0
);

create index bom_lines_version_idx on public.bom_lines (bom_version_id);

create table public.channel_prices (
  id bigint generated always as identity primary key,
  variant_id bigint not null references public.product_variants (id),
  channel_id bigint not null references public.sales_channels (id),
  price numeric(14,2) not null check (price >= 0),
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (valid_to is null or valid_to >= valid_from),
  constraint channel_prices_no_overlap exclude using gist (variant_id with =, channel_id with =, daterange(valid_from, valid_to, '[]') with &&)
);

create trigger channel_prices_audit after insert on public.channel_prices for each row execute function private.audit_row('channel_price');

-- Categoria do produto (palavra comum) não entra no SKU: "Chaveiro Abelha" → PRD-ABELHA-AMA.
create function private.variant_sku(p_product_name text, p_category text, p_variant_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_words text[] := regexp_split_to_array(btrim(p_product_name), '\s+');
  v_base text;
  v_var text := left(regexp_replace(private.unaccent_upper(p_variant_name), '[^A-Z0-9]', '', 'g'), 3);
  v_candidate text;
  v_n integer := 1;
begin
  if array_length(v_words, 1) > 1 and private.unaccent_upper(v_words[1]) in ('CHAVEIRO', 'CHAVEIROS', 'ENFEITE', 'VASO', 'SUPORTE', 'BRINQUEDO') then
    v_words := v_words[2:];
  end if;
  v_base := 'PRD-' || coalesce(nullif(private.slug_upper(array_to_string(v_words, ' '), 14), ''), 'PRODUTO');
  v_candidate := v_base || case when v_var <> '' then '-' || v_var else '' end;
  while exists (select 1 from public.items i where i.sku = v_candidate) or exists (select 1 from public.product_variants v where v.sku = v_candidate) loop
    v_n := v_n + 1;
    v_candidate := v_base || case when v_var <> '' then '-' || v_var else '' end || '-' || v_n;
  end loop;
  return v_candidate;
end;
$$;

create function private.unique_slug(p_name text, p_product_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text := lower(coalesce(nullif(private.slug_upper(p_name, 60), ''), 'produto'));
  v_candidate text := v_base;
  v_n integer := 1;
begin
  while exists (select 1 from public.products p where p.slug = v_candidate and p.id is distinct from p_product_id) loop
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  end loop;
  return v_candidate;
end;
$$;

-- Produto com variações (US-4.1): cada variação nova cria o item FINISHED_GOOD vinculado.
-- p_product: {id?, name, category, description, model_source, license_notes, license_allows_commercial,
--             variants: [{id?, name, sku?, reference_price, active}]}
create function public.save_product(p_product jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_product ->> 'id', '')::bigint;
  v_name text := btrim(coalesce(p_product ->> 'name', ''));
  v_category text := coalesce(nullif(p_product ->> 'category', ''), 'OUTRO');
  v_variant jsonb;
  v_variant_id bigint;
  v_item_id bigint;
  v_sku text;
  v_vname text;
begin
  perform private.assert_owner();
  if char_length(v_name) = 0 then
    raise exception 'Informe o nome do produto.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.products (name, slug, category, description, model_source, license_notes, license_allows_commercial, is_custom)
    values (v_name, private.unique_slug(v_name, null), v_category, nullif(btrim(coalesce(p_product ->> 'description', '')), ''),
            coalesce(nullif(p_product ->> 'model_source', ''), 'PROPRIO'), nullif(btrim(coalesce(p_product ->> 'license_notes', '')), ''),
            (p_product ->> 'license_allows_commercial')::boolean, coalesce((p_product ->> 'is_custom')::boolean, false))
    returning id into v_id;
  else
    update public.products p
       set name = v_name,
           category = v_category,
           description = nullif(btrim(coalesce(p_product ->> 'description', '')), ''),
           model_source = coalesce(nullif(p_product ->> 'model_source', ''), p.model_source),
           license_notes = nullif(btrim(coalesce(p_product ->> 'license_notes', '')), ''),
           license_allows_commercial = (p_product ->> 'license_allows_commercial')::boolean,
           active = coalesce((p_product ->> 'active')::boolean, p.active)
     where p.id = v_id;
    if not found then
      raise exception 'Produto não encontrado.' using errcode = '22023';
    end if;
  end if;

  for v_variant in select * from jsonb_array_elements(coalesce(p_product -> 'variants', '[]'::jsonb)) loop
    v_variant_id := nullif(v_variant ->> 'id', '')::bigint;
    v_vname := btrim(coalesce(v_variant ->> 'name', ''));
    if char_length(v_vname) = 0 then
      raise exception 'Informe o nome de cada variação (ex.: a cor).' using errcode = '22023';
    end if;
    if v_variant_id is null then
      v_sku := coalesce(upper(nullif(btrim(coalesce(v_variant ->> 'sku', '')), '')), private.variant_sku(v_name, v_category, v_vname));
      insert into public.items (sku, name, kind, unit, is_stock_tracked, is_sellable)
      values (v_sku, v_name || ' — ' || v_vname, 'FINISHED_GOOD', 'UN', true, true)
      returning id into v_item_id;
      insert into public.product_variants (product_id, sku, name, item_id, reference_price, is_hidden)
      values (v_id, v_sku, v_vname, v_item_id, nullif(v_variant ->> 'reference_price', '')::numeric,
              coalesce((v_variant ->> 'is_hidden')::boolean, false));
    else
      update public.product_variants v
         set name = v_vname,
             reference_price = nullif(v_variant ->> 'reference_price', '')::numeric,
             active = coalesce((v_variant ->> 'active')::boolean, v.active)
       where v.id = v_variant_id and v.product_id = v_id
       returning v.item_id into v_item_id;
      if v_item_id is null then
        raise exception 'Variação não encontrada.' using errcode = '22023';
      end if;
      update public.items set name = v_name || ' — ' || v_vname, active = coalesce((v_variant ->> 'active')::boolean, active) where id = v_item_id;
    end if;
  end loop;
  -- Nome do item acompanha o nome do produto.
  update public.items i set name = v_name || ' — ' || v.name
    from public.product_variants v where v.product_id = v_id and i.id = v.item_id and i.name <> v_name || ' — ' || v.name;
  return v_id;
end;
$$;

-- Valida e grava as linhas de uma ficha em rascunho.
create function private.write_bom_lines(p_bom_id bigint, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_item public.items;
  v_kind text;
  v_at text;
  v_order integer := 0;
begin
  delete from public.bom_lines where bom_version_id = p_bom_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_order := v_order + 1;
    select * into v_item from public.items i where i.id = (v_line ->> 'item_id')::bigint;
    if v_item.id is null then
      raise exception 'Item da ficha não encontrado (linha %).', v_order using errcode = '22023';
    end if;
    v_kind := coalesce(nullif(v_line ->> 'line_kind', ''), case v_item.kind
      when 'FILAMENT' then 'FILAMENT_MODEL' when 'COMPONENT' then 'COMPONENT' when 'PACKAGING' then 'PACKAGING' else 'CONSUMABLE' end);
    if (v_kind like 'FILAMENT_%') <> (v_item.kind = 'FILAMENT')
       or (v_kind = 'COMPONENT' and v_item.kind <> 'COMPONENT')
       or (v_kind = 'PACKAGING' and v_item.kind <> 'PACKAGING')
       or (v_kind = 'CONSUMABLE' and v_item.kind <> 'CONSUMABLE') then
      raise exception 'O item "%" não combina com o tipo de linha %.', v_item.name, v_kind using errcode = '22023';
    end if;
    -- Momento padrão: filamentos na produção; componentes na montagem; embalagens na entrega.
    v_at := coalesce(nullif(v_line ->> 'consumed_at', ''), case
      when v_kind like 'FILAMENT_%' then 'PRODUCTION' when v_kind = 'PACKAGING' then 'DELIVERY' else 'ASSEMBLY' end);
    if v_kind like 'FILAMENT_%' and v_at <> 'PRODUCTION' then
      raise exception 'Filamento é consumido na produção.' using errcode = '22023';
    end if;
    if v_kind = 'PACKAGING' and v_at <> 'DELIVERY' then
      raise exception 'Embalagem é baixada na entrega da venda.' using errcode = '22023';
    end if;
    insert into public.bom_lines (bom_version_id, item_id, line_kind, qty_per_unit, waste_pct, consumed_at, sort_order)
    values (p_bom_id, v_item.id, v_kind, round((v_line ->> 'qty_per_unit')::numeric, 3),
            coalesce(nullif(v_line ->> 'waste_pct', '')::numeric, 0), v_at, v_order);
  end loop;
end;
$$;

-- Cria ou atualiza uma ficha em RASCUNHO (US-4.2). Editar a ATIVA cria uma cópia versão +1 (US-4.3).
-- p_bom: {id?, variant_id, units_per_plate, est_print_minutes_per_plate, est_post_process_minutes_per_unit,
--         default_equipment_id, notes, lines: [{item_id, line_kind, qty_per_unit, waste_pct, consumed_at}]}
create function public.save_bom_draft(p_bom jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_bom ->> 'id', '')::bigint;
  v_bom public.bom_versions;
  v_variant_id bigint := nullif(p_bom ->> 'variant_id', '')::bigint;
begin
  perform private.assert_owner();
  if v_id is not null then
    select * into v_bom from public.bom_versions b where b.id = v_id for update;
    if v_bom.id is null then
      raise exception 'Ficha técnica não encontrada.' using errcode = '22023';
    end if;
    if v_bom.status <> 'RASCUNHO' then
      raise exception 'Só fichas em rascunho podem ser alteradas. Crie uma nova versão.' using errcode = '22023';
    end if;
    v_variant_id := v_bom.variant_id;
  else
    if not exists (select 1 from public.product_variants v where v.id = v_variant_id) then
      raise exception 'Variação não encontrada.' using errcode = '22023';
    end if;
    if exists (select 1 from public.bom_versions b where b.variant_id = v_variant_id and b.status = 'RASCUNHO') then
      raise exception 'Esta variação já tem uma ficha em rascunho. Edite-a ou ative-a.' using errcode = '22023';
    end if;
    insert into public.bom_versions (variant_id, version)
    values (v_variant_id, coalesce((select max(b.version) from public.bom_versions b where b.variant_id = v_variant_id), 0) + 1)
    returning id into v_id;
  end if;
  update public.bom_versions
     set units_per_plate = coalesce(nullif(p_bom ->> 'units_per_plate', '')::integer, units_per_plate),
         est_print_minutes_per_plate = coalesce(nullif(p_bom ->> 'est_print_minutes_per_plate', '')::integer, est_print_minutes_per_plate),
         est_post_process_minutes_per_unit = coalesce(nullif(p_bom ->> 'est_post_process_minutes_per_unit', '')::integer, est_post_process_minutes_per_unit),
         default_equipment_id = nullif(p_bom ->> 'default_equipment_id', '')::bigint,
         slicer_import_id = coalesce(nullif(p_bom ->> 'slicer_import_id', '')::bigint, slicer_import_id),
         notes = nullif(btrim(coalesce(p_bom ->> 'notes', '')), '')
   where id = v_id;
  if p_bom ? 'lines' then
    perform private.write_bom_lines(v_id, p_bom -> 'lines');
  end if;
  return v_id;
end;
$$;

-- Copia a ficha (ativa ou outra) para um novo rascunho, opcionalmente para outra variação
-- trocando filamentos (US-4.3, US-4.8). p_swaps: {"<item_id origem>": <item_id destino>}
create function public.copy_bom(p_bom_id bigint, p_target_variant_id bigint default null, p_swaps jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.bom_versions;
  v_target bigint;
  v_lines jsonb;
begin
  perform private.assert_owner();
  select * into v_src from public.bom_versions b where b.id = p_bom_id;
  if v_src.id is null then
    raise exception 'Ficha técnica não encontrada.' using errcode = '22023';
  end if;
  v_target := coalesce(p_target_variant_id, v_src.variant_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', coalesce((p_swaps ->> l.item_id::text)::bigint, l.item_id), 'line_kind', l.line_kind,
           'qty_per_unit', l.qty_per_unit, 'waste_pct', l.waste_pct, 'consumed_at', l.consumed_at) order by l.sort_order), '[]'::jsonb)
    into v_lines
  from public.bom_lines l where l.bom_version_id = v_src.id;
  return public.save_bom_draft(jsonb_build_object(
    'variant_id', v_target, 'units_per_plate', v_src.units_per_plate, 'est_print_minutes_per_plate', v_src.est_print_minutes_per_plate,
    'est_post_process_minutes_per_unit', v_src.est_post_process_minutes_per_unit, 'default_equipment_id', v_src.default_equipment_id,
    'notes', v_src.notes, 'lines', v_lines));
end;
$$;

create function public.activate_bom(p_bom_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bom public.bom_versions;
begin
  perform private.assert_owner();
  select * into v_bom from public.bom_versions b where b.id = p_bom_id for update;
  if v_bom.id is null or v_bom.status <> 'RASCUNHO' then
    raise exception 'Só uma ficha em rascunho pode ser ativada.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.bom_lines l where l.bom_version_id = p_bom_id and l.line_kind like 'FILAMENT_%') then
    raise exception 'A ficha precisa de ao menos um filamento.' using errcode = '22023';
  end if;
  update public.bom_versions set status = 'ARQUIVADA' where variant_id = v_bom.variant_id and status = 'ATIVA';
  update public.bom_versions set status = 'ATIVA', activated_at = now() where id = p_bom_id;
  perform private.audit('UPDATE', 'bom_version', p_bom_id, null, format('Ficha versão %s ativada', v_bom.version), '{}'::jsonb);
end;
$$;

create function public.discard_bom_draft(p_bom_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  delete from public.bom_versions where id = p_bom_id and status = 'RASCUNHO';
  if not found then
    raise exception 'Só rascunhos podem ser descartados.' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Custo estimado por camada (US-4.4) e preço sugerido (RN-17)
-- -----------------------------------------------------------------------------

-- Custo unitário vigente de um item para estimativas: custo médio; sem saldo, o último
-- custo conhecido; filamento sem histórico usa a referência (marcado como estimado).
create function private.item_estimate_cost(p_item_id bigint, out unit_cost numeric, out is_reference boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  select i.kind into v_kind from public.items i where i.id = p_item_id;
  select b.avg_cost_total into unit_cost from public.stock_balances b where b.item_id = p_item_id and b.avg_cost_total > 0;
  is_reference := exists (select 1 from public.stock_lots l where l.item_id = p_item_id and l.reference_cost and l.qty_remaining > 0);
  if unit_cost is null then
    select m.unit_cost_total into unit_cost from public.stock_movements m
    where m.item_id = p_item_id and m.qty > 0 and m.unit_cost_total > 0 order by m.id desc limit 1;
  end if;
  if unit_cost is null then
    unit_cost := case when v_kind = 'FILAMENT' then (private.settings()).filament_reference_cost_g else 0 end;
    is_reference := true;
  end if;
end;
$$;

-- Estimativa de custo de uma unidade a partir das linhas (ficha salva ou rascunho na tela).
create function private.estimate_cost(
  p_lines jsonb,
  p_units_per_plate integer,
  p_minutes_per_plate numeric,
  p_post_minutes_per_unit numeric,
  p_equipment_id bigint,
  p_on date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_cost record;
  v_qty numeric;
  v_material numeric := 0;
  v_packaging numeric := 0;
  v_grams numeric := 0;
  v_reference boolean := false;
  v_rates public.rate_set;
  v_equipment_id bigint := p_equipment_id;
  v_machine_minutes numeric := coalesce(p_minutes_per_plate, 0) / greatest(coalesce(p_units_per_plate, 1), 1);
  v_hours numeric;
  v_lines_out jsonb := '[]'::jsonb;
  v_energy numeric;
  v_dep numeric;
  v_op numeric;
  v_labor numeric;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into v_cost from private.item_estimate_cost((v_line ->> 'item_id')::bigint);
    v_qty := coalesce((v_line ->> 'qty_per_unit')::numeric, 0) * (1 + coalesce(nullif(v_line ->> 'waste_pct', '')::numeric, 0));
    if coalesce(v_line ->> 'line_kind', '') = 'PACKAGING' or coalesce(v_line ->> 'consumed_at', '') = 'DELIVERY' then
      v_packaging := v_packaging + v_qty * v_cost.unit_cost;
    else
      v_material := v_material + v_qty * v_cost.unit_cost;
    end if;
    if coalesce(v_line ->> 'line_kind', '') like 'FILAMENT_%' then
      v_grams := v_grams + v_qty;
    end if;
    v_reference := v_reference or v_cost.is_reference;
    v_lines_out := v_lines_out || jsonb_build_object('item_id', (v_line ->> 'item_id')::bigint, 'qty', round(v_qty, 3),
      'unit_cost', round(v_cost.unit_cost, 6), 'cost', round(v_qty * v_cost.unit_cost, 6), 'estimated', v_cost.is_reference);
  end loop;
  if v_equipment_id is null then
    select e.id into v_equipment_id from public.equipment e where e.kind = 'PRINTER' and e.status <> 'BAIXADO' order by e.id limit 1;
  end if;
  v_rates := public.get_rates(v_equipment_id, p_on);
  v_hours := v_machine_minutes / 60.0;
  v_energy := v_hours * v_rates.energy_h;
  v_dep := v_hours * v_rates.depreciation_h;
  v_op := v_hours * v_rates.operational_h;
  v_labor := coalesce(p_post_minutes_per_unit, 0) / 60.0 * v_rates.labor_h;
  return jsonb_build_object(
    'material', round(v_material, 6),
    'energy', round(v_energy, 6),
    'depreciation', round(v_dep, 6),
    'operational', round(v_op, 6),
    'labor', round(v_labor, 6),
    'packaging', round(v_packaging, 6),
    'total_production', round(v_material + v_energy + v_dep + v_op + v_labor, 6),
    'machine_minutes', round(v_machine_minutes, 3),
    'grams', round(v_grams, 3),
    'rate_mode', v_rates.mode,
    'labor_valued', v_rates.labor_h > 0,
    'estimated', v_reference,
    'equipment_id', v_equipment_id,
    'lines', v_lines_out
  );
end;
$$;

create function private.bom_lines_json(p_bom_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', l.item_id, 'line_kind', l.line_kind, 'qty_per_unit', l.qty_per_unit,
                                               'waste_pct', l.waste_pct, 'consumed_at', l.consumed_at) order by l.sort_order), '[]'::jsonb)
  from public.bom_lines l where l.bom_version_id = p_bom_id;
$$;

create function public.estimate_bom_cost(p_bom_id bigint, p_on date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bom public.bom_versions;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select * into v_bom from public.bom_versions b where b.id = p_bom_id;
  if v_bom.id is null then
    raise exception 'Ficha técnica não encontrada.' using errcode = '22023';
  end if;
  return private.estimate_cost(private.bom_lines_json(v_bom.id), v_bom.units_per_plate, v_bom.est_print_minutes_per_plate,
                               v_bom.est_post_process_minutes_per_unit, v_bom.default_equipment_id, coalesce(p_on, private.today()));
end;
$$;

-- Recalcula o quadro de custos sem salvar (US-4.4: a tela recalcula a cada alteração).
create function public.preview_bom_cost(p_bom jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_role(array['dono', 'leitura']);
  return private.estimate_cost(p_bom -> 'lines', coalesce(nullif(p_bom ->> 'units_per_plate', '')::integer, 1),
    coalesce(nullif(p_bom ->> 'est_print_minutes_per_plate', '')::numeric, 0),
    coalesce(nullif(p_bom ->> 'est_post_process_minutes_per_unit', '')::numeric, 0),
    nullif(p_bom ->> 'default_equipment_id', '')::bigint, private.today());
end;
$$;

create function private.active_bom(p_variant_id bigint)
returns public.bom_versions
language sql
stable
security definer
set search_path = ''
as $$
  select b.* from public.bom_versions b where b.variant_id = p_variant_id and b.status = 'ATIVA';
$$;

-- Preço de referência do canal (RN-14): preço vigente do canal ou o preço de referência da variação.
create function private.reference_price(p_variant_id bigint, p_channel_id bigint, p_on date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select cp.price from public.channel_prices cp
      where cp.variant_id = p_variant_id and cp.channel_id = p_channel_id
        and cp.valid_from <= p_on and (cp.valid_to is null or cp.valid_to >= p_on)
      order by cp.valid_from desc limit 1),
    (select v.reference_price from public.product_variants v where v.id = p_variant_id)
  );
$$;

create function private.sales_tax_pct()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.tax_regime = 'SIMPLES' then s.sales_tax_pct else 0 end from public.settings s where s.id;
$$;

-- Preço sugerido (RN-17): p = (custo + embalagem + taxa fixa) / (1 − taxa canal − taxa pagamento − imposto − margem alvo).
-- Devolve null quando a margem alvo é impossível com essas taxas.
create function private.suggested_price(p_unit_cost numeric, p_packaging numeric, p_fee public.sales_channel_fees, p_margin numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_den numeric := 1 - coalesce(p_fee.fee_pct, 0) - coalesce(p_fee.payment_fee_pct, 0) - private.sales_tax_pct() - coalesce(p_margin, 0);
begin
  if v_den <= 0 then
    return null;
  end if;
  return round((coalesce(p_unit_cost, 0) + coalesce(p_packaging, 0) + coalesce(p_fee.fee_fixed, 0)) / v_den, 2);
end;
$$;

-- Tempo de máquina por unidade (horas): média real das últimas 5 impressões da variação,
-- ou a ficha técnica sem histórico (RN-15).
create function private.machine_hours_per_unit(p_variant_id bigint)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours numeric;
  v_bom public.bom_versions;
begin
  if to_regclass('public.print_job_outputs') is not null then
    execute $q$
      select avg(x.h) from (
        select (j.actual_minutes::numeric * o.allocation_share / nullif(o.qty_planned, 0)) / 60.0 as h
        from public.print_job_outputs o join public.print_jobs j on j.id = o.print_job_id
        where o.variant_id = $1 and j.status = 'CONCLUIDA' and j.actual_minutes > 0
        order by j.finished_at desc limit 5
      ) x
    $q$ into v_hours using p_variant_id;
  end if;
  if v_hours is null then
    v_bom := private.active_bom(p_variant_id);
    if v_bom.id is not null and v_bom.est_print_minutes_per_plate > 0 then
      v_hours := v_bom.est_print_minutes_per_plate::numeric / v_bom.units_per_plate / 60.0;
    end if;
  end if;
  return v_hours;
end;
$$;

-- Quadro de preços por canal (US-4.5): preço atual, taxas, margem unitária, MHM e preço sugerido.
create function public.variant_pricing(p_variant_id bigint, p_on date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_on date := coalesce(p_on, private.today());
  v_bom public.bom_versions;
  v_estimate jsonb;
  v_unit_cost numeric;
  v_packaging numeric;
  v_hours numeric;
  v_margin_target numeric := (private.settings()).margin_target_pct;
  v_rows jsonb := '[]'::jsonb;
  v_channel public.sales_channels;
  v_fee public.sales_channel_fees;
  v_price numeric;
  v_fees numeric;
  v_tax numeric;
  v_mc numeric;
  v_stock public.stock_balances;
begin
  perform private.assert_role(array['dono', 'leitura']);
  v_bom := private.active_bom(p_variant_id);
  if v_bom.id is not null then
    v_estimate := public.estimate_bom_cost(v_bom.id, v_on);
  end if;
  select b.* into v_stock from public.stock_balances b join public.product_variants v on v.item_id = b.item_id where v.id = p_variant_id;
  -- Custo de referência: custo médio em estoque, senão o estimado pela ficha.
  v_unit_cost := coalesce(nullif(v_stock.avg_cost_total, 0), (v_estimate ->> 'total_production')::numeric);
  v_packaging := coalesce((v_estimate ->> 'packaging')::numeric, 0);
  v_hours := private.machine_hours_per_unit(p_variant_id);
  for v_channel in select c.* from public.sales_channels c where c.active order by c.id loop
    v_fee := private.channel_fee_at(v_channel.id, v_on);
    v_price := private.reference_price(p_variant_id, v_channel.id, v_on);
    if v_price is not null then
      v_fees := v_price * (coalesce(v_fee.fee_pct, 0) + coalesce(v_fee.payment_fee_pct, 0)) + coalesce(v_fee.fee_fixed, 0);
      v_tax := v_price * private.sales_tax_pct();
      v_mc := v_price - coalesce(v_unit_cost, 0) - v_fees - v_tax - v_packaging;
    else
      v_fees := null; v_tax := null; v_mc := null;
    end if;
    v_rows := v_rows || jsonb_build_object(
      'channel_id', v_channel.id, 'channel_name', v_channel.name, 'channel_kind', v_channel.kind,
      'price', v_price, 'fees', round(v_fees, 2), 'tax', round(v_tax, 2), 'packaging', round(v_packaging, 2),
      'unit_cost', round(v_unit_cost, 6),
      'contribution_margin', round(v_mc, 2),
      'contribution_margin_pct', case when v_price > 0 then round(v_mc / v_price, 4) end,
      'margin_per_machine_hour', case when v_hours > 0 and v_mc is not null then round(v_mc / v_hours, 2) end,
      'suggested_price', private.suggested_price(v_unit_cost, v_packaging, v_fee, v_margin_target),
      'fee_pct', coalesce(v_fee.fee_pct, 0), 'fee_fixed', coalesce(v_fee.fee_fixed, 0), 'payment_fee_pct', coalesce(v_fee.payment_fee_pct, 0)
    );
  end loop;
  return jsonb_build_object('unit_cost', round(v_unit_cost, 6), 'estimate', v_estimate, 'machine_hours_per_unit', round(v_hours, 4),
                            'margin_target_pct', v_margin_target, 'channels', v_rows);
end;
$$;

-- Novo preço de canal (US-4.5): cria a vigência e encerra a anterior.
create function public.set_channel_price(p_variant_id bigint, p_channel_id bigint, p_price numeric, p_valid_from date default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_valid_from, private.today());
  v_current public.channel_prices;
  v_id bigint;
begin
  perform private.assert_owner();
  if p_price is null or p_price < 0 then
    raise exception 'Informe um preço válido.' using errcode = '22023';
  end if;
  select * into v_current from public.channel_prices cp
  where cp.variant_id = p_variant_id and cp.channel_id = p_channel_id and (cp.valid_to is null or cp.valid_to >= v_from)
  order by cp.valid_from desc limit 1 for update;
  if v_current.id is not null then
    if v_current.valid_from >= v_from then
      if v_current.valid_from = v_from then
        -- Mesmo dia: substitui o preço lançado hoje (nenhuma venda usa preço de canal como snapshot).
        delete from public.channel_prices where id = v_current.id;
      else
        raise exception 'Já existe um preço deste canal a partir de %.', to_char(v_current.valid_from, 'DD/MM/YYYY') using errcode = '23P01';
      end if;
    else
      update public.channel_prices set valid_to = v_from - 1 where id = v_current.id;
    end if;
  end if;
  insert into public.channel_prices (variant_id, channel_id, price, valid_from)
  values (p_variant_id, p_channel_id, round(p_price, 2), v_from)
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.equipment enable row level security;
alter table public.cost_rates enable row level security;
alter table public.maintenance_logs enable row level security;
alter table public.sales_channels enable row level security;
alter table public.sales_channel_fees enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.bom_versions enable row level security;
alter table public.bom_lines enable row level security;
alter table public.channel_prices enable row level security;

create policy equipment_select on public.equipment for select to authenticated using (private.can_view_costs());
create policy cost_rates_select on public.cost_rates for select to authenticated using (private.can_view_costs());
create policy maintenance_logs_select on public.maintenance_logs for select to authenticated using (private.can_view_costs());
create policy sales_channels_select on public.sales_channels for select to authenticated using (private.is_member());
create policy sales_channel_fees_select on public.sales_channel_fees for select to authenticated using (private.can_view_costs());
create policy products_select on public.products for select to authenticated using (private.is_member());
create policy product_variants_select on public.product_variants for select to authenticated using (private.can_view_costs());
create policy bom_versions_select on public.bom_versions for select to authenticated using (private.is_member());
create policy bom_lines_select on public.bom_lines for select to authenticated using (private.is_member());
create policy channel_prices_select on public.channel_prices for select to authenticated using (private.can_view_costs());

select private.apply_grants();
