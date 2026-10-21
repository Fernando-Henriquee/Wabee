-- =============================================================================
-- Wabee — 0700 Vendas, pedidos, reservas, entregas e recebimentos (Módulo 6)
--
-- Três momentos independentes (seção 12):
--   * confirmar → compromisso: reserva o saldo livre, cria a conta a receber;
--   * entregar  → estoque sai (SALE_ISSUE, PACKAGING_ISSUE); receita, CMV e taxas
--                 entram no DRE na data da entrega (RN-11 a RN-13, RN-26);
--   * receber   → dinheiro entra no caixa pela baixa da parcela (finance_base).
-- A venda rápida junta os três numa transação.
-- =============================================================================

create table public.customers (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 30),
  email text check (email is null or char_length(email) <= 120),
  instagram text check (instagram is null or char_length(instagram) <= 60),
  document text check (document is null or char_length(document) <= 20),
  address_street text,
  address_number text,
  address_complement text,
  address_district text,
  address_city text,
  address_state text check (address_state is null or char_length(address_state) <= 2),
  address_zip text check (address_zip is null or char_length(address_zip) <= 10),
  notes text check (notes is null or char_length(notes) <= 1000),
  marketing_consent boolean not null default false,
  credit_balance numeric(14,2) not null default 0 check (credit_balance >= 0),
  active boolean not null default true,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index customers_name_idx on public.customers (lower(name));
create trigger customers_touch before update on public.customers for each row execute function private.touch_updated_at();
create trigger customers_audit after insert or update on public.customers for each row execute function private.audit_row('customer');

alter table public.receivables add constraint receivables_customer_fk foreign key (customer_id) references public.customers (id);
alter table public.payables add constraint payables_supplier_fk foreign key (supplier_id) references public.suppliers (id);

create table public.sales_orders (
  id bigint generated always as identity primary key,
  number text not null unique,
  customer_id bigint references public.customers (id),
  channel_id bigint not null references public.sales_channels (id),
  kind text not null default 'PRONTA_ENTREGA' check (kind in ('PRONTA_ENTREGA', 'ENCOMENDA')),
  status text not null default 'RASCUNHO' check (status in ('RASCUNHO', 'CONFIRMADO', 'EM_PRODUCAO', 'PRONTO', 'ENTREGUE', 'CANCELADO')),
  ordered_at timestamptz not null default now(),
  due_date date,
  delivered_at timestamptz,
  items_subtotal numeric(14,2) not null default 0,
  order_discount numeric(14,2) not null default 0 check (order_discount >= 0),
  discount_total numeric(14,2) not null default 0,
  shipping_charged numeric(14,2) not null default 0 check (shipping_charged >= 0),
  shipping_cost numeric(14,2) not null default 0 check (shipping_cost >= 0),
  channel_fee_total numeric(14,2) not null default 0,
  payment_fee_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  packaging_cost_total numeric(14,2) not null default 0,
  gift_cost_total numeric(14,2) not null default 0,
  cogs_material numeric(14,2) not null default 0,
  cogs_energy numeric(14,2) not null default 0,
  cogs_depreciation numeric(14,2) not null default 0,
  cogs_operational numeric(14,2) not null default 0,
  cogs_labor numeric(14,2) not null default 0,
  cogs_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  payment_terms jsonb,
  receivable_id bigint references public.receivables (id),
  is_historical boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 2000),
  confirmed_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (total = items_subtotal - discount_total + shipping_charged),
  check (cogs_total = cogs_material + cogs_energy + cogs_depreciation + cogs_operational + cogs_labor)
);

create index sales_orders_status_idx on public.sales_orders (status, ordered_at desc);
create index sales_orders_customer_idx on public.sales_orders (customer_id);
create trigger sales_orders_touch before update on public.sales_orders for each row execute function private.touch_updated_at();

alter table public.print_jobs add constraint print_jobs_sales_order_fk foreign key (sales_order_id) references public.sales_orders (id);

create table public.sales_order_lines (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.sales_orders (id) on delete cascade,
  item_id bigint references public.items (id),
  variant_id bigint references public.product_variants (id),
  custom_description text,
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  is_gift boolean not null default false,
  qty_reserved numeric(14,3) not null default 0 check (qty_reserved >= 0),
  qty_delivered numeric(14,3) not null default 0 check (qty_delivered >= 0),
  historical_unit_cost numeric(16,6),
  unit_cogs_material numeric(16,6),
  unit_cogs_energy numeric(16,6),
  unit_cogs_depreciation numeric(16,6),
  unit_cogs_operational numeric(16,6),
  unit_cogs_labor numeric(16,6),
  cogs_total numeric(14,2) not null default 0,
  sort_order integer not null default 0,
  check (item_id is not null or custom_description is not null),
  check (not is_gift or (unit_price = 0 and discount = 0)),
  check (discount <= round(qty * unit_price, 2)),
  check (qty_reserved + qty_delivered <= qty)
);

create index sales_order_lines_order_idx on public.sales_order_lines (order_id);
create index sales_order_lines_item_idx on public.sales_order_lines (item_id);

