-- Correções encontradas ao montar as telas de Vendas e Produção:
-- 1. Entrega sem embalagens informadas não aplicava a embalagem padrão por pedido
--    (settings.default_order_packaging_item_id): a conferência de "primeira entrega"
--    rodava depois de a entrega atual já estar gravada.
-- 2. Cancelar com o sinal virando crédito num pedido sem cliente perdia o valor.
-- 3. v_sales_orders passa a expor canceled_at e payment_terms (filtro de cancelados e rascunhos).
-- 4. Dividir a taxa combinada na mesma data em que ela começa deixava as taxas sobrepostas.

create or replace function private.default_packaging(p_order_id bigint, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_row record;
  v_settings public.settings := private.settings();
  v_out jsonb := '[]'::jsonb;
  v_key text;
begin
  for v_row in
    select bl.item_id, sum(bl.qty_per_unit * (1 + bl.waste_pct) * d.qty) as qty
    from jsonb_to_recordset(p_lines) as d(line_id bigint, qty numeric)
    join public.sales_order_lines l on l.id = d.line_id
    join public.bom_versions b on b.variant_id = l.variant_id and b.status = 'ATIVA'
    join public.bom_lines bl on bl.bom_version_id = b.id and bl.consumed_at = 'DELIVERY'
    group by bl.item_id
  loop
    v_result := jsonb_set(v_result, array[v_row.item_id::text], to_jsonb(v_row.qty));
  end loop;
  -- Embalagem por pedido: uma vez por pedido (a primeira entrega). A entrega atual já foi
  -- gravada quando esta função roda, então a conferência é pela embalagem já baixada.
  if v_settings.default_order_packaging_item_id is not null
     and not exists (select 1 from public.order_packaging op
                     where op.order_id = p_order_id and op.item_id = v_settings.default_order_packaging_item_id) then
    v_result := jsonb_set(v_result, array[v_settings.default_order_packaging_item_id::text],
      to_jsonb(coalesce((v_result ->> v_settings.default_order_packaging_item_id::text)::numeric, 0) + 1));
  end if;
  for v_key in select jsonb_object_keys(v_result) loop
    v_out := v_out || jsonb_build_object('item_id', v_key::bigint, 'qty', round((v_result ->> v_key)::numeric, 3));
  end loop;
  return v_out;
end;
$$;

create or replace function public.cancel_order(
  p_request_id uuid,
  p_order_id bigint,
  p_reason text,
  p_deposit_action text default 'REFUND',
  p_cancel_print_jobs boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_order public.sales_orders;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_line record;
  v_paid numeric := 0;
  v_refund_id bigint;
  v_job record;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'cancel_order');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;
  select * into v_order from public.sales_orders o where o.id = p_order_id for update;
  if v_order.id is null or v_order.status in ('CANCELADO', 'ENTREGUE') then
    raise exception 'Só pedidos não entregues podem ser cancelados.' using errcode = '22023';
  end if;
  if exists (select 1 from public.deliveries d where d.order_id = p_order_id) then
    raise exception 'Este pedido já tem entrega registrada: use a devolução.' using errcode = '22023';
  end if;
  for v_line in select l.id from public.sales_order_lines l where l.order_id = p_order_id loop
    perform private.release_line_reservations(v_line.id, null, 'CANCELADA');
  end loop;
  if v_order.receivable_id is not null then
    select coalesce(sum(i.paid_amount), 0) into v_paid from public.installments i where i.receivable_id = v_order.receivable_id and i.status = 'PAGA';
    perform private.cancel_open_installments(null, v_order.receivable_id, v_reason);
    if v_paid = 0 then
      update public.receivables set status = 'CANCELADO', canceled_at = now(), cancel_reason = v_reason where id = v_order.receivable_id;
    end if;
  end if;
  if v_paid > 0 then
    if p_deposit_action = 'CREDIT' then
      if v_order.customer_id is null then
        raise exception 'Pedido sem cliente: o sinal recebido só pode ser devolvido, não virar crédito.' using errcode = '22023';
      end if;
      update public.customers set credit_balance = credit_balance + v_paid where id = v_order.customer_id;
    else
      v_refund_id := private.create_title('PAGAR', null, 'order_refund', v_order.id, 'Devolução do sinal — pedido ' || v_order.number, '9.2',
        private.today(), v_paid, jsonb_build_array(jsonb_build_object('due_date', private.today(), 'amount', v_paid)));
    end if;
  end if;
  if p_cancel_print_jobs then
    for v_job in select j.id from public.print_jobs j where j.sales_order_id = p_order_id and j.status = 'PLANEJADA' loop
      update public.print_jobs set status = 'CANCELADA', notes = left(concat_ws(' · ', notes, 'Pedido cancelado'), 1000) where id = v_job.id;
    end loop;
  end if;
  update public.sales_orders set status = 'CANCELADO', canceled_at = now(), cancel_reason = v_reason where id = p_order_id;
  perform private.audit('CANCEL', 'sales_order', v_order.id, v_order.number, 'Pedido cancelado: ' || v_reason,
                        jsonb_build_object('sinal_recebido', v_paid, 'destino', case when v_paid > 0 then p_deposit_action end));
  return private.idem_finish(p_request_id, jsonb_build_object('order_id', p_order_id, 'refund_payable_id', v_refund_id, 'deposit', v_paid));
end;
$$;

create or replace view public.v_sales_orders with (security_invoker = true) as
select
  o.id, o.number, o.kind, o.status, o.customer_id, c.name as customer_name, c.phone as customer_phone, c.instagram as customer_instagram,
  o.channel_id, ch.name as channel_name, ch.kind as channel_kind, o.ordered_at, o.due_date, o.delivered_at,
  o.items_subtotal, o.order_discount, o.discount_total, o.shipping_charged, o.shipping_cost, o.total,
  o.channel_fee_total, o.payment_fee_total + coalesce(rcv.fees, 0) as payment_fee_total, o.tax_total, o.packaging_cost_total, o.gift_cost_total,
  o.cogs_material, o.cogs_energy, o.cogs_depreciation, o.cogs_operational, o.cogs_labor, o.cogs_total,
  o.is_historical, o.receivable_id, o.notes, o.cancel_reason, o.confirmed_at, o.created_at,
  coalesce(rcv.received, 0) as received_amount,
  coalesce(rcv.open_amount, 0) as open_amount,
  coalesce(rcv.overdue_amount, 0) as overdue_amount,
  rcv.next_due_date,
  (select count(*) from public.sales_order_lines l where l.order_id = o.id)::integer as line_count,
  (select coalesce(sum(l.qty), 0) from public.sales_order_lines l where l.order_id = o.id) as units,
  (select coalesce(sum(l.qty_reserved), 0) from public.sales_order_lines l where l.order_id = o.id) as units_reserved,
  (select coalesce(sum(l.qty_delivered), 0) from public.sales_order_lines l where l.order_id = o.id) as units_delivered,
  (select string_agg(coalesce(i.name, l.custom_description) || ' ×' || trim_scale(l.qty), ', ' order by l.sort_order)
     from public.sales_order_lines l left join public.items i on i.id = l.item_id where l.order_id = o.id) as lines_summary,
  -- Margem de contribuição (RN-13): receita líquida − CMV − taxas − embalagem − frete pago − impostos.
  case when o.status = 'ENTREGUE' then
    o.total - o.cogs_total - o.channel_fee_total - (o.payment_fee_total + coalesce(rcv.fees, 0)) - o.packaging_cost_total - o.shipping_cost - o.tax_total - o.gift_cost_total
  end as contribution_margin,
  o.canceled_at, o.payment_terms
from public.sales_orders o
left join public.customers c on c.id = o.customer_id
join public.sales_channels ch on ch.id = o.channel_id
left join lateral (
  select sum(i.paid_amount) filter (where i.status = 'PAGA') as received,
         sum(i.amount) filter (where i.status = 'ABERTA') as open_amount,
         sum(i.amount) filter (where i.status = 'ABERTA' and i.due_date < private.today()) as overdue_amount,
         min(i.due_date) filter (where i.status = 'ABERTA') as next_due_date,
         sum(i.fee_amount) filter (where i.status = 'PAGA') as fees
  from public.installments i where i.receivable_id = o.receivable_id
) rcv on true;

create or replace function public.split_operational_rate(
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
    and (r.valid_to is null or r.valid_to >= p_valid_from)
  order by r.valid_from desc limit 1
  for update;
  if v_combined.id is not null and v_combined.valid_from >= p_valid_from then
    -- Sem isso a taxa combinada continuaria valendo junto com as duas novas.
    raise exception 'A taxa combinada vale desde %: a divisão precisa começar depois dessa data.',
      to_char(v_combined.valid_from, 'DD/MM/YYYY') using errcode = '22023';
  end if;
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

select private.apply_grants();
