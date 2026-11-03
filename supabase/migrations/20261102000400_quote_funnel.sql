-- =============================================================================
-- Orçamentos na Visão geral: funil do período (anotados, propostas, ganhos, perdas por
-- motivo) e o resumo do momento (quanto há para retomar hoje e quanto está em proposta).
-- Somente leitura, para dono e leitura.
-- =============================================================================

create function public.quote_funnel(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_created integer;
  v_proposals integer;
  v_won integer;
  v_won_value numeric;
  v_lost integer;
  v_days numeric;
  v_reasons jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select count(*) into v_created from public.quote_requests q where private.local_date(q.created_at) between p_from and p_to;
  select count(*) into v_proposals from public.quote_requests q
   where q.quoted_at is not null and private.local_date(q.quoted_at) between p_from and p_to;
  select count(*), coalesce(sum(coalesce(o.total, q.quoted_unit_price * q.qty, 0)), 0),
         avg(extract(epoch from (q.closed_at - q.created_at)) / 86400)
    into v_won, v_won_value, v_days
    from public.quote_requests q left join public.sales_orders o on o.id = q.order_id
   where q.status = 'GANHO' and private.local_date(q.closed_at) between p_from and p_to;
  select count(*) into v_lost from public.quote_requests q
   where q.status = 'PERDIDO' and private.local_date(q.closed_at) between p_from and p_to;
  select coalesce(jsonb_agg(jsonb_build_object('reason', r.lost_reason, 'count', r.c, 'value', r.v) order by r.c desc, r.lost_reason), '[]'::jsonb)
    into v_reasons
    from (select q.lost_reason, count(*) c, coalesce(sum(q.quoted_unit_price * q.qty), 0) v
            from public.quote_requests q
           where q.status = 'PERDIDO' and private.local_date(q.closed_at) between p_from and p_to
           group by q.lost_reason) r;
  return jsonb_build_object(
    'created', v_created, 'proposals', v_proposals, 'won', v_won, 'won_value', round(v_won_value, 2), 'lost', v_lost,
    'conversion', case when v_won + v_lost > 0 then round(v_won::numeric / (v_won + v_lost), 4) end,
    'avg_days_to_win', case when v_won > 0 then round(v_days, 1) end,
    'lost_by_reason', v_reasons);
end;
$$;

-- O que pede ação agora: retornos vencidos e propostas esperando resposta.
create function public.quote_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
begin
  perform private.assert_role(array['dono', 'leitura']);
  return (
    select jsonb_build_object(
      'open', count(*),
      'to_analyze', count(*) filter (where q.status = 'NOVO'),
      'due', count(*) filter (where q.follow_up_at is not null and q.follow_up_at <= v_today),
      'overdue', count(*) filter (where q.follow_up_at is not null and q.follow_up_at < v_today),
      'open_value', coalesce(sum(q.quoted_unit_price * q.qty) filter (where q.status = 'PROPOSTA_ENVIADA'), 0))
    from public.quote_requests q
    where q.status in ('NOVO', 'EM_ANALISE', 'PROPOSTA_ENVIADA'));
end;
$$;

select private.apply_grants();