create table public.deliveries (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.sales_orders (id),
  delivered_at timestamptz not null,
  method text not null default 'RETIRADA' check (method in ('RETIRADA', 'ENTREGA_PROPRIA', 'CORREIOS', 'MARKETPLACE')),
  tracking_code text,
  shipping_cost numeric(14,2) not null default 0,
  revenue numeric(14,2) not null default 0,
  cogs_total numeric(14,2) not null default 0,
  channel_fee numeric(14,2) not null default 0,
  packaging_cost numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.delivery_lines (
  id bigint generated always as identity primary key,
  delivery_id bigint not null references public.deliveries (id),
  order_line_id bigint not null references public.sales_order_lines (id),
  qty numeric(14,3) not null check (qty > 0),
  unit_cost_material numeric(16,6) not null default 0,
  unit_cost_energy numeric(16,6) not null default 0,
  unit_cost_depreciation numeric(16,6) not null default 0,
  unit_cost_operational numeric(16,6) not null default 0,
  unit_cost_labor numeric(16,6) not null default 0,
  cogs_total numeric(14,2) not null default 0,
  movement_ids bigint[] not null default '{}'
);

create table public.order_packaging (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.sales_orders (id),
  delivery_id bigint references public.deliveries (id),
  item_id bigint not null references public.items (id),
  qty numeric(14,3) not null check (qty > 0),
  unit_cost_snapshot numeric(16,6) not null default 0,
  total_cost numeric(14,2) not null default 0,
  movement_ids bigint[] not null default '{}'
);

create table public.reservations (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.items (id),
  order_line_id bigint not null references public.sales_order_lines (id),
  qty numeric(14,3) not null check (qty > 0),
  status text not null default 'ATIVA' check (status in ('ATIVA', 'CONSUMIDA', 'CANCELADA')),
  source text not null default 'MANUAL' check (source in ('CONFIRMACAO', 'MANUAL', 'PRODUCAO')),
  print_job_output_id bigint references public.print_job_outputs (id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  created_by uuid default auth.uid()
);

create index reservations_line_idx on public.reservations (order_line_id, status);
create index reservations_item_idx on public.reservations (item_id, status);

-- -----------------------------------------------------------------------------
-- Cálculos e serviços internos
-- -----------------------------------------------------------------------------

-- Totais do pedido: total = subtotal − descontos + frete cobrado.
create function private.refresh_order_totals(p_order_id bigint)
returns public.sales_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
begin
  update public.sales_orders o
     set items_subtotal = x.subtotal,
         discount_total = x.discounts + o.order_discount,
         total = x.subtotal - x.discounts - o.order_discount + o.shipping_charged
    from (select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) as subtotal, coalesce(sum(l.discount), 0) as discounts
          from public.sales_order_lines l where l.order_id = p_order_id) x
   where o.id = p_order_id
   returning o.* into v_order;
  if v_order.total < 0 then
    raise exception 'Os descontos superam o valor do pedido.' using errcode = '22023';
  end if;
  return v_order;
end;
$$;

-- Taxa do canal (RN-12): % sobre (subtotal − desconto) + fixo por pedido ou por unidade.
create function private.channel_fee_for(p_channel_id bigint, p_on date, p_net numeric, p_units numeric, p_include_fixed boolean)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fee public.sales_channel_fees := private.channel_fee_at(p_channel_id, p_on);
begin
  return round(coalesce(v_fee.fee_pct, 0) * greatest(p_net, 0)
               + case when not p_include_fixed then 0
                      when v_fee.fee_fixed_per = 'UNIDADE' then coalesce(v_fee.fee_fixed, 0) * p_units
                      else coalesce(v_fee.fee_fixed, 0) end, 2);
end;
$$;

-- Status do pedido a partir das linhas (RN-18): PRONTO quando tudo está reservado ou entregue.
create function private.refresh_order_status(p_order_id bigint)
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
  select bool_or(l.qty_reserved + l.qty_delivered < l.qty) into v_pending from public.sales_order_lines l where l.order_id = p_order_id and l.item_id is not null;
  v_production := exists (select 1 from public.print_jobs j where j.sales_order_id = p_order_id and j.status in ('PLANEJADA', 'IMPRIMINDO'))
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

-- Reserva até p_qty do saldo livre para a linha (reserva parcial permitida — RN-18).
create function private.reserve_line(p_line_id bigint, p_qty numeric, p_source text, p_output_id bigint default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.sales_order_lines;
  v_bal public.stock_balances;
  v_qty numeric;
  v_needed numeric;
begin
  select * into v_line from public.sales_order_lines l where l.id = p_line_id for update;
  if v_line.item_id is null then
    return 0;
  end if;
  v_needed := v_line.qty - v_line.qty_reserved - v_line.qty_delivered;
  select * into v_bal from public.stock_balances b where b.item_id = v_line.item_id for update;
  v_qty := least(coalesce(p_qty, v_needed), v_needed, greatest(coalesce(v_bal.qty_on_hand - v_bal.qty_reserved, 0), 0));
  if v_qty <= 0 then
    return 0;
  end if;
  update public.stock_balances set qty_reserved = qty_reserved + v_qty where item_id = v_line.item_id;
  update public.sales_order_lines set qty_reserved = qty_reserved + v_qty where id = v_line.id;
  insert into public.reservations (item_id, order_line_id, qty, source, print_job_output_id)
  values (v_line.item_id, v_line.id, v_qty, p_source, p_output_id);
  return v_qty;
end;
$$;

-- Libera reservas ativas de uma linha (todas, ou até p_qty) e devolve ao saldo livre.
create function private.release_line_reservations(p_line_id bigint, p_qty numeric, p_new_status text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
  v_left numeric := p_qty;
  v_take numeric;
  v_total numeric := 0;
begin
  for v_res in
    select r.* from public.reservations r where r.order_line_id = p_line_id and r.status = 'ATIVA' order by r.id desc for update
  loop
    exit when v_left is not null and v_left <= 0;
    v_take := case when v_left is null then v_res.qty else least(v_left, v_res.qty) end;
    if v_take = v_res.qty then
      update public.reservations set status = p_new_status, released_at = now() where id = v_res.id;
    else
      update public.reservations set qty = qty - v_take where id = v_res.id;
      insert into public.reservations (item_id, order_line_id, qty, status, source, released_at)
      values (v_res.item_id, v_res.order_line_id, v_take, p_new_status, v_res.source, now());
    end if;
    v_total := v_total + v_take;
    if v_left is not null then
      v_left := v_left - v_take;
    end if;
  end loop;
  if v_total > 0 then
    update public.sales_order_lines set qty_reserved = qty_reserved - v_total where id = p_line_id;
    if p_new_status = 'CANCELADA' then
      update public.stock_balances b set qty_reserved = b.qty_reserved - v_total
        from public.sales_order_lines l where l.id = p_line_id and b.item_id = l.item_id;
    end if;
  end if;
  return v_total;
end;
$$;

-- Grava (ou substitui) as linhas de um pedido em rascunho.
-- p_lines: [{item_id | variant_id, custom_description, qty, unit_price, discount, is_gift, unit_cost (histórico)}]
create function private.write_order_lines(p_order_id bigint, p_lines jsonb, p_channel_id bigint, p_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_variant public.product_variants;
  v_item public.items;
  v_order integer := 0;
  v_price numeric;
  v_gift boolean;
begin
  delete from public.sales_order_lines where order_id = p_order_id;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Adicione ao menos um item ao pedido.' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_order := v_order + 1;
    v_variant := null;
    v_item := null;
    if nullif(v_line ->> 'variant_id', '') is not null then
      select * into v_variant from public.product_variants v where v.id = (v_line ->> 'variant_id')::bigint;
      if v_variant.id is null then
        raise exception 'Variação não encontrada (linha %).', v_order using errcode = '22023';
      end if;
      select * into v_item from public.items i where i.id = v_variant.item_id;
    elsif nullif(v_line ->> 'item_id', '') is not null then
      select * into v_item from public.items i where i.id = (v_line ->> 'item_id')::bigint;
      if v_item.id is null or not v_item.is_sellable then
        raise exception 'Item não vendável na linha %.', v_order using errcode = '22023';
      end if;
      select * into v_variant from public.product_variants v where v.item_id = v_item.id;
    elsif nullif(btrim(coalesce(v_line ->> 'custom_description', '')), '') is null then
      raise exception 'Escolha o produto da linha %.', v_order using errcode = '22023';
    end if;
    v_gift := coalesce((v_line ->> 'is_gift')::boolean, false);
    v_price := case when v_gift then 0 else coalesce(nullif(v_line ->> 'unit_price', '')::numeric,
      case when v_variant.id is not null then private.reference_price(v_variant.id, p_channel_id, p_on) end) end;
    if v_price is null then
      raise exception 'Informe o preço de "%".', coalesce(v_item.name, v_line ->> 'custom_description') using errcode = '22023';
    end if;
    insert into public.sales_order_lines (order_id, item_id, variant_id, custom_description, qty, unit_price, discount, is_gift,
                                          historical_unit_cost, sort_order)
    values (p_order_id, v_item.id, v_variant.id, nullif(btrim(coalesce(v_line ->> 'custom_description', '')), ''),
            round((v_line ->> 'qty')::numeric, 3), round(v_price, 2),
            case when v_gift then 0 else round(coalesce(nullif(v_line ->> 'discount', '')::numeric, 0), 2) end,
            v_gift, nullif(v_line ->> 'unit_cost', '')::numeric, v_order);
  end loop;
end;
$$;

-- Cliente existente ou cadastro rápido com nome e telefone/Instagram (US-6.1).
create function private.resolve_customer(p_order jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := p_order -> 'new_customer';
  v_id bigint := nullif(p_order ->> 'customer_id', '')::bigint;
begin
  if v_id is not null then
    if not exists (select 1 from public.customers c where c.id = v_id) then
      raise exception 'Cliente não encontrado.' using errcode = '22023';
    end if;
    return v_id;
  end if;
  if jsonb_typeof(v_new) = 'object' and nullif(btrim(coalesce(v_new ->> 'name', '')), '') is not null then
    insert into public.customers (name, phone, instagram, email, marketing_consent)
    values (btrim(v_new ->> 'name'), nullif(btrim(coalesce(v_new ->> 'phone', '')), ''), nullif(btrim(coalesce(v_new ->> 'instagram', '')), ''),
            nullif(btrim(coalesce(v_new ->> 'email', '')), ''), coalesce((v_new ->> 'marketing_consent')::boolean, false))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Parcelas a receber a partir da condição de pagamento (US-6.4): [{label, pct | amount, due_date}].
-- Marketplace: vencimento = data prevista de repasse e o valor já desconta a taxa do canal (US-6.7).
create function private.order_installments(p_order public.sales_orders, p_channel public.sales_channels, p_fee numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected numeric := p_order.total - case when p_channel.kind = 'MARKETPLACE' then p_fee else 0 end;
  v_terms jsonb := p_order.payment_terms;
  v_result jsonb := '[]'::jsonb;
  v_term jsonb;
  v_amount numeric;
  v_sum numeric := 0;
  v_n integer;
  v_i integer := 0;
  v_default_due date := coalesce(p_order.due_date, private.local_date(p_order.ordered_at)) + case when p_channel.kind = 'MARKETPLACE' then p_channel.payout_days else 0 end;
begin
  if jsonb_typeof(v_terms) is distinct from 'array' or jsonb_array_length(v_terms) = 0 then
    return jsonb_build_array(jsonb_build_object('due_date', v_default_due, 'amount', round(v_expected, 2)));
  end if;
  v_n := jsonb_array_length(v_terms);
  for v_term in select * from jsonb_array_elements(v_terms) loop
    v_i := v_i + 1;
    if v_i = v_n then
      v_amount := round(v_expected, 2) - v_sum;
    elsif nullif(v_term ->> 'pct', '') is not null then
      v_amount := round(v_expected * (v_term ->> 'pct')::numeric, 2);
    else
      v_amount := round((v_term ->> 'amount')::numeric, 2);
    end if;
    if v_amount < 0 then
      raise exception 'A condição de pagamento passa do total do pedido.' using errcode = '22023';
    end if;
    v_sum := v_sum + v_amount;
    v_result := v_result || jsonb_build_object('due_date', coalesce(nullif(v_term ->> 'due_date', '')::date, v_default_due), 'amount', v_amount);
  end loop;
  return v_result;
end;
$$;

-- Confirma (seção 12.1): taxas estimadas, conta a receber e reserva do saldo livre.
create function private.confirm_order_core(p_order_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
  v_channel public.sales_channels;
  v_on date;
  v_fee numeric;
  v_units numeric;
  v_receivable_id bigint;
  v_line record;
  v_reserved numeric := 0;
  v_customer text;
  v_status text;
begin
  select * into v_order from public.sales_orders o where o.id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Pedido não encontrado.' using errcode = '22023';
  end if;
  if v_order.status <> 'RASCUNHO' then
    raise exception 'O pedido % já foi confirmado.', v_order.number using errcode = '22023';
  end if;
  v_order := private.refresh_order_totals(p_order_id);
  select * into v_channel from public.sales_channels c where c.id = v_order.channel_id;
  v_on := private.local_date(v_order.ordered_at);
  select coalesce(sum(l.qty), 0) into v_units from public.sales_order_lines l where l.order_id = p_order_id and not l.is_gift;
  v_fee := private.channel_fee_for(v_order.channel_id, v_on, v_order.items_subtotal - v_order.discount_total, v_units, true);
  select c.name into v_customer from public.customers c where c.id = v_order.customer_id;
  if v_order.total > 0 then
    v_receivable_id := private.create_title('RECEBER', v_order.customer_id, 'sales_order', v_order.id,
      'Pedido ' || v_order.number || coalesce(' — ' || v_customer, ''), '1.1', v_on,
      v_order.total - case when v_channel.kind = 'MARKETPLACE' then v_fee else 0 end,
      private.order_installments(v_order, v_channel, v_fee));
  end if;
  update public.sales_orders
     set status = 'CONFIRMADO', confirmed_at = now(), receivable_id = v_receivable_id,
         channel_fee_total = v_fee,
         tax_total = round((v_order.items_subtotal - v_order.discount_total) * private.sales_tax_pct(), 2)
   where id = p_order_id;
  -- Reserva automaticamente o que houver de saldo livre (US-6.5).
  for v_line in select l.id from public.sales_order_lines l where l.order_id = p_order_id and l.item_id is not null order by l.sort_order loop
    v_reserved := v_reserved + private.reserve_line(v_line.id, null, 'CONFIRMACAO');
  end loop;
  v_status := private.refresh_order_status(p_order_id);
  perform private.audit('UPDATE', 'sales_order', v_order.id, v_order.number, 'Pedido confirmado',
                        jsonb_build_object('total', v_order.total, 'reservado', v_reserved));
  return jsonb_build_object('order_id', v_order.id, 'number', v_order.number, 'status', v_status, 'receivable_id', v_receivable_id,
    'missing', (select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'item_id', l.item_id, 'missing', l.qty - l.qty_reserved - l.qty_delivered)), '[]'::jsonb)
                from public.sales_order_lines l where l.order_id = p_order_id and l.item_id is not null and l.qty_reserved + l.qty_delivered < l.qty));
end;
$$;

-- Embalagens padrão da entrega: linhas DELIVERY das fichas × quantidade + a embalagem padrão por pedido.
create function private.default_packaging(p_order_id bigint, p_lines jsonb)
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
  if v_settings.default_order_packaging_item_id is not null
     and not exists (select 1 from public.deliveries d where d.order_id = p_order_id) then
    v_result := jsonb_set(v_result, array[v_settings.default_order_packaging_item_id::text],
      to_jsonb(coalesce((v_result ->> v_settings.default_order_packaging_item_id::text)::numeric, 0) + 1));
  end if;
  for v_key in select jsonb_object_keys(v_result) loop
    v_out := v_out || jsonb_build_object('item_id', v_key::bigint, 'qty', round((v_result ->> v_key)::numeric, 3));
  end loop;
  return v_out;
end;
$$;

-- Entrega (US-6.6): estoque sai, receita/CMV/taxas no DRE na data da entrega (RN-11 a RN-13).
-- p_delivery: {delivered_at, method, tracking_code, shipping_cost, packaging: [{item_id, qty}], lines: [{line_id, qty}]}
create function private.deliver_order_core(p_order_id bigint, p_delivery jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
  v_channel public.sales_channels;
  v_at timestamptz := coalesce(nullif(p_delivery ->> 'delivered_at', '')::timestamptz, now());
  v_on date;
  v_first boolean;
  v_delivery_id bigint;
  v_lines jsonb := p_delivery -> 'lines';
  v_req record;
  v_line public.sales_order_lines;
  v_qty numeric;
  v_from_reserve numeric;
  v_issue private.issue_result;
  v_mv public.stock_movements;
  v_layers private.cost_layers;
  v_unit private.cost_layers;
  v_cogs private.cost_layers := row(0, 0, 0, 0, 0)::private.cost_layers;
  v_gift_cost numeric := 0;
  v_gross numeric := 0;
  v_line_discount numeric := 0;
  v_units numeric := 0;
  v_fee numeric;
  v_tax numeric;
  v_pack jsonb;
  v_pack_issue private.issue_result;
  v_pack_total numeric := 0;
  v_shipping_cost numeric := round(coalesce(nullif(p_delivery ->> 'shipping_cost', '')::numeric, 0), 2);
  v_label text;
  v_status text;
  v_net numeric;
begin
  select * into v_order from public.sales_orders o where o.id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Pedido não encontrado.' using errcode = '22023';
  end if;
  if v_order.status in ('RASCUNHO', 'CANCELADO', 'ENTREGUE') then
    raise exception 'O pedido % não pode ser entregue (situação: %).', v_order.number, lower(v_order.status) using errcode = '22023';
  end if;
  if v_order.is_historical then
    raise exception 'Venda histórica não tem entrega.' using errcode = '22023';
  end if;
  select * into v_channel from public.sales_channels c where c.id = v_order.channel_id;
  v_on := private.local_date(v_at);
  perform private.assert_open_period(v_on);
  v_first := not exists (select 1 from public.deliveries d where d.order_id = p_order_id);
  v_label := 'Pedido ' || v_order.number;
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'qty', l.qty - l.qty_delivered)), '[]'::jsonb) into v_lines
    from public.sales_order_lines l where l.order_id = p_order_id and l.qty > l.qty_delivered;
  end if;

  insert into public.deliveries (order_id, delivered_at, method, tracking_code, shipping_cost, notes)
  values (p_order_id, v_at, coalesce(nullif(p_delivery ->> 'method', ''), 'RETIRADA'), nullif(btrim(coalesce(p_delivery ->> 'tracking_code', '')), ''),
          v_shipping_cost, nullif(btrim(coalesce(p_delivery ->> 'notes', '')), ''))
  returning id into v_delivery_id;

  for v_req in select * from jsonb_to_recordset(v_lines) as x(line_id bigint, qty numeric) loop
    select * into v_line from public.sales_order_lines l where l.id = v_req.line_id and l.order_id = p_order_id for update;
    if v_line.id is null then
      raise exception 'Linha de pedido inválida.' using errcode = '22023';
    end if;
    v_qty := round(coalesce(v_req.qty, v_line.qty - v_line.qty_delivered), 3);
    if v_qty <= 0 then
      continue;
    end if;
    if v_qty > v_line.qty - v_line.qty_delivered then
      raise exception 'Quantidade a entregar maior que a pendente.' using errcode = '22023';
    end if;
    if v_line.item_id is null then
      raise exception 'Linha personalizada sem produto vinculado não pode ser entregue.' using errcode = '22023';
    end if;
    -- Consome as reservas desta linha primeiro.
    v_from_reserve := private.release_line_reservations(v_line.id, least(v_qty, v_line.qty_reserved), 'CONSUMIDA');
    v_issue := private.issue_stock(v_line.item_id, v_qty, case when v_line.is_gift then 'GIFT' else 'SALE_ISSUE' end, v_at,
      'delivery', v_delivery_id, case when v_line.is_gift then 'Brinde no ' || v_label end, null, v_from_reserve);
    select * into v_mv from public.stock_movements m where m.id = v_issue.movement_ids[1];
    v_unit := row(v_mv.unit_cost_material, v_mv.unit_cost_energy, v_mv.unit_cost_depreciation, v_mv.unit_cost_operational, v_mv.unit_cost_labor)::private.cost_layers;
    v_layers := private.money_layers(v_qty, v_unit, v_issue.total_cost);
    insert into public.delivery_lines (delivery_id, order_line_id, qty, unit_cost_material, unit_cost_energy, unit_cost_depreciation,
                                       unit_cost_operational, unit_cost_labor, cogs_total, movement_ids)
    values (v_delivery_id, v_line.id, v_qty, v_unit.material, v_unit.energy, v_unit.depreciation, v_unit.operational, v_unit.labor,
            v_issue.total_cost, v_issue.movement_ids);
    if v_line.is_gift then
      -- Brinde: custo vai para Marketing, não para o CMV (US-6.10).
      v_gift_cost := v_gift_cost + v_issue.total_cost;
    else
      v_cogs := row(v_cogs.material + v_layers.material, v_cogs.energy + v_layers.energy, v_cogs.depreciation + v_layers.depreciation,
                    v_cogs.operational + v_layers.operational, v_cogs.labor + v_layers.labor)::private.cost_layers;
      v_gross := v_gross + round(v_qty * v_line.unit_price, 2);
      v_line_discount := v_line_discount + round(v_line.discount * v_qty / v_line.qty, 2);
      v_units := v_units + v_qty;
    end if;
    update public.sales_order_lines
       set qty_delivered = qty_delivered + v_qty,
           unit_cogs_material = v_unit.material, unit_cogs_energy = v_unit.energy, unit_cogs_depreciation = v_unit.depreciation,
           unit_cogs_operational = v_unit.operational, unit_cogs_labor = v_unit.labor,
           cogs_total = cogs_total + v_issue.total_cost
     where id = v_line.id;
  end loop;

  -- Embalagens: despesa de venda, baixadas na entrega (decisão Q8).
  for v_pack in select * from jsonb_array_elements(case when p_delivery ? 'packaging' then coalesce(p_delivery -> 'packaging', '[]'::jsonb)
                                                       else private.default_packaging(p_order_id, v_lines) end) loop
    if coalesce((v_pack ->> 'qty')::numeric, 0) > 0 then
      v_pack_issue := private.issue_stock((v_pack ->> 'item_id')::bigint, (v_pack ->> 'qty')::numeric, 'PACKAGING_ISSUE', v_at, 'delivery', v_delivery_id);
      insert into public.order_packaging (order_id, delivery_id, item_id, qty, unit_cost_snapshot, total_cost, movement_ids)
      values (p_order_id, v_delivery_id, (v_pack ->> 'item_id')::bigint, (v_pack ->> 'qty')::numeric,
              round(v_pack_issue.total_cost / (v_pack ->> 'qty')::numeric, 6), v_pack_issue.total_cost, v_pack_issue.movement_ids);
      v_pack_total := v_pack_total + v_pack_issue.total_cost;
    end if;
  end loop;

  -- Descontos do pedido, frete cobrado e taxa fixa entram com a primeira entrega.
  if v_first then
    v_line_discount := v_line_discount + v_order.order_discount;
  end if;
  v_net := v_gross - v_line_discount;
  v_fee := private.channel_fee_for(v_order.channel_id, v_on, v_net, v_units, v_first);
  v_tax := round(v_net * private.sales_tax_pct(), 2);

  perform private.post_result(v_on, '1.1', v_gross, 'delivery', v_delivery_id, 'Venda — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '1.4', -v_line_discount, 'delivery', v_delivery_id, 'Descontos — ' || v_label, v_channel.id);
  if v_first then
    perform private.post_result(v_on, '1.2', v_order.shipping_charged, 'delivery', v_delivery_id, 'Frete cobrado — ' || v_label, v_channel.id);
  end if;
  perform private.post_result(v_on, '2.1', -v_cogs.material, 'delivery', v_delivery_id, 'CMV material — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '2.2', -v_cogs.energy, 'delivery', v_delivery_id, 'CMV energia — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '2.3', -v_cogs.depreciation, 'delivery', v_delivery_id, 'CMV depreciação — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '2.4', -v_cogs.operational, 'delivery', v_delivery_id, 'CMV operacional — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '2.5', -v_cogs.labor, 'delivery', v_delivery_id, 'CMV trabalho — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '3.1', -v_fee, 'delivery', v_delivery_id, 'Taxa do canal — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '3.3', -v_pack_total, 'delivery', v_delivery_id, 'Embalagem — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '3.4', -v_shipping_cost, 'delivery', v_delivery_id, 'Frete pago — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '3.5', -v_gift_cost, 'delivery', v_delivery_id, 'Brinde — ' || v_label, v_channel.id);
  perform private.post_result(v_on, '3.7', -v_tax, 'delivery', v_delivery_id, 'Impostos — ' || v_label, v_channel.id);

  update public.deliveries
     set revenue = v_net, cogs_total = v_cogs.material + v_cogs.energy + v_cogs.depreciation + v_cogs.operational + v_cogs.labor,
         channel_fee = v_fee, packaging_cost = v_pack_total
   where id = v_delivery_id;
  update public.sales_orders o
     set delivered_at = v_at,
         shipping_cost = o.shipping_cost + v_shipping_cost,
         packaging_cost_total = o.packaging_cost_total + v_pack_total,
         gift_cost_total = o.gift_cost_total + v_gift_cost,
         cogs_material = o.cogs_material + v_cogs.material, cogs_energy = o.cogs_energy + v_cogs.energy,
         cogs_depreciation = o.cogs_depreciation + v_cogs.depreciation, cogs_operational = o.cogs_operational + v_cogs.operational,
         cogs_labor = o.cogs_labor + v_cogs.labor,
         cogs_total = o.cogs_total + v_cogs.material + v_cogs.energy + v_cogs.depreciation + v_cogs.operational + v_cogs.labor,
         -- Taxa do canal final (recalculada na entrega).
         channel_fee_total = case when v_first then v_fee else o.channel_fee_total + v_fee end,
         tax_total = case when v_first then v_tax else o.tax_total + v_tax end
   where o.id = p_order_id;

  -- Marketplace: o repasse esperado acompanha a taxa final, se ainda não recebido.
  if v_first and v_channel.kind = 'MARKETPLACE' and v_order.receivable_id is not null and v_fee <> v_order.channel_fee_total then
    update public.installments i
       set amount = i.amount + (v_order.channel_fee_total - v_fee), principal = i.principal + (v_order.channel_fee_total - v_fee)
     where i.id = (select x.id from public.installments x where x.receivable_id = v_order.receivable_id and x.status = 'ABERTA'
                   order by x.number desc limit 1)
       and i.amount + (v_order.channel_fee_total - v_fee) >= 0;
    if found then
      update public.receivables
         set principal_total = principal_total + (v_order.channel_fee_total - v_fee), total = total + (v_order.channel_fee_total - v_fee)
       where id = v_order.receivable_id;
    end if;
  end if;

  v_status := private.refresh_order_status(p_order_id);
  return jsonb_build_object('delivery_id', v_delivery_id, 'order_id', p_order_id, 'status', v_status,
    'revenue', v_net, 'cogs', v_cogs.material + v_cogs.energy + v_cogs.depreciation + v_cogs.operational + v_cogs.labor,
    'channel_fee', v_fee, 'packaging', v_pack_total);
end;
$$;

-- Cria o pedido em rascunho (e opcionalmente confirma).
create function private.create_order_core(p_order jsonb, p_kind text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_channel_id bigint := coalesce(nullif(p_order ->> 'channel_id', '')::bigint, (private.settings()).default_channel_id);
  v_at timestamptz := coalesce(nullif(p_order ->> 'ordered_at', '')::timestamptz, now());
begin
  if not exists (select 1 from public.sales_channels c where c.id = v_channel_id and c.active) then
    raise exception 'Escolha um canal de venda ativo.' using errcode = '22023';
  end if;
  insert into public.sales_orders (number, customer_id, channel_id, kind, ordered_at, due_date, order_discount, discount_total,
                                   shipping_charged, total, payment_terms, notes)
  values (private.next_doc_number('PED', private.local_date(v_at)), private.resolve_customer(p_order), v_channel_id, p_kind, v_at,
          nullif(p_order ->> 'due_date', '')::date,
          round(coalesce(nullif(p_order ->> 'order_discount', '')::numeric, 0), 2),
          round(coalesce(nullif(p_order ->> 'order_discount', '')::numeric, 0), 2),
          round(coalesce(nullif(p_order ->> 'shipping_charged', '')::numeric, 0), 2),
          round(coalesce(nullif(p_order ->> 'shipping_charged', '')::numeric, 0), 2) - round(coalesce(nullif(p_order ->> 'order_discount', '')::numeric, 0), 2),
          case when jsonb_typeof(p_order -> 'payment_terms') = 'array' then p_order -> 'payment_terms' end,
          nullif(btrim(coalesce(p_order ->> 'notes', '')), ''))
  returning id into v_id;
  perform private.write_order_lines(v_id, p_order -> 'lines', v_channel_id, private.local_date(v_at));
  perform private.refresh_order_totals(v_id);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs públicas
-- -----------------------------------------------------------------------------

create function public.save_customer(p_customer jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_customer ->> 'id', '')::bigint;
begin
  perform private.assert_owner();
  if v_id is null then
    insert into public.customers (name, phone, email, instagram, document, address_street, address_number, address_complement,
                                  address_district, address_city, address_state, address_zip, notes, marketing_consent)
    values (btrim(p_customer ->> 'name'), nullif(btrim(coalesce(p_customer ->> 'phone', '')), ''), nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
            nullif(btrim(coalesce(p_customer ->> 'instagram', '')), ''), nullif(btrim(coalesce(p_customer ->> 'document', '')), ''),
            nullif(btrim(coalesce(p_customer ->> 'address_street', '')), ''), nullif(btrim(coalesce(p_customer ->> 'address_number', '')), ''),
            nullif(btrim(coalesce(p_customer ->> 'address_complement', '')), ''), nullif(btrim(coalesce(p_customer ->> 'address_district', '')), ''),
            nullif(btrim(coalesce(p_customer ->> 'address_city', '')), ''), upper(nullif(btrim(coalesce(p_customer ->> 'address_state', '')), '')),
            nullif(btrim(coalesce(p_customer ->> 'address_zip', '')), ''), nullif(btrim(coalesce(p_customer ->> 'notes', '')), ''),
            coalesce((p_customer ->> 'marketing_consent')::boolean, false))
    returning id into v_id;
    return v_id;
  end if;
  update public.customers c
     set name = btrim(coalesce(p_customer ->> 'name', c.name)),
         phone = nullif(btrim(coalesce(p_customer ->> 'phone', '')), ''), email = nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
         instagram = nullif(btrim(coalesce(p_customer ->> 'instagram', '')), ''), document = nullif(btrim(coalesce(p_customer ->> 'document', '')), ''),
         address_street = nullif(btrim(coalesce(p_customer ->> 'address_street', '')), ''), address_number = nullif(btrim(coalesce(p_customer ->> 'address_number', '')), ''),
         address_complement = nullif(btrim(coalesce(p_customer ->> 'address_complement', '')), ''),
         address_district = nullif(btrim(coalesce(p_customer ->> 'address_district', '')), ''),
         address_city = nullif(btrim(coalesce(p_customer ->> 'address_city', '')), ''),
         address_state = upper(nullif(btrim(coalesce(p_customer ->> 'address_state', '')), '')),
         address_zip = nullif(btrim(coalesce(p_customer ->> 'address_zip', '')), ''),
         notes = nullif(btrim(coalesce(p_customer ->> 'notes', '')), ''),
         marketing_consent = coalesce((p_customer ->> 'marketing_consent')::boolean, c.marketing_consent),
         active = coalesce((p_customer ->> 'active')::boolean, c.active)
   where c.id = v_id and c.anonymized_at is null;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- Exclusão a pedido do cliente (LGPD): dados pessoais anonimizados; pedidos continuam nos relatórios.
create function public.anonymize_customer(p_customer_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  update public.customers
     set name = 'Cliente removido #' || id, phone = null, email = null, instagram = null, document = null,
         address_street = null, address_number = null, address_complement = null, address_district = null,
         address_city = null, address_state = null, address_zip = null, notes = null, marketing_consent = false,
         active = false, anonymized_at = now()
   where id = p_customer_id and anonymized_at is null;
  if not found then
    raise exception 'Cliente não encontrado ou já anonimizado.' using errcode = '22023';
  end if;
  perform private.audit('UPDATE', 'customer', p_customer_id, null, 'Dados pessoais anonimizados (LGPD)', '{}'::jsonb);
end;
$$;

-- Pedido (US-6.4). p_order: {kind, customer_id | new_customer, channel_id, ordered_at, due_date, lines, order_discount,
-- shipping_charged, payment_terms: [{label, pct | amount, due_date}], notes, confirm}
create function public.create_order(p_request_id uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_id bigint;
  v_result jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'create_order');
  if v_done is not null then
    return v_done;
  end if;
  v_id := private.create_order_core(p_order, coalesce(nullif(p_order ->> 'kind', ''), 'ENCOMENDA'));
  if coalesce((p_order ->> 'confirm')::boolean, false) then
    v_result := private.confirm_order_core(v_id);
  else
    v_result := jsonb_build_object('order_id', v_id, 'number', (select o.number from public.sales_orders o where o.id = v_id), 'status', 'RASCUNHO');
    perform private.audit('CREATE', 'sales_order', v_id, v_result ->> 'number', 'Pedido criado (rascunho)', '{}'::jsonb);
  end if;
  return private.idem_finish(p_request_id, v_result);
end;
$$;

create function public.update_order_draft(p_order_id bigint, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.sales_orders;
  v_channel_id bigint;
begin
  perform private.assert_owner();
  select * into v_order from public.sales_orders o where o.id = p_order_id for update;
  if v_order.id is null or v_order.status <> 'RASCUNHO' then
    raise exception 'Só pedidos em rascunho podem ser alterados.' using errcode = '22023';
  end if;
  v_channel_id := coalesce(nullif(p_order ->> 'channel_id', '')::bigint, v_order.channel_id);
  update public.sales_orders
     set customer_id = coalesce(private.resolve_customer(p_order), customer_id),
         channel_id = v_channel_id, kind = coalesce(nullif(p_order ->> 'kind', ''), kind),
         due_date = nullif(p_order ->> 'due_date', '')::date,
         order_discount = x.disc,
         shipping_charged = x.ship,
         discount_total = discount_total - order_discount + x.disc,
         total = items_subtotal - (discount_total - order_discount + x.disc) + x.ship,
         payment_terms = case when jsonb_typeof(p_order -> 'payment_terms') = 'array' then p_order -> 'payment_terms' end,
         notes = nullif(btrim(coalesce(p_order ->> 'notes', '')), '')
    from (select round(coalesce(nullif(p_order ->> 'order_discount', '')::numeric, 0), 2) as disc,
                 round(coalesce(nullif(p_order ->> 'shipping_charged', '')::numeric, 0), 2) as ship) x
   where id = p_order_id;
  if p_order ? 'lines' then
    perform private.write_order_lines(p_order_id, p_order -> 'lines', v_channel_id, private.local_date(v_order.ordered_at));
  end if;
  v_order := private.refresh_order_totals(p_order_id);
  return jsonb_build_object('order_id', p_order_id, 'total', v_order.total);
end;
$$;

create function public.confirm_order(p_request_id uuid, p_order_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'confirm_order');
  if v_done is not null then
    return v_done;
  end if;
  return private.idem_finish(p_request_id, private.confirm_order_core(p_order_id));
end;
$$;

-- Reserva manual (US-6.5).
create function public.reserve_order_line(p_line_id bigint, p_qty numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty numeric;
  v_order_id bigint;
begin
  perform private.assert_owner();
  select l.order_id into v_order_id from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
  where l.id = p_line_id and o.status in ('CONFIRMADO', 'EM_PRODUCAO', 'PRONTO');
  if v_order_id is null then
    raise exception 'Só pedidos confirmados recebem reserva.' using errcode = '22023';
  end if;
  perform 1 from public.sales_orders o where o.id = v_order_id for update;
  v_qty := private.reserve_line(p_line_id, p_qty, 'MANUAL');
  if v_qty = 0 then
    raise exception 'Não há saldo livre para reservar.' using errcode = 'P0001', hint = 'saldo_insuficiente';
  end if;
  return jsonb_build_object('reserved', v_qty, 'status', private.refresh_order_status(v_order_id));
end;
$$;

create function public.release_order_reservation(p_line_id bigint, p_qty numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty numeric;
  v_order_id bigint;
begin
  perform private.assert_owner();
  select l.order_id into v_order_id from public.sales_order_lines l where l.id = p_line_id;
  perform 1 from public.sales_orders o where o.id = v_order_id for update;
  v_qty := private.release_line_reservations(p_line_id, p_qty, 'CANCELADA');
  return jsonb_build_object('released', v_qty, 'status', private.refresh_order_status(v_order_id));
end;
$$;

create function public.deliver_order(p_request_id uuid, p_order_id bigint, p_delivery jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_result jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'deliver_order');
  if v_done is not null then
    return v_done;
  end if;
  v_result := private.deliver_order_core(p_order_id, coalesce(p_delivery, '{}'::jsonb));
  perform private.audit('UPDATE', 'sales_order', p_order_id, (select o.number from public.sales_orders o where o.id = p_order_id),
                        'Entrega registrada', v_result);
  return private.idem_finish(p_request_id, v_result);
end;
$$;

-- Venda rápida (US-6.3): confirmar + entregar + receber numa transação.
-- p_sale: {channel_id, customer_id | new_customer, lines, order_discount, shipping_charged, packaging?, delivered_at,
--          payment: {account_id, amount?, fee?} | null (fica a receber), notes}
create function public.quick_sale(p_request_id uuid, p_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_id bigint;
  v_confirm jsonb;
  v_delivery jsonb;
  v_receipt jsonb;
  v_installment bigint;
  v_missing text;
  v_payment jsonb := p_sale -> 'payment';
  v_at timestamptz := coalesce(nullif(p_sale ->> 'delivered_at', '')::timestamptz, now());
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'quick_sale');
  if v_done is not null then
    return v_done;
  end if;
  v_id := private.create_order_core(p_sale || jsonb_build_object('ordered_at', v_at), 'PRONTA_ENTREGA');
  v_confirm := private.confirm_order_core(v_id);
  select string_agg(i.name || ' (faltam ' || private.fmt_num(l.qty - l.qty_reserved) || ')', ', ') into v_missing
  from public.sales_order_lines l join public.items i on i.id = l.item_id
  where l.order_id = v_id and l.qty_reserved < l.qty;
  if v_missing is not null then
    raise exception 'Saldo livre insuficiente: %. Transforme a venda em encomenda.', v_missing
      using errcode = 'P0001', hint = 'transformar_em_encomenda';
  end if;
  v_delivery := private.deliver_order_core(v_id, jsonb_build_object('delivered_at', v_at, 'method', coalesce(p_sale ->> 'method', 'RETIRADA'),
    'shipping_cost', p_sale ->> 'shipping_cost') || case when p_sale ? 'packaging' then jsonb_build_object('packaging', p_sale -> 'packaging') else '{}'::jsonb end);
  if jsonb_typeof(v_payment) = 'object' and nullif(v_payment ->> 'account_id', '') is not null then
    select i.id into v_installment from public.installments i join public.sales_orders o on o.receivable_id = i.receivable_id
    where o.id = v_id and i.status = 'ABERTA' order by i.number limit 1;
    if v_installment is not null then
      v_receipt := private.settle_receivable_installment(v_installment, private.local_date(v_at), nullif(v_payment ->> 'amount', '')::numeric,
        (v_payment ->> 'account_id')::bigint, coalesce(nullif(v_payment ->> 'fee', '')::numeric, 0), 'SALDO', null);
    end if;
  end if;
  perform private.audit('CREATE', 'sales_order', v_id, v_confirm ->> 'number', 'Venda rápida', v_delivery);
  return private.idem_finish(p_request_id, jsonb_build_object('order_id', v_id, 'number', v_confirm ->> 'number',
    'delivery', v_delivery, 'receipt', v_receipt));
end;
$$;

-- Venda anterior ao sistema (US-6.11): entregue e recebida, sem movimentar estoque, CMV = custo informado.
-- p_sale: {date, channel_id, customer_id | new_customer, lines: [{variant_id?, custom_description, qty, unit_price, unit_cost}],
--          account_id? (sem conta: recebida antes do sistema, fora do caixa), notes}
create function public.register_historical_sale(p_request_id uuid, p_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_settings public.settings := private.settings();
  v_date date := nullif(p_sale ->> 'date', '')::date;
  v_id bigint;
  v_order public.sales_orders;
  v_cogs numeric;
  v_receivable_id bigint;
  v_installment bigint;
  v_label text;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'register_historical_sale');
  if v_done is not null then
    return v_done;
  end if;
  if v_settings.go_live_date is null then
    raise exception 'Defina a data de início do uso do sistema em Configurações antes de lançar vendas antigas.' using errcode = '22023';
  end if;
  if v_date is null or v_date >= v_settings.go_live_date then
    raise exception 'Venda anterior ao sistema precisa ter data antes de % (início do uso).', to_char(v_settings.go_live_date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_sale -> 'lines', '[]'::jsonb)) l where nullif(l ->> 'unit_cost', '') is null) then
    raise exception 'Informe o custo unitário conhecido de cada item.' using errcode = '22023';
  end if;
  v_id := private.create_order_core(p_sale || jsonb_build_object('ordered_at', (v_date::text || ' 12:00:00')::timestamp at time zone v_settings.timezone),
                                    'PRONTA_ENTREGA');
  v_order := private.refresh_order_totals(v_id);
  v_label := 'Pedido ' || v_order.number || ' (anterior ao sistema)';
  select coalesce(sum(round(l.qty * l.historical_unit_cost, 2)), 0) into v_cogs from public.sales_order_lines l where l.order_id = v_id;
  update public.sales_order_lines l set qty_delivered = l.qty, unit_cogs_material = l.historical_unit_cost, cogs_total = round(l.qty * l.historical_unit_cost, 2)
   where l.order_id = v_id;
  perform private.post_result(v_date, '1.1', v_order.items_subtotal, 'sales_order', v_id, 'Venda — ' || v_label, v_order.channel_id);
  perform private.post_result(v_date, '1.4', -v_order.discount_total, 'sales_order', v_id, 'Descontos — ' || v_label, v_order.channel_id);
  perform private.post_result(v_date, '1.2', v_order.shipping_charged, 'sales_order', v_id, 'Frete cobrado — ' || v_label, v_order.channel_id);
  perform private.post_result(v_date, '2.1', -v_cogs, 'sales_order', v_id, 'CMV (custo informado) — ' || v_label, v_order.channel_id);
  if v_order.total > 0 then
    v_receivable_id := private.create_title('RECEBER', v_order.customer_id, 'sales_order', v_id, v_label, '1.1', v_date, v_order.total,
      jsonb_build_array(jsonb_build_object('due_date', v_date, 'amount', v_order.total)));
    select i.id into v_installment from public.installments i where i.receivable_id = v_receivable_id;
    if nullif(p_sale ->> 'account_id', '') is not null then
      perform private.settle_receivable_installment(v_installment, v_date, null, (p_sale ->> 'account_id')::bigint, 0, 'SALDO', null);
    else
      -- Recebida antes do sistema, fora das contas da empresa.
      update public.installments set status = 'PAGA', paid_on = v_date, paid_amount = amount, notes = 'Recebida antes do início do sistema'
       where id = v_installment;
      perform private.refresh_title_status(null, v_receivable_id);
    end if;
  end if;
  update public.sales_orders
     set status = 'ENTREGUE', is_historical = true, confirmed_at = now(), delivered_at = ordered_at, receivable_id = v_receivable_id,
         cogs_material = v_cogs, cogs_total = v_cogs
   where id = v_id;
  perform private.audit('CREATE', 'sales_order', v_id, v_order.number, 'Venda anterior ao sistema', jsonb_build_object('total', v_order.total, 'cmv', v_cogs));
  return private.idem_finish(p_request_id, jsonb_build_object('order_id', v_id, 'number', v_order.number, 'total', v_order.total, 'cogs', v_cogs));
end;
$$;

-- Cancelamento (US-6.8): libera reservas e cancela parcelas abertas; sinal recebido vira
-- reembolso (conta a pagar ao cliente) ou crédito do cliente.
create function public.cancel_order(
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

-- Produzir encomenda (US-5.7): planeja uma impressão com o que falta do pedido.
create function public.produce_order(p_request_id uuid, p_order_id bigint, p_equipment_id bigint, p_planned_for timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outputs jsonb;
  v_result jsonb;
begin
  perform private.assert_production();
  select jsonb_agg(jsonb_build_object('variant_id', l.variant_id, 'qty_planned', ceil(l.qty - l.qty_reserved - l.qty_delivered)::integer) order by l.sort_order)
    into v_outputs
  from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
  where l.order_id = p_order_id and o.status in ('CONFIRMADO', 'EM_PRODUCAO') and l.variant_id is not null
    and l.qty_reserved + l.qty_delivered < l.qty;
  if v_outputs is null then
    raise exception 'Nada a produzir: o pedido já está reservado, entregue ou não confirmado.' using errcode = '22023';
  end if;
  v_result := public.plan_print_job(p_request_id, jsonb_build_object('equipment_id', p_equipment_id, 'planned_for', coalesce(p_planned_for, now()),
    'outputs', v_outputs, 'sales_order_id', p_order_id));
  perform private.refresh_order_status(p_order_id);
  return v_result;
end;
$$;

-- Peças liberadas de impressão vinculada a encomenda são reservadas para o pedido (RN-18, US-5.7).
create function private.reserve_released_output()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_line record;
  v_left numeric := coalesce(new.qty_released, 0);
  v_got numeric;
begin
  if new.status = 'LIBERADA' and old.status is distinct from 'LIBERADA' and v_left > 0 then
    select j.sales_order_id into v_order_id from public.print_jobs j where j.id = new.print_job_id;
    if v_order_id is not null then
      for v_line in
        select l.id from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
        where l.order_id = v_order_id and l.variant_id = new.variant_id and o.status in ('CONFIRMADO', 'EM_PRODUCAO', 'PRONTO')
        order by l.sort_order
      loop
        exit when v_left <= 0;
        v_got := private.reserve_line(v_line.id, v_left, 'PRODUCAO', new.id);
        v_left := v_left - v_got;
      end loop;
      perform private.refresh_order_status(v_order_id);
    end if;
  end if;
  return null;
end;
$$;

create trigger print_job_outputs_reserve after update of status on public.print_job_outputs
  for each row execute function private.reserve_released_output();

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------

create view public.v_installments with (security_invoker = true) as
select
  i.id, case when i.payable_id is not null then 'PAGAR' else 'RECEBER' end as kind,
  i.payable_id, i.receivable_id, coalesce(p.number, r.number) as title_number,
  coalesce(p.description, r.description) as description,
  coalesce(p.source_type, r.source_type) as source_type, coalesce(p.source_id, r.source_id) as source_id,
  case coalesce(p.source_type, r.source_type)
    when 'purchase' then (select c.number from public.purchases c where c.id = p.source_id)
    when 'sales_order' then (select o.number from public.sales_orders o where o.id = r.source_id)
    else coalesce(p.number, r.number) end as source_ref,
  coalesce(s.name, cu.name) as counterparty_name,
  p.supplier_id, r.customer_id,
  case when r.source_type = 'sales_order' then (select o.channel_id from public.sales_orders o where o.id = r.source_id) end as channel_id,
  i.number, i.of_total, i.due_date, i.amount, i.principal, i.interest, i.status,
  i.status = 'ABERTA' and i.due_date < private.today() as is_overdue,
  i.paid_on, i.paid_amount, i.fee_amount, i.extra_amount, i.discount_amount,
  i.payer, coalesce(i.owner_funding_type, p.owner_funding_type) as owner_funding_type,
  i.account_id, a.name as account_name, a.owner as account_owner, a.kind as account_kind,
  coalesce(p.category_id, r.category_id) as category_id, fc.code as category_code, fc.name as category_name,
  i.parent_id, i.notes, i.created_at
from public.installments i
left join public.payables p on p.id = i.payable_id
left join public.receivables r on r.id = i.receivable_id
left join public.suppliers s on s.id = p.supplier_id
left join public.customers cu on cu.id = r.customer_id
left join public.payment_accounts a on a.id = i.account_id
left join public.financial_categories fc on fc.id = coalesce(p.category_id, r.category_id);

create view public.v_sales_orders with (security_invoker = true) as
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
  end as contribution_margin
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

create view public.v_sales_order_lines with (security_invoker = true) as
select
  l.id, l.order_id, l.item_id, l.variant_id, coalesce(i.name, l.custom_description) as description, i.sku,
  l.custom_description, l.qty, l.unit_price, l.discount, round(l.qty * l.unit_price, 2) - l.discount as line_total,
  l.is_gift, l.qty_reserved, l.qty_delivered, l.qty - l.qty_reserved - l.qty_delivered as qty_pending,
  b.qty_on_hand - b.qty_reserved as item_free_qty,
  l.unit_cogs_material, l.unit_cogs_energy, l.unit_cogs_depreciation, l.unit_cogs_operational, l.unit_cogs_labor,
  l.cogs_total, l.historical_unit_cost, l.sort_order
from public.sales_order_lines l
left join public.items i on i.id = l.item_id
left join public.stock_balances b on b.item_id = l.item_id;

create view public.v_customers with (security_invoker = true) as
select
  c.*,
  (select count(*) from public.sales_orders o where o.customer_id = c.id and o.status <> 'CANCELADO')::integer as order_count,
  (select coalesce(sum(o.total), 0) from public.sales_orders o where o.customer_id = c.id and o.status = 'ENTREGUE') as total_purchased,
  (select max(o.ordered_at) from public.sales_orders o where o.customer_id = c.id and o.status <> 'CANCELADO') as last_order_at,
  (select coalesce(sum(i.amount), 0) from public.installments i join public.receivables r on r.id = i.receivable_id
    where r.customer_id = c.id and i.status = 'ABERTA') as open_amount,
  (select coalesce(sum(i.amount), 0) from public.installments i join public.receivables r on r.id = i.receivable_id
    where r.customer_id = c.id and i.status = 'ABERTA' and i.due_date < private.today()) as overdue_amount
from public.customers c;

-- -----------------------------------------------------------------------------
-- Correção: saldo inicial de produto pronto informado por camada (US-1.3)
-- -----------------------------------------------------------------------------

create or replace function public.register_opening_balance(
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
    if v_cost is null and v_item.kind = 'FINISHED_GOOD' and jsonb_typeof(v_entry -> 'layers') = 'object' then
      -- Produto pronto feito antes do sistema: custo informado por camada.
      v_cost := coalesce((v_entry #>> '{layers,material}')::numeric, 0) + coalesce((v_entry #>> '{layers,energy}')::numeric, 0)
              + coalesce((v_entry #>> '{layers,depreciation}')::numeric, 0) + coalesce((v_entry #>> '{layers,operational}')::numeric, 0)
              + coalesce((v_entry #>> '{layers,labor}')::numeric, 0);
    end if;
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


-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;
alter table public.deliveries enable row level security;
alter table public.delivery_lines enable row level security;
alter table public.order_packaging enable row level security;
alter table public.reservations enable row level security;

create policy customers_select on public.customers for select to authenticated using (private.can_view_costs());
create policy sales_orders_select on public.sales_orders for select to authenticated using (private.can_view_costs());
create policy sales_order_lines_select on public.sales_order_lines for select to authenticated using (private.can_view_costs());
create policy deliveries_select on public.deliveries for select to authenticated using (private.can_view_costs());
create policy delivery_lines_select on public.delivery_lines for select to authenticated using (private.can_view_costs());
create policy order_packaging_select on public.order_packaging for select to authenticated using (private.can_view_costs());
create policy reservations_select on public.reservations for select to authenticated using (private.can_view_costs());

-- Views de leitura usam o "hoje" da empresa (vencidos).
create or replace function private.apply_grants()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  revoke all on all tables in schema public from anon, public;
  revoke all on all sequences in schema public from anon, public, authenticated;
  revoke all on all functions in schema public from anon, public;
  revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
  grant select on all tables in schema public to authenticated;
  -- Tabelas internas: nem leitura (já não têm política de RLS).
  revoke all on public.idempotency_keys, public.doc_sequences from authenticated;
  grant execute on all functions in schema public to authenticated;

  revoke all on all functions in schema private from public, anon, authenticated;
  for v_name in select unnest(array[
    'private.current_app_role()', 'private.is_member()', 'private.has_role(text[])', 'private.can_view_costs()', 'private.today()'
  ]) loop
    execute format('grant execute on function %s to authenticated', v_name);
  end loop;

  grant usage on schema public to service_role;
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
  grant execute on all functions in schema public to service_role;
end;
$$;


select private.apply_grants();
