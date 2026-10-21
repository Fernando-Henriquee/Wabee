-- =============================================================================
-- Wabee — 0360 Correções do estoque e do financeiro
-- Mensagens com números no formato brasileiro (1.234,5 e R$ 1.234,56), sem
-- depender da configuração regional do servidor.
-- =============================================================================

-- Número em pt-BR, sem zeros à direita: 1234.500 → "1.234,5"; 400 → "400".
create function private.fmt_num(p_value numeric, p_decimals integer default 3)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_int text;
  v_frac text;
begin
  if p_value is null then
    return '';
  end if;
  v_text := trim_scale(round(abs(p_value), p_decimals))::text;
  v_int := split_part(v_text, '.', 1);
  v_frac := split_part(v_text, '.', 2);
  v_int := replace(to_char(v_int::numeric, 'FM999,999,999,999,990'), ',', '.');
  return case when p_value < 0 then '-' else '' end || v_int || case when v_frac <> '' then ',' || v_frac else '' end;
end;
$$;

-- Dinheiro em pt-BR: 1234.5 → "R$ 1.234,50".
create function private.fmt_money(p_value numeric)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null then
    return '';
  end if;
  v_text := translate(to_char(round(abs(p_value), 2), 'FM999,999,999,990.00'), ',.', '.,');
  return case when p_value < 0 then '-' else '' end || 'R$ ' || v_text;
end;
$$;

