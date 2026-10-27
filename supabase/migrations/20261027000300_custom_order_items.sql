-- Item pontual criado dentro do pedido (US-4.9). Encomenda pontual não vira produto do
-- catálogo: ela vira uma variação oculta (is_hidden) de um produto marcado is_custom, com uma
-- ficha técnica simplificada já ativa. Assim produção, reserva, entrega e CMV seguem o fluxo
-- normal, e o catálogo de vendas e o seletor da produção continuam mostrando só os produtos
-- de revenda.
--
-- p_item: {name, channel_id?, qty?, units_per_plate?, est_print_minutes_per_plate,
--          est_post_process_minutes_per_unit?, default_equipment_id?, unit_price?,
--          save_to_catalog?, category?, variant_name?,
--          lines: [{item_id, qty_per_unit, line_kind?, waste_pct?}]}

-- Quadro de custo e preço sugerido sem gravar nada (a tela recalcula a cada alteração).
create function public.preview_custom_item(p_item jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_estimate jsonb;
  v_unit_cost numeric;
  v_packaging numeric;
  v_channel_id bigint := nullif(p_item ->> 'channel_id', '')::bigint;
  v_fee public.sales_channel_fees;
begin
  perform private.assert_role(array['dono', 'leitura']);
  v_estimate := private.estimate_cost(p_item -> 'lines',
    coalesce(nullif(p_item ->> 'units_per_plate', '')::integer, 1),
    coalesce(nullif(p_item ->> 'est_print_minutes_per_plate', '')::numeric, 0),
    coalesce(nullif(p_item ->> 'est_post_process_minutes_per_unit', '')::numeric, 0),
    nullif(p_item ->> 'default_equipment_id', '')::bigint, private.today());
  v_unit_cost := (v_estimate ->> 'total_production')::numeric;
  v_packaging := coalesce((v_estimate ->> 'packaging')::numeric, 0);
  if v_channel_id is not null then
    v_fee := private.channel_fee_at(v_channel_id, private.today());
  end if;
  return jsonb_build_object(
    'estimate', v_estimate,
    'unit_cost', round(v_unit_cost, 6),
    'margin_target_pct', (private.settings()).margin_target_pct,
    'suggested_price', private.suggested_price(v_unit_cost, v_packaging, v_fee, (private.settings()).margin_target_pct));
end;
$$;

-- Cria o item pontual numa transação: produto (is_custom) + variação oculta + ficha ativa.
-- Com save_to_catalog = true, cria um produto normal, visível no catálogo.
create function public.create_custom_item(p_request_id uuid, p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_catalog boolean := coalesce((p_item ->> 'save_to_catalog')::boolean, false);
  v_name text := btrim(coalesce(p_item ->> 'name', ''));
  v_minutes numeric := nullif(p_item ->> 'est_print_minutes_per_plate', '')::numeric;
  v_product_id bigint;
  v_variant public.product_variants;
  v_bom_id bigint;
  v_estimate jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'create_custom_item');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(v_name) = 0 then
    raise exception 'Informe o nome do item.' using errcode = '22023';
  end if;
  if v_minutes is null or v_minutes <= 0 then
    raise exception 'Informe o tempo de impressão.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(p_item -> 'lines', '[]'::jsonb)) l
    join public.items i on i.id = (l ->> 'item_id')::bigint
    where i.kind = 'FILAMENT' and coalesce((l ->> 'qty_per_unit')::numeric, 0) > 0
  ) then
    raise exception 'Informe ao menos um filamento com os gramas por peça.' using errcode = '22023';
  end if;

  v_product_id := public.save_product(jsonb_build_object(
    'name', v_name,
    'category', case when v_catalog then coalesce(nullif(p_item ->> 'category', ''), 'OUTRO') else 'PERSONALIZADO' end,
    'is_custom', not v_catalog,
    'variants', jsonb_build_array(jsonb_build_object(
      'name', coalesce(nullif(btrim(coalesce(p_item ->> 'variant_name', '')), ''), case when v_catalog then 'padrão' else 'pontual' end),
      'reference_price', nullif(p_item ->> 'unit_price', ''),
      'is_hidden', not v_catalog))));
  select * into v_variant from public.product_variants v where v.product_id = v_product_id;

  v_bom_id := public.save_bom_draft(jsonb_build_object(
    'variant_id', v_variant.id,
    'units_per_plate', coalesce(nullif(p_item ->> 'units_per_plate', '')::integer, 1),
    'est_print_minutes_per_plate', round(v_minutes)::integer,
    'est_post_process_minutes_per_unit', coalesce(nullif(p_item ->> 'est_post_process_minutes_per_unit', '')::integer, 0),
    'default_equipment_id', nullif(p_item ->> 'default_equipment_id', ''),
    'lines', coalesce(p_item -> 'lines', '[]'::jsonb)));
  perform public.activate_bom(v_bom_id);
  v_estimate := public.estimate_bom_cost(v_bom_id);

  return private.idem_finish(p_request_id, jsonb_build_object(
    'product_id', v_product_id, 'variant_id', v_variant.id, 'item_id', v_variant.item_id, 'sku', v_variant.sku,
    'bom_version_id', v_bom_id, 'unit_cost', (v_estimate ->> 'total_production')::numeric, 'estimate', v_estimate));
end;
$$;

select private.apply_grants();
