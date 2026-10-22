-- Estorno de impressão (RN-21, US-5.10): passa a seguir a especificação — bloqueado se
-- peças desta impressão já foram entregues ou reservadas, com a lista de pedidos a
-- ajustar. Antes, bastava haver saldo livre (uma impressão posterior repunha o estoque
-- e o estorno passava mesmo com peças desta já vendidas).

create or replace function public.reverse_print_job(p_request_id uuid, p_print_job_id bigint, p_reason text)
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
  v_m0 public.stock_movements;
  v_before numeric;
  v_outflows numeric;
  v_orders text;
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
  -- RN-21 / US-5.10: bloqueado se peças desta impressão já foram entregues ou reservadas.
  -- Peças iguais são intercambiáveis; a conta segue a ordem física (primeiro que entra,
  -- primeiro que sai): as peças desta impressão só saíram se as saídas posteriores à
  -- entrada delas consumiram mais do que o estoque que já existia antes.
  for v_out in
    select o.id, o.qty_released, v.item_id, i.name, b.qty_on_hand, b.qty_reserved
    from public.print_job_outputs o
    join public.product_variants v on v.id = o.variant_id
    join public.items i on i.id = v.item_id
    join public.stock_balances b on b.item_id = v.item_id
    where o.print_job_id = v_job.id and o.status = 'LIBERADA' and o.qty_released > 0
    for update of b
  loop
    select m.* into v_m0 from public.stock_movements m
    where m.source_type = 'print_job_output' and m.source_id = v_out.id and m.type = 'PRODUCTION_OUTPUT'
      and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id)
    order by m.id limit 1;
    v_orders := null;
    if v_m0.id is not null then
      v_before := v_m0.qty_after - v_m0.qty;
      select coalesce(-sum(m.qty), 0) into v_outflows
      from public.stock_movements m
      where m.item_id = v_out.item_id and m.id > v_m0.id and m.qty < 0 and m.type <> 'REVERSAL'
        and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id);
      if v_outflows > v_before then
        select string_agg(distinct so.number, ', ') into v_orders
        from public.stock_movements m
        join public.deliveries d on m.source_type = 'delivery' and d.id = m.source_id
        join public.sales_orders so on so.id = d.order_id
        where m.item_id = v_out.item_id and m.id > v_m0.id and m.qty < 0
          and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id);
        v_blocked := concat_ws('; ', v_blocked, v_out.name || ' — entregues' || coalesce(' em ' || v_orders, ' ou baixadas do estoque'));
        continue;
      end if;
    end if;
    if v_out.qty_on_hand - v_out.qty_reserved < v_out.qty_released
       or exists (select 1 from public.reservations r where r.print_job_output_id = v_out.id and r.status = 'ATIVA') then
      select string_agg(distinct so.number, ', ') into v_orders
      from public.reservations r
      join public.sales_order_lines l on l.id = r.order_line_id
      join public.sales_orders so on so.id = l.order_id
      where r.item_id = v_out.item_id and r.status = 'ATIVA';
      v_blocked := concat_ws('; ', v_blocked, v_out.name || ' — reservadas' || coalesce(' para ' || v_orders, ''));
    end if;
  end loop;
  if v_blocked is not null then
    raise exception 'Peças desta impressão já foram entregues ou reservadas (%). Ajuste esses pedidos antes de estornar.', v_blocked
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

select private.apply_grants();
