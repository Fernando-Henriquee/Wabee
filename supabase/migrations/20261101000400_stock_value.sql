-- =============================================================================
-- Valor total do estoque (Visão geral): tudo o que está em estoque pelo custo
-- médio — filamentos, componentes, embalagens e peças prontas (livres e reservadas).
-- =============================================================================

create function public.stock_value()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_by_kind jsonb;
  v_total numeric;
  v_finished jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'items', k.items, 'qty', k.qty, 'value', k.value) order by k.value desc), '[]'::jsonb),
         coalesce(sum(k.value), 0)
    into v_by_kind, v_total
  from (
    select i.kind, count(*) as items, sum(b.qty_on_hand) as qty, round(sum(b.qty_on_hand * b.avg_cost_total), 2) as value
    from public.stock_balances b join public.items i on i.id = b.item_id
    where b.qty_on_hand > 0
    group by i.kind
  ) k;
  select jsonb_build_object('units', coalesce(sum(b.qty_on_hand), 0), 'reserved', coalesce(sum(b.qty_reserved), 0),
                            'free', coalesce(sum(greatest(b.qty_on_hand - b.qty_reserved, 0)), 0))
    into v_finished
  from public.product_variants v join public.stock_balances b on b.item_id = v.item_id
  where b.qty_on_hand > 0;
  return jsonb_build_object('total', v_total, 'by_kind', v_by_kind, 'finished', v_finished);
end;
$$;

select private.apply_grants();
