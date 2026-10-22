-- Estorno de baixa em parcela de documento cancelado (compra ou pedido): bloqueado.
-- Ao cancelar, o valor já pago virou um título de reembolso; reabrir a parcela original
-- contaria o mesmo dinheiro duas vezes.

create or replace function public.reverse_installment_payment(p_request_id uuid, p_installment_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
begin
  perform private.assert_owner();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  v_done := private.idem_begin(p_request_id, 'reverse_installment_payment');
  if v_done is not null then
    return v_done;
  end if;
  -- Documento de origem cancelado: o valor pago já virou reembolso (a receber ou a pagar).
  -- Reabrir a parcela duplicaria o efeito, então a baixa não pode mais ser estornada.
  if exists (
    select 1 from public.installments i
    left join public.payables p on p.id = i.payable_id
    left join public.receivables r on r.id = i.receivable_id
    left join public.purchases pu on p.source_type = 'purchase' and pu.id = p.source_id
    left join public.sales_orders so on r.source_type = 'sales_order' and so.id = r.source_id
    where i.id = p_installment_id
      and (p.canceled_at is not null or r.canceled_at is not null or pu.status = 'CANCELADA' or so.status = 'CANCELADO')
  ) then
    raise exception 'O documento desta parcela foi cancelado e o valor pago virou reembolso. Acerte pelo reembolso, não estornando esta baixa.'
      using errcode = '22023';
  end if;
  perform private.unsettle_installment(p_installment_id, btrim(p_reason));
  perform private.audit('REVERSE', 'installment', p_installment_id, null, 'Baixa estornada: ' || btrim(p_reason), '{}'::jsonb);
  return private.idem_finish(p_request_id, jsonb_build_object('installment_id', p_installment_id));
end;
$$;

select private.apply_grants();
