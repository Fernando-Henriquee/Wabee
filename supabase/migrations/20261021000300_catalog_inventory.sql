-- =============================================================================
-- Wabee — 0300 Itens e estoque (Módulo 1, seções 4.2, 4.3 e 7)
--
-- Razão de estoque imutável (princípio 1): stock_movements só recebe INSERT e é a
-- fonte da verdade. stock_balances é um cache atualizado na mesma transação e
-- conferível a qualquer momento (rebuild_balances / check_stock_integrity).
-- Nenhum código cria movimentação fora de private.post_movement().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fornecedores
-- -----------------------------------------------------------------------------

create table public.suppliers (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  document text check (document is null or char_length(document) <= 20),
  kind text check (kind in ('LOJA_ONLINE', 'MARKETPLACE', 'LOJA_FISICA')),
  contact text check (contact is null or char_length(contact) <= 120),
  url text check (url is null or char_length(url) <= 300),
  notes text check (notes is null or char_length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create unique index suppliers_name_uq on public.suppliers (lower(btrim(name)));

create trigger suppliers_touch before update on public.suppliers for each row execute function private.touch_updated_at();
create trigger suppliers_audit after insert or update on public.suppliers for each row execute function private.audit_row('supplier');

-- -----------------------------------------------------------------------------
-- Itens e especificações
-- -----------------------------------------------------------------------------

create table public.items (
  id bigint generated always as identity primary key,
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('FILAMENT', 'COMPONENT', 'PACKAGING', 'CONSUMABLE', 'TOOL', 'FINISHED_GOOD')),
  unit text not null check (unit in ('G', 'UN', 'ML', 'M')),
  is_stock_tracked boolean not null default true,
  is_sellable boolean not null default false,
  min_qty numeric(14,3) not null default 0 check (min_qty >= 0),
  reorder_qty numeric(14,3) not null default 0 check (reorder_qty >= 0),
  location text check (location is null or char_length(location) <= 60),
  default_supplier_id bigint references public.suppliers (id),
  photo_path text,
  notes text check (notes is null or char_length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (kind <> 'FILAMENT' or unit = 'G'),
  check (kind not in ('FILAMENT', 'FINISHED_GOOD', 'TOOL', 'COMPONENT', 'PACKAGING') or is_stock_tracked),
  check (kind <> 'FINISHED_GOOD' or is_sellable)
);

create index items_kind_idx on public.items (kind, active);

comment on table public.items is 'Tudo que a Wabee guarda e controla quantidade (seção 2.1).';

create table public.filament_specs (
  item_id bigint primary key references public.items (id) on delete cascade,
  material text not null check (material in ('PLA', 'PLA_PLUS', 'PETG', 'ABS', 'ASA', 'TPU', 'NYLON', 'OUTRO')),
  brand text not null default '' check (char_length(brand) <= 60),
  color_name text not null check (char_length(btrim(color_name)) between 1 and 40),
  color_hex text not null default '#888888' check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  diameter_mm numeric(4,2) not null default 1.75 check (diameter_mm > 0),
  density_g_cm3 numeric(5,3) not null default 1.240 check (density_g_cm3 > 0),
  nominal_spool_g integer not null default 1000 check (nominal_spool_g > 0),
  empty_spool_tare_g integer not null default 0 check (empty_spool_tare_g >= 0),
  needs_drying boolean not null default false
);

create unique index filament_specs_uq on public.filament_specs (material, lower(btrim(brand)), lower(btrim(color_name)));

create table public.tool_specs (
  item_id bigint primary key references public.items (id) on delete cascade,
  condition text not null default 'BOA' check (condition in ('BOA', 'DESGASTADA', 'QUEBRADA', 'PERDIDA')),
  acquired_at date,
  acquisition_value numeric(14,2) check (acquisition_value is null or acquisition_value >= 0)
);

comment on table public.tool_specs is 'Ferramentas: valor informativo, nunca entra no custo das peças (decisão Q9: despesa na compra).';

create trigger items_touch before update on public.items for each row execute function private.touch_updated_at();
create trigger items_audit after insert or update on public.items for each row execute function private.audit_row('item');

-- Densidade típica por material (seção 18.7), usada para converter metros em gramas.
create function private.typical_density(p_material text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_material
    when 'PLA' then 1.24 when 'PLA_PLUS' then 1.24 when 'PETG' then 1.27 when 'ABS' then 1.04
    when 'ASA' then 1.07 when 'TPU' then 1.21 when 'NYLON' then 1.14 else 1.24 end;
$$;

-- -----------------------------------------------------------------------------
-- Estoque: carretéis/lotes, razão e saldo
-- -----------------------------------------------------------------------------

create table public.stock_lots (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.items (id),
  lot_code text not null unique,
  received_at timestamptz not null,
  qty_initial numeric(14,3) not null check (qty_initial > 0),
  qty_remaining numeric(14,3) not null,
  unit_cost_in numeric(16,6) not null default 0 check (unit_cost_in >= 0),
  reference_cost boolean not null default false,
  status text not null default 'FECHADO' check (status in ('FECHADO', 'ABERTO', 'ESGOTADO', 'DESCARTADO')),
  opened_at timestamptz,
  finished_at timestamptz,
  source_type text,
  source_id bigint,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (qty_remaining >= 0 and qty_remaining <= qty_initial)
);

create index stock_lots_item_idx on public.stock_lots (item_id, status);

comment on column public.stock_lots.unit_cost_in is 'Custo de entrada do carretel (informativo; a valoração usa o custo médio — decisão Q5).';
comment on column public.stock_lots.reference_cost is 'Entrou pelo custo de referência (R$ 0,10/g) por falta do custo real: valores ficam marcados como estimados.';

create table public.stock_movements (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.items (id),
  lot_id bigint references public.stock_lots (id),
  occurred_at timestamptz not null,
  type text not null check (type in (
    'OPENING', 'PURCHASE_RECEIPT', 'PRODUCTION_CONSUMPTION', 'ASSEMBLY_CONSUMPTION', 'PRODUCTION_OUTPUT',
    'SALE_ISSUE', 'PACKAGING_ISSUE', 'MAINTENANCE_CONSUMPTION', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
    'LOSS', 'GIFT', 'SAMPLE', 'PERSONAL_USE', 'RETURN_IN', 'CONSUMABLE_USE', 'REVERSAL'
  )),
  qty numeric(14,3) not null check (qty <> 0),
  unit_cost_material numeric(16,6) not null default 0,
  unit_cost_energy numeric(16,6) not null default 0,
  unit_cost_depreciation numeric(16,6) not null default 0,
  unit_cost_operational numeric(16,6) not null default 0,
  unit_cost_labor numeric(16,6) not null default 0,
  unit_cost_total numeric(16,6) not null default 0,
  total_cost numeric(14,2) not null default 0,
  qty_after numeric(14,3) not null,
  avg_cost_after numeric(16,6) not null,
  source_type text,
  source_id bigint,
  operation_id uuid not null default gen_random_uuid(),
  reason text,
  reverses_id bigint unique references public.stock_movements (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (unit_cost_total = unit_cost_material + unit_cost_energy + unit_cost_depreciation + unit_cost_operational + unit_cost_labor),
  check ((type = 'REVERSAL') = (reverses_id is not null))
);

create index stock_movements_item_time_idx on public.stock_movements (item_id, occurred_at);
create index stock_movements_source_idx on public.stock_movements (source_type, source_id);
create index stock_movements_operation_idx on public.stock_movements (operation_id);
create index stock_movements_lot_idx on public.stock_movements (lot_id);

comment on table public.stock_movements is 'Razão de estoque: registro imutável de cada entrada e saída, com custo por camada (snapshot).';

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function private.block_mutation();

create table public.stock_balances (
  item_id bigint primary key references public.items (id),
  qty_on_hand numeric(14,3) not null default 0,
  qty_reserved numeric(14,3) not null default 0,
  avg_cost_material numeric(16,6) not null default 0,
  avg_cost_energy numeric(16,6) not null default 0,
  avg_cost_depreciation numeric(16,6) not null default 0,
  avg_cost_operational numeric(16,6) not null default 0,
  avg_cost_labor numeric(16,6) not null default 0,
  avg_cost_total numeric(16,6) not null default 0,
  value_total numeric(14,2) not null default 0,
  last_movement_at timestamptz,
  check (qty_reserved >= 0),
  check (qty_reserved <= greatest(qty_on_hand, 0)),
  check (avg_cost_total = avg_cost_material + avg_cost_energy + avg_cost_depreciation + avg_cost_operational + avg_cost_labor)
);

comment on table public.stock_balances is 'Cache do saldo e do custo médio por camada (derivado do razão).';

create function private.create_balance_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_balances (item_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger items_balance after insert on public.items for each row execute function private.create_balance_row();

-- Filamento exige especificação (constraint da seção 4.2), conferida no fim da transação.
create function private.check_item_spec()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items;
begin
  select * into v_item from public.items i where i.id = new.id;
  if v_item.id is null then
    return null;
  end if;
  if v_item.kind = 'FILAMENT' and not exists (select 1 from public.filament_specs f where f.item_id = v_item.id) then
    raise exception 'Filamento "%" sem ficha de filamento (material, marca e cor).', v_item.name using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger items_spec_check after insert or update on public.items
  deferrable initially deferred for each row execute function private.check_item_spec();

-- -----------------------------------------------------------------------------
-- SKU (US-1.1): <PREFIXO>-<ABREV>-<NNN>, ex.: FIL-PLA-PRT-001, CMP-ARG-25-001
-- -----------------------------------------------------------------------------

create function private.unaccent_upper(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(translate(coalesce(p_text, ''),
    'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'));
$$;

-- Abreviação de 3 letras: primeira letra + próximas consoantes (preto → PRT, argola → ARG).
-- Números são mantidos como estão (25 → 25).
create function private.abbrev(p_word text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_word text := regexp_replace(private.unaccent_upper(p_word), '[^A-Z0-9]', '', 'g');
  v_result text;
  v_char text;
begin
  if v_word = '' then
    return '';
  end if;
  if v_word ~ '^[0-9]+$' then
    return left(v_word, 4);
  end if;
  v_result := left(v_word, 1);
  for i in 2..char_length(v_word) loop
    exit when char_length(v_result) >= 3;
    v_char := substr(v_word, i, 1);
    if v_char !~ '[AEIOU]' then
      v_result := v_result || v_char;
    end if;
  end loop;
  if char_length(v_result) < 3 then
    v_result := left(v_word, 3);
  end if;
  return v_result;
end;
$$;

create function private.slug_upper(p_text text, p_max integer default 12)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(trim(both '-' from regexp_replace(private.unaccent_upper(p_text), '[^A-Z0-9]+', '-', 'g')), p_max);
$$;

create function private.next_sku(p_base text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := 1;
  v_candidate text;
begin
  loop
    v_candidate := format('%s-%s', p_base, lpad(v_n::text, 3, '0'));
    exit when not exists (select 1 from public.items i where i.sku = v_candidate);
    v_n := v_n + 1;
  end loop;
  return v_candidate;
end;
$$;

create function public.suggest_item_sku(p_kind text, p_name text, p_material text default null, p_color text default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text := case p_kind
    when 'FILAMENT' then 'FIL' when 'COMPONENT' then 'CMP' when 'PACKAGING' then 'EMB'
    when 'CONSUMABLE' then 'CON' when 'TOOL' then 'FER' else 'ITM' end;
  v_words text[];
  v_base text;
begin
  perform private.assert_role(array['dono', 'producao', 'leitura']);
  if p_kind = 'FILAMENT' then
    v_base := v_prefix || '-' || coalesce(nullif(regexp_replace(private.unaccent_upper(p_material), '[^A-Z0-9]', '', 'g'), ''), 'FIL')
              || '-' || coalesce(nullif(private.abbrev(split_part(btrim(coalesce(p_color, '')), ' ', 1)), ''), 'COR');
  else
    v_words := array(select w from unnest(regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+')) w
                     where char_length(w) > 2 or w ~ '^[0-9]+$');
    v_base := v_prefix || '-' || coalesce(nullif(private.abbrev(v_words[1]), ''), 'ITM')
              || case when array_length(v_words, 1) >= 2 and private.abbrev(v_words[2]) <> '' then '-' || private.abbrev(v_words[2]) else '' end;
  end if;
  return private.next_sku(v_base);
end;
$$;

create function private.next_lot_code(p_item_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sku text;
  v_n integer;
  v_candidate text;
begin
  select i.sku into v_sku from public.items i where i.id = p_item_id;
  select count(*) + 1 into v_n from public.stock_lots l where l.item_id = p_item_id;
  loop
    v_candidate := format('%s-C%s', v_sku, lpad(v_n::text, 2, '0'));
    exit when not exists (select 1 from public.stock_lots l where l.lot_code = v_candidate);
    v_n := v_n + 1;
  end loop;
  return v_candidate;
end;
$$;

-- -----------------------------------------------------------------------------
-- Serviço central do estoque (seção 7.1). Deve rodar dentro de uma transação.
-- RN-01 custo médio ponderado móvel por camada; RN-20 saldo negativo; RN-21 estorno.
-- -----------------------------------------------------------------------------

create function private.movement_sign_ok(p_type text, p_qty numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type in ('OPENING', 'PURCHASE_RECEIPT', 'PRODUCTION_OUTPUT', 'ADJUSTMENT_IN', 'RETURN_IN') then p_qty > 0
    when p_type = 'REVERSAL' then p_qty <> 0
    else p_qty < 0
  end;
$$;

create function private.movement_kind_ok(p_type text, p_kind text, p_sellable boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'PURCHASE_RECEIPT' then p_kind <> 'FINISHED_GOOD'
    when 'PRODUCTION_CONSUMPTION' then p_kind in ('FILAMENT', 'COMPONENT', 'CONSUMABLE')
    when 'ASSEMBLY_CONSUMPTION' then p_kind in ('COMPONENT', 'CONSUMABLE')
    when 'PRODUCTION_OUTPUT' then p_kind = 'FINISHED_GOOD'
    when 'SALE_ISSUE' then p_kind = 'FINISHED_GOOD' or p_sellable
    when 'RETURN_IN' then p_kind = 'FINISHED_GOOD' or p_sellable
    when 'PACKAGING_ISSUE' then p_kind = 'PACKAGING'
    when 'MAINTENANCE_CONSUMPTION' then p_kind <> 'FINISHED_GOOD'
    when 'CONSUMABLE_USE' then p_kind = 'CONSUMABLE'
    else true
  end;
$$;

create function private.post_movement(
  p_item_id bigint,
  p_type text,
  p_qty numeric,
  p_occurred_at timestamptz,
  p_cost private.cost_layers default null,
  p_lot_id bigint default null,
  p_source_type text default null,
  p_source_id bigint default null,
  p_reason text default null,
  p_reverses_id bigint default null,
  p_consume_reserved numeric default 0,
  p_operation_id uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items;
  v_bal public.stock_balances;
  v_lot public.stock_lots;
  v_settings public.settings := private.settings();
  v_qty numeric := round(p_qty, 3);
  v_unit private.cost_layers;
  v_avg private.cost_layers;
  v_old_qty numeric;
  v_new_qty numeric;
  v_available numeric;
  v_unit_total numeric;
  v_avg_total numeric;
  v_lot_remaining numeric;
  v_lot_status text;
  v_row public.stock_movements;
begin
  if v_qty is null or v_qty = 0 then
    raise exception 'Quantidade inválida para movimentação de estoque.' using errcode = '22023';
  end if;
  select * into v_item from public.items i where i.id = p_item_id;
  if v_item.id is null then
    raise exception 'Item % não encontrado.', p_item_id using errcode = '22023';
  end if;
  if not v_item.is_stock_tracked then
    raise exception 'O item "%" não controla saldo de estoque.', v_item.name using errcode = '22023';
  end if;
  if not private.movement_sign_ok(p_type, v_qty) then
    raise exception 'Sinal da quantidade incompatível com %.', p_type using errcode = '22023';
  end if;
  if not private.movement_kind_ok(p_type, v_item.kind, v_item.is_sellable) then
    raise exception 'Movimentação % não se aplica a itens do tipo %.', p_type, v_item.kind using errcode = '22023';
  end if;
  if p_type in ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'LOSS', 'GIFT', 'SAMPLE', 'PERSONAL_USE', 'REVERSAL')
     and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo da movimentação.' using errcode = '22023';
  end if;
  if (p_type = 'REVERSAL') <> (p_reverses_id is not null) then
    raise exception 'Estorno precisa indicar o movimento estornado.' using errcode = '22023';
  end if;
  if v_item.kind = 'FILAMENT' and p_lot_id is null and v_qty > 0 then
    raise exception 'Entradas de filamento precisam do carretel (lote).' using errcode = '22023';
  end if;
  perform private.assert_open_period(private.local_date(p_occurred_at));

  -- Trava o saldo (e o carretel) antes de calcular (princípio 3).
  select * into v_bal from public.stock_balances b where b.item_id = p_item_id for update;
  if v_bal.item_id is null then
    insert into public.stock_balances (item_id) values (p_item_id) returning * into v_bal;
  end if;
  if p_lot_id is not null then
    select * into v_lot from public.stock_lots l where l.id = p_lot_id for update;
    if v_lot.id is null or v_lot.item_id <> p_item_id then
      raise exception 'Carretel/lote inválido para este item.' using errcode = '22023';
    end if;
  end if;

  v_avg := row(v_bal.avg_cost_material, v_bal.avg_cost_energy, v_bal.avg_cost_depreciation,
               v_bal.avg_cost_operational, v_bal.avg_cost_labor)::private.cost_layers;
  v_old_qty := v_bal.qty_on_hand;
  v_new_qty := v_old_qty + v_qty;

  if v_qty < 0 then
    -- Saída: usa o custo médio vigente e não o altera (exceto estorno de entrada).
    v_unit := case when p_type = 'REVERSAL' then p_cost else v_avg end;
    v_available := v_bal.qty_on_hand - v_bal.qty_reserved + coalesce(p_consume_reserved, 0);
    if -v_qty > v_available and not v_settings.allow_negative_stock then
      raise exception 'Saldo livre insuficiente de "%": disponível %, necessário %.',
        v_item.name, trim(to_char(greatest(v_available, 0), 'FM999G999G990D999')), trim(to_char(-v_qty, 'FM999G999G990D999'))
        using errcode = 'P0001', hint = 'saldo_insuficiente';
    end if;
    if p_lot_id is not null and -v_qty > v_lot.qty_remaining then
      raise exception 'O carretel % tem só % disponíveis.', v_lot.lot_code, trim(to_char(v_lot.qty_remaining, 'FM999G999G990D999'))
        using errcode = 'P0001', hint = 'saldo_insuficiente';
    end if;
    if p_type = 'REVERSAL' and v_new_qty > 0 then
      -- Estorno de uma entrada: retira o valor dela do custo médio.
      v_avg.material := greatest((v_old_qty * v_avg.material + v_qty * coalesce(v_unit.material, 0)) / v_new_qty, 0);
      v_avg.energy := greatest((v_old_qty * v_avg.energy + v_qty * coalesce(v_unit.energy, 0)) / v_new_qty, 0);
      v_avg.depreciation := greatest((v_old_qty * v_avg.depreciation + v_qty * coalesce(v_unit.depreciation, 0)) / v_new_qty, 0);
      v_avg.operational := greatest((v_old_qty * v_avg.operational + v_qty * coalesce(v_unit.operational, 0)) / v_new_qty, 0);
      v_avg.labor := greatest((v_old_qty * v_avg.labor + v_qty * coalesce(v_unit.labor, 0)) / v_new_qty, 0);
    end if;
  else
    -- Entrada: recalcula o custo médio de cada camada (RN-01).
    if p_type = 'ADJUSTMENT_IN' then
      v_unit := coalesce(p_cost, v_avg);
    else
      if p_cost is null then
        raise exception 'Informe o custo da entrada de "%".', v_item.name using errcode = '22023';
      end if;
      v_unit := p_cost;
    end if;
    if v_old_qty > 0 then
      v_avg.material := (v_old_qty * v_avg.material + v_qty * coalesce(v_unit.material, 0)) / v_new_qty;
      v_avg.energy := (v_old_qty * v_avg.energy + v_qty * coalesce(v_unit.energy, 0)) / v_new_qty;
      v_avg.depreciation := (v_old_qty * v_avg.depreciation + v_qty * coalesce(v_unit.depreciation, 0)) / v_new_qty;
      v_avg.operational := (v_old_qty * v_avg.operational + v_qty * coalesce(v_unit.operational, 0)) / v_new_qty;
      v_avg.labor := (v_old_qty * v_avg.labor + v_qty * coalesce(v_unit.labor, 0)) / v_new_qty;
    else
      -- Saldo zero ou negativo: o novo custo médio é o custo da entrada.
      v_avg := row(coalesce(v_unit.material, 0), coalesce(v_unit.energy, 0), coalesce(v_unit.depreciation, 0),
                   coalesce(v_unit.operational, 0), coalesce(v_unit.labor, 0))::private.cost_layers;
    end if;
  end if;

  v_unit := row(round(coalesce(v_unit.material, 0), 6), round(coalesce(v_unit.energy, 0), 6), round(coalesce(v_unit.depreciation, 0), 6),
                round(coalesce(v_unit.operational, 0), 6), round(coalesce(v_unit.labor, 0), 6))::private.cost_layers;
  v_avg := row(round(v_avg.material, 6), round(v_avg.energy, 6), round(v_avg.depreciation, 6),
               round(v_avg.operational, 6), round(v_avg.labor, 6))::private.cost_layers;
  v_unit_total := v_unit.material + v_unit.energy + v_unit.depreciation + v_unit.operational + v_unit.labor;
  v_avg_total := v_avg.material + v_avg.energy + v_avg.depreciation + v_avg.operational + v_avg.labor;

  if p_lot_id is not null then
    v_lot_remaining := v_lot.qty_remaining + v_qty;
    if v_lot_remaining < 0 then
      raise exception 'Carretel % sem saldo suficiente.', v_lot.lot_code using errcode = 'P0001', hint = 'saldo_insuficiente';
    end if;
    v_lot_status := case
      when v_lot_remaining = 0 then case when v_lot.status = 'DESCARTADO' then 'DESCARTADO' else 'ESGOTADO' end
      when v_lot.status in ('ESGOTADO', 'DESCARTADO') then case when v_lot.opened_at is null then 'FECHADO' else 'ABERTO' end
      when v_qty < 0 and v_lot.status = 'FECHADO' then 'ABERTO'
      else v_lot.status
    end;
    update public.stock_lots
       set qty_remaining = v_lot_remaining,
           qty_initial = greatest(qty_initial, v_lot_remaining),
           status = v_lot_status,
           opened_at = case when v_lot_status = 'ABERTO' and opened_at is null then p_occurred_at else opened_at end,
           finished_at = case when v_lot_remaining = 0 then coalesce(finished_at, p_occurred_at) end
     where id = p_lot_id;
  end if;

  update public.stock_balances
     set qty_on_hand = v_new_qty,
         qty_reserved = qty_reserved - coalesce(p_consume_reserved, 0),
         avg_cost_material = v_avg.material,
         avg_cost_energy = v_avg.energy,
         avg_cost_depreciation = v_avg.depreciation,
         avg_cost_operational = v_avg.operational,
         avg_cost_labor = v_avg.labor,
         avg_cost_total = v_avg_total,
         value_total = round(v_new_qty * v_avg_total, 2),
         last_movement_at = greatest(coalesce(last_movement_at, p_occurred_at), p_occurred_at)
   where item_id = p_item_id;

  insert into public.stock_movements (
    item_id, lot_id, occurred_at, type, qty,
    unit_cost_material, unit_cost_energy, unit_cost_depreciation, unit_cost_operational, unit_cost_labor, unit_cost_total,
    total_cost, qty_after, avg_cost_after, source_type, source_id, operation_id, reason, reverses_id
  )
  values (
    p_item_id, p_lot_id, p_occurred_at, p_type, v_qty,
    v_unit.material, v_unit.energy, v_unit.depreciation, v_unit.operational, v_unit.labor, v_unit_total,
    round(v_qty * v_unit_total, 2), v_new_qty, v_avg_total, p_source_type, p_source_id,
    coalesce(p_operation_id, gen_random_uuid()), nullif(btrim(coalesce(p_reason, '')), ''), p_reverses_id
  )
  returning * into v_row;
  return v_row;
end;
$$;

-- Resultado de uma saída que pode ter sido dividida entre carretéis.
create type private.issue_result as (
  movement_ids bigint[],
  qty numeric,
  total_cost numeric,
  material numeric,
  energy numeric,
  depreciation numeric,
  operational numeric,
  labor numeric
);

-- Saída de estoque. Filamento: baixa do carretel ABERTO e, se acabar, do FECHADO mais
-- antigo (FIFO físico, US-1.6), uma movimentação por carretel.
-- total_cost (dinheiro, positivo) é a soma dos movimentos; as camadas guardam qty × custo unitário.
create function private.issue_stock(
  p_item_id bigint,
  p_qty numeric,
  p_type text,
  p_occurred_at timestamptz,
  p_source_type text,
  p_source_id bigint,
  p_reason text default null,
  p_lot_id bigint default null,
  p_consume_reserved numeric default 0,
  p_operation_id uuid default null
)
returns private.issue_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items;
  v_bal public.stock_balances;
  v_remaining numeric := round(p_qty, 3);
  v_take numeric;
  v_lot record;
  v_mv public.stock_movements;
  v_result private.issue_result := row('{}'::bigint[], 0, 0, 0, 0, 0, 0, 0)::private.issue_result;
  v_operation uuid := coalesce(p_operation_id, gen_random_uuid());
  v_settings public.settings := private.settings();
begin
  if v_remaining is null or v_remaining <= 0 then
    raise exception 'Quantidade de saída inválida.' using errcode = '22023';
  end if;
  select * into v_item from public.items i where i.id = p_item_id;
  if v_item.kind = 'FILAMENT' then
    select * into v_bal from public.stock_balances b where b.item_id = p_item_id for update;
    if v_remaining > v_bal.qty_on_hand - v_bal.qty_reserved and not v_settings.allow_negative_stock then
      raise exception 'Saldo insuficiente de "%": disponível % g, necessário % g.',
        v_item.name, trim(to_char(greatest(v_bal.qty_on_hand - v_bal.qty_reserved, 0), 'FM999G999G990D999')),
        trim(to_char(v_remaining, 'FM999G999G990D999'))
        using errcode = 'P0001', hint = 'saldo_insuficiente';
    end if;
    for v_lot in
      select l.id, l.qty_remaining from public.stock_lots l
      where l.item_id = p_item_id and l.qty_remaining > 0 and l.status in ('ABERTO', 'FECHADO')
      order by (l.id = p_lot_id) desc nulls last, (l.status = 'ABERTO') desc, l.opened_at nulls last, l.received_at, l.id
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_lot.qty_remaining);
      v_mv := private.post_movement(p_item_id, p_type, -v_take, p_occurred_at, null, v_lot.id, p_source_type, p_source_id,
                                    p_reason, null, 0, v_operation);
      v_result.movement_ids := v_result.movement_ids || v_mv.id;
      v_result.qty := v_result.qty + v_take;
      v_result.total_cost := v_result.total_cost - v_mv.total_cost;
      v_result.material := v_result.material + v_take * v_mv.unit_cost_material;
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      -- Só chega aqui com saldo negativo permitido (RN-20).
      v_mv := private.post_movement(p_item_id, p_type, -v_remaining, p_occurred_at, null, null, p_source_type, p_source_id,
                                    p_reason, null, 0, v_operation);
      v_result.movement_ids := v_result.movement_ids || v_mv.id;
      v_result.qty := v_result.qty + v_remaining;
      v_result.total_cost := v_result.total_cost - v_mv.total_cost;
      v_result.material := v_result.material + v_remaining * v_mv.unit_cost_material;
    end if;
    return v_result;
  end if;

  v_mv := private.post_movement(p_item_id, p_type, -v_remaining, p_occurred_at, null, p_lot_id, p_source_type, p_source_id,
                                p_reason, null, p_consume_reserved, v_operation);
  v_result.movement_ids := array[v_mv.id];
  v_result.qty := v_remaining;
  v_result.total_cost := -v_mv.total_cost;
  v_result.material := v_remaining * v_mv.unit_cost_material;
  v_result.energy := v_remaining * v_mv.unit_cost_energy;
  v_result.depreciation := v_remaining * v_mv.unit_cost_depreciation;
  v_result.operational := v_remaining * v_mv.unit_cost_operational;
  v_result.labor := v_remaining * v_mv.unit_cost_labor;
  return v_result;
end;
$$;

-- Entrada de estoque. Filamento: cria um carretel (lote) por entrada.
create function private.receive_stock(
  p_item_id bigint,
  p_qty numeric,
  p_type text,
  p_occurred_at timestamptz,
  p_cost private.cost_layers,
  p_source_type text,
  p_source_id bigint,
  p_reason text default null,
  p_reference_cost boolean default false,
  p_operation_id uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_lot_id bigint;
begin
  select i.kind into v_kind from public.items i where i.id = p_item_id;
  if v_kind = 'FILAMENT' then
    insert into public.stock_lots (item_id, lot_code, received_at, qty_initial, qty_remaining, unit_cost_in, reference_cost, status, source_type, source_id)
    values (p_item_id, private.next_lot_code(p_item_id), p_occurred_at, round(p_qty, 3), 0,
            round(coalesce((p_cost).material, 0), 6), p_reference_cost, 'FECHADO', p_source_type, p_source_id)
    returning id into v_lot_id;
  end if;
  return private.post_movement(p_item_id, p_type, p_qty, p_occurred_at, p_cost, v_lot_id, p_source_type, p_source_id,
                               p_reason, null, 0, p_operation_id);
end;
$$;

-- Divide qty × custo por camada em dinheiro, ajustando a última camada não nula para
-- que a soma bata com o total do movimento.
create function private.money_layers(p_qty numeric, p_unit private.cost_layers, p_total numeric)
returns private.cost_layers
language plpgsql
immutable
set search_path = ''
as $$
declare
  v private.cost_layers;
  v_sum numeric;
  v_diff numeric;
begin
  v := row(round(p_qty * coalesce(p_unit.material, 0), 2), round(p_qty * coalesce(p_unit.energy, 0), 2),
           round(p_qty * coalesce(p_unit.depreciation, 0), 2), round(p_qty * coalesce(p_unit.operational, 0), 2),
           round(p_qty * coalesce(p_unit.labor, 0), 2))::private.cost_layers;
  v_sum := v.material + v.energy + v.depreciation + v.operational + v.labor;
  v_diff := round(p_total, 2) - v_sum;
  if v_diff <> 0 then
    if v.material <> 0 or (v.energy = 0 and v.depreciation = 0 and v.operational = 0 and v.labor = 0) then
      v.material := v.material + v_diff;
    elsif v.operational <> 0 then
      v.operational := v.operational + v_diff;
    elsif v.energy <> 0 then
      v.energy := v.energy + v_diff;
    elsif v.depreciation <> 0 then
      v.depreciation := v.depreciation + v_diff;
    else
      v.labor := v.labor + v_diff;
    end if;
  end if;
  return v;
end;
$$;

-- Lançamento de resultado das saídas avulsas e ajustes.
create function private.stock_result_code(p_type text, p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'TOOL' then null
    when p_type in ('LOSS', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT') then '2.7'
    when p_type in ('GIFT', 'SAMPLE') then '3.5'
    when p_type = 'CONSUMABLE_USE' then '4.7'
    when p_type = 'MAINTENANCE_CONSUMPTION' then '4.2'
    else null
  end;
$$;

create function private.post_stock_result(p_movement public.stock_movements, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_code text;
begin
  select i.kind into v_kind from public.items i where i.id = p_movement.item_id;
  v_code := private.stock_result_code(p_movement.type, v_kind);
  if v_code is not null then
    -- total_cost tem o sinal da quantidade: saída negativa reduz o resultado; ajuste de entrada aumenta.
    perform private.post_result(private.local_date(p_movement.occurred_at), v_code, p_movement.total_cost,
                                'stock_movement', p_movement.id, p_description, null, p_movement.item_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs públicas de cadastro
-- -----------------------------------------------------------------------------

create function public.save_supplier(p_supplier jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_supplier ->> 'id', '')::bigint;
begin
  perform private.assert_owner();
  if v_id is null then
    insert into public.suppliers (name, document, kind, contact, url, notes)
    values (btrim(p_supplier ->> 'name'), nullif(btrim(coalesce(p_supplier ->> 'document', '')), ''), nullif(p_supplier ->> 'kind', ''),
            nullif(btrim(coalesce(p_supplier ->> 'contact', '')), ''), nullif(btrim(coalesce(p_supplier ->> 'url', '')), ''),
            nullif(btrim(coalesce(p_supplier ->> 'notes', '')), ''))
    returning id into v_id;
  else
    update public.suppliers s
       set name = btrim(coalesce(p_supplier ->> 'name', s.name)),
           document = nullif(btrim(coalesce(p_supplier ->> 'document', '')), ''),
           kind = nullif(p_supplier ->> 'kind', ''),
           contact = nullif(btrim(coalesce(p_supplier ->> 'contact', '')), ''),
           url = nullif(btrim(coalesce(p_supplier ->> 'url', '')), ''),
           notes = nullif(btrim(coalesce(p_supplier ->> 'notes', '')), ''),
           active = coalesce((p_supplier ->> 'active')::boolean, s.active)
     where s.id = v_id;
    if not found then
      raise exception 'Fornecedor não encontrado.' using errcode = '22023';
    end if;
  end if;
  return v_id;
end;
$$;

-- Cadastro de item (US-1.1, US-1.2). Produto pronto é criado pela variação (Módulo 4).
create function public.save_item(p_item jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_item ->> 'id', '')::bigint;
  v_old public.items;
  v_kind text := p_item ->> 'kind';
  v_unit text;
  v_has_movements boolean := false;
  v_spec jsonb := coalesce(p_item -> 'filament', '{}'::jsonb);
  v_tool jsonb := coalesce(p_item -> 'tool', '{}'::jsonb);
  v_sku text := upper(nullif(btrim(coalesce(p_item ->> 'sku', '')), ''));
  v_dup record;
begin
  perform private.assert_owner();
  if v_id is not null then
    select * into v_old from public.items i where i.id = v_id for update;
    if v_old.id is null then
      raise exception 'Item não encontrado.' using errcode = '22023';
    end if;
    v_has_movements := exists (select 1 from public.stock_movements m where m.item_id = v_id);
    v_kind := coalesce(v_kind, v_old.kind);
    if v_old.kind = 'FINISHED_GOOD' and v_kind <> 'FINISHED_GOOD' then
      raise exception 'Produto pronto é gerido pela variação do produto.' using errcode = '22023';
    end if;
  end if;
  if v_kind not in ('FILAMENT', 'COMPONENT', 'PACKAGING', 'CONSUMABLE', 'TOOL', 'FINISHED_GOOD') then
    raise exception 'Tipo de item inválido.' using errcode = '22023';
  end if;
  if v_kind = 'FINISHED_GOOD' and v_id is null then
    raise exception 'Produtos prontos são criados ao cadastrar a variação do produto.' using errcode = '22023';
  end if;
  v_unit := case when v_kind = 'FILAMENT' then 'G' when v_kind in ('TOOL', 'FINISHED_GOOD', 'COMPONENT', 'PACKAGING') then 'UN'
                 else coalesce(nullif(p_item ->> 'unit', ''), 'UN') end;
  if v_has_movements and (v_kind <> v_old.kind or v_unit <> v_old.unit) then
    raise exception 'Este item já tem movimentações: o tipo e a unidade não podem mudar.' using errcode = '22023';
  end if;

  if v_kind = 'FILAMENT' then
    select i.id, i.name, i.sku into v_dup
    from public.filament_specs f join public.items i on i.id = f.item_id
    where f.material = v_spec ->> 'material'
      and lower(btrim(f.brand)) = lower(btrim(coalesce(v_spec ->> 'brand', '')))
      and lower(btrim(f.color_name)) = lower(btrim(coalesce(v_spec ->> 'color_name', '')))
      and (v_id is null or i.id <> v_id);
    if v_dup.id is not null then
      raise exception 'Já existe o filamento "%" (%) com o mesmo material, marca e cor.', v_dup.name, v_dup.sku
        using errcode = '23505', hint = 'item:' || v_dup.id;
    end if;
  end if;

  if v_sku is null then
    v_sku := coalesce(v_old.sku, public.suggest_item_sku(v_kind, p_item ->> 'name', v_spec ->> 'material', v_spec ->> 'color_name'));
  end if;

  if v_id is null then
    insert into public.items (sku, name, kind, unit, is_stock_tracked, is_sellable, min_qty, reorder_qty, location, default_supplier_id, notes)
    values (
      v_sku, btrim(p_item ->> 'name'), v_kind, v_unit,
      case when v_kind = 'CONSUMABLE' then coalesce((p_item ->> 'is_stock_tracked')::boolean, true) else true end,
      case when v_kind = 'COMPONENT' then coalesce((p_item ->> 'is_sellable')::boolean, false) else false end,
      coalesce(nullif(p_item ->> 'min_qty', '')::numeric, 0), coalesce(nullif(p_item ->> 'reorder_qty', '')::numeric, 0),
      nullif(btrim(coalesce(p_item ->> 'location', '')), ''), nullif(p_item ->> 'default_supplier_id', '')::bigint,
      nullif(btrim(coalesce(p_item ->> 'notes', '')), '')
    )
    returning id into v_id;
  else
    update public.items i
       set sku = v_sku,
           name = btrim(coalesce(p_item ->> 'name', i.name)),
           kind = v_kind,
           unit = v_unit,
           is_stock_tracked = case when v_kind = 'CONSUMABLE' and not v_has_movements then coalesce((p_item ->> 'is_stock_tracked')::boolean, i.is_stock_tracked) else i.is_stock_tracked end,
           is_sellable = case when v_kind = 'COMPONENT' then coalesce((p_item ->> 'is_sellable')::boolean, i.is_sellable) else i.is_sellable end,
           min_qty = coalesce(nullif(p_item ->> 'min_qty', '')::numeric, i.min_qty),
           reorder_qty = coalesce(nullif(p_item ->> 'reorder_qty', '')::numeric, i.reorder_qty),
           location = nullif(btrim(coalesce(p_item ->> 'location', '')), ''),
           default_supplier_id = nullif(p_item ->> 'default_supplier_id', '')::bigint,
           notes = nullif(btrim(coalesce(p_item ->> 'notes', '')), '')
     where i.id = v_id;
  end if;

  if v_kind = 'FILAMENT' then
    insert into public.filament_specs (item_id, material, brand, color_name, color_hex, diameter_mm, density_g_cm3,
                                       nominal_spool_g, empty_spool_tare_g, needs_drying)
    values (
      v_id, v_spec ->> 'material', btrim(coalesce(v_spec ->> 'brand', '')), btrim(v_spec ->> 'color_name'),
      coalesce(nullif(v_spec ->> 'color_hex', ''), '#888888'),
      coalesce(nullif(v_spec ->> 'diameter_mm', '')::numeric, 1.75),
      coalesce(nullif(v_spec ->> 'density_g_cm3', '')::numeric, private.typical_density(v_spec ->> 'material')),
      coalesce(nullif(v_spec ->> 'nominal_spool_g', '')::integer, 1000),
      coalesce(nullif(v_spec ->> 'empty_spool_tare_g', '')::integer, 0),
      coalesce((v_spec ->> 'needs_drying')::boolean, false)
    )
    on conflict (item_id) do update
      set material = excluded.material, brand = excluded.brand, color_name = excluded.color_name, color_hex = excluded.color_hex,
          diameter_mm = excluded.diameter_mm, density_g_cm3 = excluded.density_g_cm3, nominal_spool_g = excluded.nominal_spool_g,
          empty_spool_tare_g = excluded.empty_spool_tare_g, needs_drying = excluded.needs_drying;
  elsif v_kind = 'TOOL' then
    insert into public.tool_specs (item_id, condition, acquired_at, acquisition_value)
    values (v_id, coalesce(nullif(v_tool ->> 'condition', ''), 'BOA'), nullif(v_tool ->> 'acquired_at', '')::date,
            nullif(v_tool ->> 'acquisition_value', '')::numeric)
    on conflict (item_id) do update
      set acquired_at = excluded.acquired_at, acquisition_value = excluded.acquisition_value;
  end if;
  return v_id;
end;
$$;

create function public.set_item_active(p_item_id bigint, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  update public.items set active = p_active where id = p_item_id;
  if not found then
    raise exception 'Item não encontrado.' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs públicas de estoque
-- -----------------------------------------------------------------------------

-- Saldo inicial (US-1.3). p_entries: [{qty, unit_cost}] — filamento: um carretel por entrada;
-- custo em branco usa a referência de R$ 0,10/g e marca "custo de referência".
create function public.register_opening_balance(
  p_request_id uuid,
  p_item_id bigint,
  p_entries jsonb,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_item public.items;
  v_entry jsonb;
  v_qty numeric;
  v_cost numeric;
  v_reference boolean;
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_mv public.stock_movements;
  v_ids bigint[] := '{}';
  v_operation uuid := gen_random_uuid();
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'register_opening_balance');
  if v_done is not null then
    return v_done;
  end if;
  select * into v_item from public.items i where i.id = p_item_id;
  if v_item.id is null then
    raise exception 'Item não encontrado.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.stock_movements m
    where m.item_id = p_item_id and m.type = 'OPENING'
      and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id)
  ) then
    raise exception 'Este item já tem saldo inicial. Para corrigir, use o ajuste de inventário.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos uma quantidade.' using errcode = '22023';
  end if;
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_qty := round(nullif(v_entry ->> 'qty', '')::numeric, 3);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantidade inválida no saldo inicial.' using errcode = '22023';
    end if;
    v_cost := nullif(v_entry ->> 'unit_cost', '')::numeric;
    v_reference := false;
    if v_cost is null then
      if v_item.kind = 'FILAMENT' then
        v_cost := (private.settings()).filament_reference_cost_g;
        v_reference := true;
      elsif v_item.kind = 'TOOL' then
        v_cost := 0;
      else
        raise exception 'Informe o custo unitário de "%".', v_item.name using errcode = '22023';
      end if;
    end if;
    if v_cost < 0 then
      raise exception 'Custo unitário inválido.' using errcode = '22023';
    end if;
    if v_item.kind = 'TOOL' then
      v_cost := 0; -- ferramentas não têm valor de estoque (despesa na compra)
    end if;
    v_mv := private.receive_stock(
      p_item_id, v_qty, 'OPENING', v_at,
      case when v_item.kind = 'FINISHED_GOOD' and v_entry ? 'layers' then
        row(coalesce((v_entry #>> '{layers,material}')::numeric, 0), coalesce((v_entry #>> '{layers,energy}')::numeric, 0),
            coalesce((v_entry #>> '{layers,depreciation}')::numeric, 0), coalesce((v_entry #>> '{layers,operational}')::numeric, 0),
            coalesce((v_entry #>> '{layers,labor}')::numeric, 0))::private.cost_layers
      else row(v_cost, 0, 0, 0, 0)::private.cost_layers end,
      'stock_opening', p_item_id, 'Saldo inicial', v_reference, v_operation);
    v_ids := v_ids || v_mv.id;
  end loop;
  perform private.audit('CREATE', 'stock_opening', p_item_id, v_item.sku, 'Saldo inicial de ' || v_item.name,
                        jsonb_build_object('movimentos', to_jsonb(v_ids)));
  return private.idem_finish(p_request_id, jsonb_build_object('movement_ids', to_jsonb(v_ids), 'operation_id', v_operation));
end;
$$;

-- Saída avulsa (US-1.9): perda, brinde, amostra, uso pessoal ou consumo de consumível.
create function public.register_stock_issue(
  p_request_id uuid,
  p_item_id bigint,
  p_type text,
  p_qty numeric,
  p_reason text,
  p_lot_id bigint default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_item public.items;
  v_issue private.issue_result;
  v_mv public.stock_movements;
  v_id bigint;
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_operation uuid := gen_random_uuid();
  v_label text;
begin
  perform private.assert_role(case when p_type = 'LOSS' then array['dono', 'producao'] else array['dono'] end);
  v_done := private.idem_begin(p_request_id, 'register_stock_issue');
  if v_done is not null then
    return v_done;
  end if;
  if p_type not in ('LOSS', 'GIFT', 'SAMPLE', 'PERSONAL_USE', 'CONSUMABLE_USE') then
    raise exception 'Tipo de saída avulsa inválido.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Descreva o motivo da saída.' using errcode = '22023';
  end if;
  select * into v_item from public.items i where i.id = p_item_id;
  if v_item.id is null then
    raise exception 'Item não encontrado.' using errcode = '22023';
  end if;
  v_label := case p_type when 'LOSS' then 'Perda' when 'GIFT' then 'Brinde' when 'SAMPLE' then 'Amostra'
                         when 'PERSONAL_USE' then 'Uso pessoal' else 'Consumo' end || ' — ' || btrim(p_reason);
  v_issue := private.issue_stock(p_item_id, p_qty, p_type, v_at, 'stock_issue', null, btrim(p_reason), p_lot_id, 0, v_operation);
  foreach v_id in array v_issue.movement_ids loop
    select * into v_mv from public.stock_movements m where m.id = v_id;
    perform private.post_stock_result(v_mv, v_label || ' — ' || v_item.name);
    if p_type = 'PERSONAL_USE' then
      -- Retirada em bens: movimento do dono, nunca despesa.
      perform private.post_owner_movement('GOODS_WITHDRAWAL', private.local_date(v_at), -v_mv.total_cost,
                                          'Uso pessoal: ' || v_item.name, null, null, null, v_mv.id);
    end if;
  end loop;
  perform private.audit('CREATE', 'stock_issue', p_item_id, v_item.sku, v_label,
                        jsonb_build_object('quantidade', p_qty, 'custo', v_issue.total_cost, 'movimentos', to_jsonb(v_issue.movement_ids)));
  return private.idem_finish(p_request_id, jsonb_build_object('movement_ids', to_jsonb(v_issue.movement_ids),
                                                              'operation_id', v_operation, 'total_cost', v_issue.total_cost));
end;
$$;

-- Ajuste por contagem ou pesagem (US-1.7). Informe a quantidade contada ou o peso bruto
-- do carretel na balança (restante = peso bruto − tara do carretel vazio).
create function public.adjust_stock(
  p_request_id uuid,
  p_item_id bigint,
  p_counted_qty numeric,
  p_reason text,
  p_lot_id bigint default null,
  p_gross_weight_g numeric default null,
  p_confirm_large boolean default false,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_item public.items;
  v_lot public.stock_lots;
  v_bal public.stock_balances;
  v_system numeric;
  v_counted numeric;
  v_diff numeric;
  v_tare numeric;
  v_mv public.stock_movements;
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cost private.cost_layers;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'adjust_stock');
  if v_done is not null then
    return v_done;
  end if;
  select * into v_item from public.items i where i.id = p_item_id;
  if v_item.id is null then
    raise exception 'Item não encontrado.' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Informe o motivo do ajuste.' using errcode = '22023';
  end if;
  select * into v_bal from public.stock_balances b where b.item_id = p_item_id for update;
  if p_lot_id is not null then
    select * into v_lot from public.stock_lots l where l.id = p_lot_id and l.item_id = p_item_id for update;
    if v_lot.id is null then
      raise exception 'Carretel não encontrado.' using errcode = '22023';
    end if;
    v_system := v_lot.qty_remaining;
  else
    if v_item.kind = 'FILAMENT' and exists (select 1 from public.stock_lots l where l.item_id = p_item_id and l.qty_remaining > 0) then
      raise exception 'Escolha o carretel a ajustar.' using errcode = '22023';
    end if;
    v_system := v_bal.qty_on_hand;
  end if;
  if p_gross_weight_g is not null then
    select coalesce(f.empty_spool_tare_g, 0) into v_tare from public.filament_specs f where f.item_id = p_item_id;
    v_counted := round(p_gross_weight_g - coalesce(v_tare, 0), 3);
    if v_counted < 0 then
      raise exception 'O peso bruto é menor que a tara do carretel vazio.' using errcode = '22023';
    end if;
  else
    v_counted := round(p_counted_qty, 3);
  end if;
  if v_counted is null or v_counted < 0 then
    raise exception 'Quantidade contada inválida.' using errcode = '22023';
  end if;
  v_diff := v_counted - v_system;
  if v_diff = 0 then
    return private.idem_finish(p_request_id, jsonb_build_object('diff', 0, 'movement_id', null));
  end if;
  if v_system > 0 and abs(v_diff) > v_system * 0.10 and not p_confirm_large then
    raise exception 'A diferença (%) passa de 10%% do saldo do sistema. Confirme o ajuste.', trim(to_char(v_diff, 'FM999G999G990D999'))
      using errcode = 'P0001', hint = 'confirmacao_necessaria';
  end if;
  if v_diff > 0 then
    v_cost := case
      when v_bal.avg_cost_total > 0 then null
      when v_lot.id is not null then row(v_lot.unit_cost_in, 0, 0, 0, 0)::private.cost_layers
      when v_item.kind = 'FILAMENT' then row((private.settings()).filament_reference_cost_g, 0, 0, 0, 0)::private.cost_layers
      else null end;
    if v_item.kind = 'FILAMENT' and v_lot.id is null then
      v_mv := private.receive_stock(p_item_id, v_diff, 'ADJUSTMENT_IN', v_at,
                                    coalesce(v_cost, row(v_bal.avg_cost_material, 0, 0, 0, 0)::private.cost_layers),
                                    'stock_adjustment', p_item_id, v_reason, v_bal.avg_cost_total = 0);
    else
      v_mv := private.post_movement(p_item_id, 'ADJUSTMENT_IN', v_diff, v_at, v_cost, v_lot.id, 'stock_adjustment', p_item_id, v_reason);
    end if;
  else
    v_mv := private.post_movement(p_item_id, 'ADJUSTMENT_OUT', v_diff, v_at, null, v_lot.id, 'stock_adjustment', p_item_id, v_reason);
  end if;
  perform private.post_stock_result(v_mv, 'Ajuste de estoque — ' || v_item.name || ' — ' || v_reason);
  perform private.audit('CREATE', 'stock_adjustment', p_item_id, v_item.sku, 'Ajuste: ' || v_reason,
                        jsonb_build_object('sistema', v_system, 'contado', v_counted, 'diferenca', v_diff));
  return private.idem_finish(p_request_id, jsonb_build_object('diff', v_diff, 'movement_id', v_mv.id, 'operation_id', v_mv.operation_id,
                                                              'system_qty', v_system, 'counted_qty', v_counted));
end;
$$;

-- "Descartar resto" do carretel (US-1.6): o restante sai como perda.
create function public.discard_lot(p_request_id uuid, p_lot_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_lot public.stock_lots;
  v_mv public.stock_movements;
  v_name text;
begin
  perform private.assert_production();
  v_done := private.idem_begin(p_request_id, 'discard_lot');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do descarte.' using errcode = '22023';
  end if;
  select * into v_lot from public.stock_lots l where l.id = p_lot_id for update;
  if v_lot.id is null or v_lot.qty_remaining <= 0 then
    raise exception 'Carretel sem saldo para descartar.' using errcode = '22023';
  end if;
  select i.name into v_name from public.items i where i.id = v_lot.item_id;
  v_mv := private.post_movement(v_lot.item_id, 'LOSS', -v_lot.qty_remaining, now(), null, v_lot.id, 'lot_discard', v_lot.id, btrim(p_reason));
  update public.stock_lots set status = 'DESCARTADO' where id = v_lot.id;
  perform private.post_stock_result(v_mv, 'Descarte do carretel ' || v_lot.lot_code || ' — ' || btrim(p_reason));
  perform private.audit('CREATE', 'stock_lot', v_lot.id, v_lot.lot_code, 'Resto descartado: ' || btrim(p_reason),
                        jsonb_build_object('quantidade', v_lot.qty_remaining));
  return private.idem_finish(p_request_id, jsonb_build_object('movement_id', v_mv.id, 'operation_id', v_mv.operation_id));
end;
$$;

-- Marca qual carretel está aberto (os outros abertos do mesmo filamento continuam como estão).
create function public.open_lot(p_lot_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_production();
  update public.stock_lots set status = 'ABERTO', opened_at = coalesce(opened_at, now())
   where id = p_lot_id and status = 'FECHADO' and qty_remaining > 0;
  if not found then
    raise exception 'Só carretéis fechados com saldo podem ser abertos.' using errcode = '22023';
  end if;
end;
$$;

-- Estorno de movimentação avulsa (US-1.12, RN-21): movimento inverso com o mesmo custo.
-- Movimentos de documentos (compra, impressão, venda) são estornados pelo documento.
create function public.reverse_movement(p_request_id uuid, p_movement_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_orig public.stock_movements;
  v_mv public.stock_movements;
  v_new public.stock_movements;
  v_ids bigint[] := '{}';
  v_owner_id bigint;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_operation uuid := gen_random_uuid();
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'reverse_movement');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  select * into v_orig from public.stock_movements m where m.id = p_movement_id;
  if v_orig.id is null then
    raise exception 'Movimentação não encontrada.' using errcode = '22023';
  end if;
  if v_orig.type = 'REVERSAL' then
    raise exception 'Um estorno não pode ser estornado.' using errcode = '22023';
  end if;
  if coalesce(v_orig.source_type, '') not in ('stock_opening', 'stock_issue', 'stock_adjustment', 'lot_discard') then
    raise exception 'Esta movimentação foi gerada por um documento (%). Estorne o documento de origem.',
      coalesce(v_orig.source_type, 'desconhecido') using errcode = '22023', hint = 'estornar_documento';
  end if;
  -- Estorna a operação inteira (ex.: saída dividida entre dois carretéis).
  for v_mv in
    select m.* from public.stock_movements m where m.operation_id = v_orig.operation_id order by m.id desc
  loop
    if exists (select 1 from public.stock_movements r where r.reverses_id = v_mv.id) then
      raise exception 'Esta movimentação já foi estornada.' using errcode = '22023';
    end if;
    v_new := private.post_movement(
      v_mv.item_id, 'REVERSAL', -v_mv.qty, now(),
      row(v_mv.unit_cost_material, v_mv.unit_cost_energy, v_mv.unit_cost_depreciation, v_mv.unit_cost_operational, v_mv.unit_cost_labor)::private.cost_layers,
      v_mv.lot_id, v_mv.source_type, v_mv.source_id, v_reason, v_mv.id, 0, v_operation);
    v_ids := v_ids || v_new.id;
    perform private.reverse_results('stock_movement', v_mv.id, v_reason);
    select o.id into v_owner_id from public.owner_movements o where o.stock_movement_id = v_mv.id and o.reverses_id is null;
    if v_owner_id is not null then
      perform private.reverse_owner_movement_row(v_owner_id, v_reason);
    end if;
  end loop;
  perform private.audit('REVERSE', 'stock_movement', v_orig.id, null, 'Estorno: ' || v_reason, jsonb_build_object('estornos', to_jsonb(v_ids)));
  return private.idem_finish(p_request_id, jsonb_build_object('movement_ids', to_jsonb(v_ids)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Reconstrução do saldo a partir do razão (seção 3.5)
-- -----------------------------------------------------------------------------

create function private.replay_item(p_item_id bigint)
returns table (qty numeric, material numeric, energy numeric, depreciation numeric, operational numeric, labor numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mv public.stock_movements;
  v_q numeric := 0;
  v private.cost_layers := row(0, 0, 0, 0, 0)::private.cost_layers;
  v_new numeric;
begin
  for v_mv in select m.* from public.stock_movements m where m.item_id = p_item_id order by m.id loop
    v_new := v_q + v_mv.qty;
    if v_mv.qty > 0 then
      if v_q > 0 then
        v := row(round((v_q * v.material + v_mv.qty * v_mv.unit_cost_material) / v_new, 6),
                 round((v_q * v.energy + v_mv.qty * v_mv.unit_cost_energy) / v_new, 6),
                 round((v_q * v.depreciation + v_mv.qty * v_mv.unit_cost_depreciation) / v_new, 6),
                 round((v_q * v.operational + v_mv.qty * v_mv.unit_cost_operational) / v_new, 6),
                 round((v_q * v.labor + v_mv.qty * v_mv.unit_cost_labor) / v_new, 6))::private.cost_layers;
      else
        v := row(v_mv.unit_cost_material, v_mv.unit_cost_energy, v_mv.unit_cost_depreciation,
                 v_mv.unit_cost_operational, v_mv.unit_cost_labor)::private.cost_layers;
      end if;
    elsif v_mv.type = 'REVERSAL' and v_new > 0 then
      v := row(round(greatest((v_q * v.material + v_mv.qty * v_mv.unit_cost_material) / v_new, 0), 6),
               round(greatest((v_q * v.energy + v_mv.qty * v_mv.unit_cost_energy) / v_new, 0), 6),
               round(greatest((v_q * v.depreciation + v_mv.qty * v_mv.unit_cost_depreciation) / v_new, 0), 6),
               round(greatest((v_q * v.operational + v_mv.qty * v_mv.unit_cost_operational) / v_new, 0), 6),
               round(greatest((v_q * v.labor + v_mv.qty * v_mv.unit_cost_labor) / v_new, 0), 6))::private.cost_layers;
    end if;
    v_q := v_new;
  end loop;
  return query select v_q, v.material, v.energy, v.depreciation, v.operational, v.labor;
end;
$$;

-- Lista divergências entre o cache e o razão (vazio = tudo certo). Com p_apply, corrige o cache.
create function private.rebuild_balances(p_apply boolean default false)
returns table (item_id bigint, sku text, problem text, cached text, ledger text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_r record;
  v_lots numeric;
begin
  for v_item in
    select i.id, i.sku, i.kind, b.qty_on_hand, b.avg_cost_material, b.avg_cost_energy, b.avg_cost_depreciation,
           b.avg_cost_operational, b.avg_cost_labor, b.value_total
    from public.items i join public.stock_balances b on b.item_id = i.id
    order by i.id
  loop
    select * into v_r from private.replay_item(v_item.id);
    if v_r.qty <> v_item.qty_on_hand then
      item_id := v_item.id; sku := v_item.sku; problem := 'saldo'; cached := v_item.qty_on_hand::text; ledger := v_r.qty::text;
      return next;
    end if;
    if (v_r.material, v_r.energy, v_r.depreciation, v_r.operational, v_r.labor)
       is distinct from (v_item.avg_cost_material, v_item.avg_cost_energy, v_item.avg_cost_depreciation, v_item.avg_cost_operational, v_item.avg_cost_labor) then
      item_id := v_item.id; sku := v_item.sku; problem := 'custo_medio';
      cached := concat_ws('/', v_item.avg_cost_material, v_item.avg_cost_energy, v_item.avg_cost_depreciation, v_item.avg_cost_operational, v_item.avg_cost_labor);
      ledger := concat_ws('/', v_r.material, v_r.energy, v_r.depreciation, v_r.operational, v_r.labor);
      return next;
    end if;
    if v_item.kind = 'FILAMENT' then
      select coalesce(sum(l.qty_remaining), 0) into v_lots from public.stock_lots l where l.item_id = v_item.id;
      if v_lots <> greatest(v_r.qty, 0) then
        item_id := v_item.id; sku := v_item.sku; problem := 'carreteis'; cached := v_lots::text; ledger := v_r.qty::text;
        return next;
      end if;
    end if;
    if p_apply then
      update public.stock_balances b
         set qty_on_hand = v_r.qty,
             avg_cost_material = v_r.material, avg_cost_energy = v_r.energy, avg_cost_depreciation = v_r.depreciation,
             avg_cost_operational = v_r.operational, avg_cost_labor = v_r.labor,
             avg_cost_total = v_r.material + v_r.energy + v_r.depreciation + v_r.operational + v_r.labor,
             value_total = round(v_r.qty * (v_r.material + v_r.energy + v_r.depreciation + v_r.operational + v_r.labor), 2)
       where b.item_id = v_item.id;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS: produção lê estoque pelas views (sem custos); tabelas com valores só para dono/leitura
-- -----------------------------------------------------------------------------

alter table public.suppliers enable row level security;
alter table public.items enable row level security;
alter table public.filament_specs enable row level security;
alter table public.tool_specs enable row level security;
alter table public.stock_lots enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;

create policy suppliers_select on public.suppliers for select to authenticated using (private.can_view_costs());
create policy items_select on public.items for select to authenticated using (private.is_member());
create policy filament_specs_select on public.filament_specs for select to authenticated using (private.is_member());
create policy tool_specs_select on public.tool_specs for select to authenticated using (private.can_view_costs());
create policy stock_lots_select on public.stock_lots for select to authenticated using (private.can_view_costs());
create policy stock_movements_select on public.stock_movements for select to authenticated using (private.can_view_costs());
create policy stock_balances_select on public.stock_balances for select to authenticated using (private.can_view_costs());
