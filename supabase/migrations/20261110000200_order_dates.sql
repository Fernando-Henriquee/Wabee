-- =============================================================================
-- Corrigir datas de pedidos já confirmados: o prazo de entrega do pedido e o vencimento de cada
-- parcela a receber. Antes só dava para mudar essas datas com o pedido em rascunho.
-- =============================================================================

-- Prazo de entrega (em branco limpa a data). Vale enquanto o pedido não foi entregue nem cancelado.
create function public.set_order_due_date(p_order_id bigint, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
begin
  perform private.assert_owner();
  select * into v_order from public.sales_orders o where o.id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Pedido não encontrado.' using errcode = '22023';
  end if;
  if v_order.status in ('ENTREGUE', 'CANCELADO') then
    raise exception 'O pedido % já está % e não tem mais prazo de entrega.', v_order.number, lower(v_order.status) using errcode = '22023';
  end if;
  if p_date is not null and (p_date < date '2000-01-01' or p_date > date '2100-01-01') then
    raise exception 'Data de entrega inválida.' using errcode = '22023';
  end if;
  update public.sales_orders set due_date = p_date where id = p_order_id;
  perform private.audit('UPDATE', 'sales_order', v_order.id, v_order.number,
    'Prazo de entrega alterado de ' || coalesce(to_char(v_order.due_date, 'DD/MM/YYYY'), 'sem prazo') || ' para ' || coalesce(to_char(p_date, 'DD/MM/YYYY'), 'sem prazo'),
    jsonb_build_object('de', v_order.due_date, 'para', p_date));
end;
$$;

-- Vencimento de uma parcela a receber ainda em aberto (de pedido ou de qualquer outro título).
create function public.set_receivable_due_date(p_installment_id bigint, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.installments;
  v_rec public.receivables;
begin
  perform private.assert_owner();
  select * into v_inst from public.installments i where i.id = p_installment_id for update;
  if v_inst.id is null or v_inst.receivable_id is null then
    raise exception 'Parcela a receber não encontrada.' using errcode = '22023';
  end if;
  if v_inst.status <> 'ABERTA' then
    raise exception 'Só parcelas em aberto podem mudar de data (esta está %).', case v_inst.status when 'PAGA' then 'recebida' else 'cancelada' end using errcode = '22023';
  end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > date '2100-01-01' then
    raise exception 'Informe uma data de vencimento válida.' using errcode = '22023';
  end if;
  select * into v_rec from public.receivables r where r.id = v_inst.receivable_id;
  update public.installments set due_date = p_date where id = p_installment_id;
  perform private.audit('UPDATE', 'installment', v_inst.id, v_rec.number,
    'Vencimento da parcela ' || v_inst.number || '/' || v_inst.of_total || ' alterado de ' || to_char(v_inst.due_date, 'DD/MM/YYYY') || ' para ' || to_char(p_date, 'DD/MM/YYYY'),
    jsonb_build_object('de', v_inst.due_date, 'para', p_date));
end;
$$;

select private.apply_grants();