create or replace function private.post_movement(
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
      raise exception 'Saldo livre insuficiente de "%": disponível % %, necessário % %.',
        v_item.name, private.fmt_num(greatest(v_available, 0)), lower(v_item.unit), private.fmt_num(-v_qty), lower(v_item.unit)
        using errcode = 'P0001', hint = 'saldo_insuficiente';
    end if;
    if p_lot_id is not null and -v_qty > v_lot.qty_remaining then
      raise exception 'O carretel % tem só % disponíveis.', v_lot.lot_code, private.fmt_num(v_lot.qty_remaining) || ' g'
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


create or replace function private.issue_stock(
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
        v_item.name, private.fmt_num(greatest(v_bal.qty_on_hand - v_bal.qty_reserved, 0)),
        private.fmt_num(v_remaining)
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


create or replace function public.adjust_stock(
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
    raise exception 'A diferença (%) passa de 10%% do saldo do sistema. Confirme o ajuste.', private.fmt_num(v_diff)
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


create or replace function public.create_expense(p_request_id uuid, p_expense jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_category public.financial_categories;
  v_total numeric(14,2) := round((p_expense ->> 'amount')::numeric, 2);
  v_share numeric := coalesce(nullif(p_expense ->> 'business_share_pct', '')::numeric, 1);
  v_amount numeric(14,2);
  v_competence date := coalesce(nullif(p_expense ->> 'competence_date', '')::date, private.today());
  v_due date := coalesce(nullif(p_expense ->> 'due_date', '')::date, v_competence);
  v_payer text := coalesce(p_expense ->> 'payer', 'EMPRESA');
  v_account public.payment_accounts;
  v_description text := btrim(coalesce(p_expense ->> 'description', ''));
  v_payable_id bigint;
  v_installment_id bigint;
  v_payment jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'create_expense');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(v_description) < 2 then
    raise exception 'Descreva a despesa.' using errcode = '22023';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'Informe o valor da despesa.' using errcode = '22023';
  end if;
  if v_share <= 0 or v_share > 1 then
    raise exception 'A parte da empresa deve estar entre 0%% e 100%%.' using errcode = '22023';
  end if;
  select * into v_category from public.financial_categories c where c.id = (p_expense ->> 'category_id')::bigint;
  if v_category.id is null or v_category.parent_id is null or not v_category.active
     or v_category.nature not in ('DESPESA_VENDA', 'DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA', 'NAO_OPERACIONAL') then
    raise exception 'Escolha uma categoria de despesa.' using errcode = '22023';
  end if;
  if nullif(p_expense ->> 'account_id', '') is not null then
    select * into v_account from public.payment_accounts a where a.id = (p_expense ->> 'account_id')::bigint;
    if v_account.owner = 'DONO' then
      v_payer := 'DONO';
    end if;
  end if;
  v_amount := round(v_total * v_share, 2);
  if v_share < 1 then
    v_description := format('%s (%s%% de R$ %s)', v_description, private.fmt_num(v_share * 100, 2), private.fmt_num(v_total, 2));
  end if;

  v_payable_id := private.create_title('PAGAR', nullif(p_expense ->> 'supplier_id', '')::bigint, 'expense', null, v_description,
    v_category.code, v_competence, v_amount, jsonb_build_array(jsonb_build_object('due_date', v_due, 'amount', v_amount)),
    v_payer, nullif(p_expense ->> 'owner_funding_type', ''), false, v_account.id);
  update public.payables set source_id = id where id = v_payable_id;
  perform private.post_result(v_competence, v_category.code, -v_amount, 'payable', v_payable_id, v_description);
  select i.id into v_installment_id from public.installments i where i.payable_id = v_payable_id;

  if coalesce((p_expense ->> 'paid')::boolean, false) then
    v_payment := private.settle_payable_installment(v_installment_id, coalesce(nullif(p_expense ->> 'paid_on', '')::date, v_competence),
      null, v_account.id, v_payer, 'DESCONTO', null);
  end if;
  perform private.audit('CREATE', 'payable', v_payable_id, null, 'Despesa: ' || v_description,
                        jsonb_build_object('valor', v_amount, 'categoria', v_category.code));
  return private.idem_finish(p_request_id, jsonb_build_object('payable_id', v_payable_id, 'installment_id', v_installment_id, 'payment', v_payment));
end;
$$;


create or replace function public.register_owner_movement(
  p_request_id uuid,
  p_kind text,
  p_amount numeric,
  p_occurred_on date,
  p_account_id bigint,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_amount numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_on date := coalesce(p_occurred_on, private.today());
  v_cash_id bigint;
  v_owner_id bigint;
  v_code text;
  v_direction text;
  v_label text;
  v_warning text;
  v_result_total numeric;
  v_distributed numeric;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'register_owner_movement');
  if v_done is not null then
    return v_done;
  end if;
  if p_kind not in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_REIMBURSEMENT', 'LOAN_REPAYMENT', 'PRO_LABORE', 'PROFIT_DISTRIBUTION') then
    raise exception 'Tipo de movimento do dono inválido.' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'Informe o valor.' using errcode = '22023';
  end if;
  v_code := case p_kind
    when 'CAPITAL_CONTRIBUTION' then '8.1' when 'OWNER_LOAN' then '8.2' when 'OWNER_REIMBURSEMENT' then '8.3'
    when 'LOAN_REPAYMENT' then '8.5' when 'PRO_LABORE' then '4.8' else '8.4' end;
  v_direction := private.owner_direction(p_kind);
  v_label := case p_kind
    when 'CAPITAL_CONTRIBUTION' then 'Aporte de capital' when 'OWNER_LOAN' then 'Empréstimo do dono'
    when 'OWNER_REIMBURSEMENT' then 'Reembolso ao dono' when 'LOAN_REPAYMENT' then 'Pagamento de empréstimo ao dono'
    when 'PRO_LABORE' then 'Pró-labore' else 'Distribuição de lucro' end;
  if p_notes is not null and btrim(p_notes) <> '' then
    v_label := v_label || ' — ' || btrim(p_notes);
  end if;

  if p_kind = 'PROFIT_DISTRIBUTION' then
    select coalesce(sum(e.amount), 0) into v_result_total
    from public.result_entries e join public.financial_categories c on c.id = e.category_id
    where c.in_income_statement;
    select coalesce(sum(case when m.reverses_id is null then m.amount else -m.amount end), 0) into v_distributed
    from public.owner_movements m where m.kind = 'PROFIT_DISTRIBUTION';
    if v_distributed + v_amount > v_result_total then
      v_warning := format('A retirada supera o lucro apurado até hoje (%s disponíveis).',
                          private.fmt_money(greatest(v_result_total - v_distributed, 0)));
    end if;
  end if;

  v_cash_id := private.post_cash(p_account_id, v_on, case when v_direction = 'DONO_PARA_EMPRESA' then 'IN' else 'OUT' end,
                                 v_amount, v_code, v_label, 'owner_movement', null);
  v_owner_id := private.post_owner_movement(p_kind, v_on, v_amount, nullif(btrim(coalesce(p_notes, '')), ''), null, null, v_cash_id);
  if p_kind = 'PRO_LABORE' then
    perform private.post_result(v_on, '4.8', -v_amount, 'owner_movement', v_owner_id, v_label);
  end if;
  perform private.audit('CREATE', 'owner_movement', v_owner_id, null, v_label, jsonb_build_object('valor', v_amount));
  return private.idem_finish(p_request_id, jsonb_build_object('owner_movement_id', v_owner_id, 'cash_transaction_id', v_cash_id, 'warning', v_warning));
end;
$$;


select private.apply_grants();
