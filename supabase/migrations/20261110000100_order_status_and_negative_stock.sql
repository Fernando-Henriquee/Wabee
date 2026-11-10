-- =============================================================================
-- Correções no pedido e no estoque negativo.
--
-- 1) "Permitir estoque negativo" vale só para insumos de produção (filamento, componentes,
--    embalagens, consumíveis). Produto acabado (FINISHED_GOOD) nunca fica negativo: entregar
--    o que não existe em estoque é recusado, mesmo com a opção ligada.
-- 2) Pedido só com linha avulsa (sem produto) ia direto para PRONTO ao confirmar, porque não
--    havia nada a reservar. Agora a linha avulsa conta como pendente e o pedido fica CONFIRMADO.
--    Os pedidos em andamento são reavaliados no fim.
-- =============================================================================

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
    if -v_qty > v_available and not (v_settings.allow_negative_stock and v_item.kind <> 'FINISHED_GOOD') then
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
  -- Linha avulsa (sem produto) não reserva nem entra na produção: enquanto não for entregue, o pedido não está pronto.
  select bool_or(l.qty_delivered + case when l.item_id is null then 0 else l.qty_reserved end < l.qty) into v_pending
    from public.sales_order_lines l where l.order_id = p_order_id;
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

-- Reavalia os pedidos em andamento com a regra corrigida (só muda o status de quem estava errado).
select private.refresh_order_status(o.id) from public.sales_orders o where o.status in ('CONFIRMADO', 'EM_PRODUCAO', 'PRONTO');

select private.apply_grants();
