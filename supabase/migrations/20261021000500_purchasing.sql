-- =============================================================================
-- Wabee — 0500 Compras, recebimento e contas a pagar (Módulo 3, seções 4.5 e 9)
--
-- Uma compra gera dois efeitos independentes:
--   * confirmar → conta a pagar e parcelas (quem paga: empresa ou dono);
--   * receber   → entrada no estoque (carretéis, componentes) e equipamentos.
-- Compra de material e de equipamento nunca entra no DRE (vira estoque e
-- depreciação); linhas de despesa, ferramentas pequenas e consumíveis sem
-- controle de saldo viram despesa na data da compra (RN-26, decisão Q9).
-- =============================================================================

create table public.purchases (
  id bigint generated always as identity primary key,
  number text not null unique,
  supplier_id bigint references public.suppliers (id),
  purchased_at date not null,
  invoice_ref text check (invoice_ref is null or char_length(invoice_ref) <= 60),
  status text not null default 'RASCUNHO' check (status in ('RASCUNHO', 'CONFIRMADA', 'RECEBIDA_PARCIAL', 'RECEBIDA', 'CANCELADA')),
  goods_total numeric(14,2) not null default 0,
  freight_total numeric(14,2) not null default 0 check (freight_total >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  cash_price_total numeric(14,2) not null default 0,
  installments_total numeric(14,2),
  interest_total numeric(14,2) not null default 0 check (interest_total >= 0),
  interest_unknown boolean not null default false,
  payment_method text not null default 'PIX' check (payment_method in ('PIX', 'DINHEIRO', 'DEBITO', 'CREDITO_VISTA', 'CREDITO_PARCELADO', 'BOLETO')),
  payment_account_id bigint references public.payment_accounts (id),
  payer text not null default 'EMPRESA' check (payer in ('EMPRESA', 'DONO')),
  owner_funding_type text check (owner_funding_type in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_PAID_EXPENSE')),
  installments_count integer not null default 1 check (installments_count between 1 and 48),
  first_due_date date,
  custom_installments jsonb,
  is_opening boolean not null default false,
  manually_allocated boolean not null default false,
  payable_id bigint references public.payables (id),
  notes text check (notes is null or char_length(notes) <= 2000),
  confirmed_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (payer = 'EMPRESA' or owner_funding_type is not null),
  check (interest_total = 0 or not interest_unknown)
);

create index purchases_date_idx on public.purchases (purchased_at desc);
create trigger purchases_touch before update on public.purchases for each row execute function private.touch_updated_at();

comment on column public.purchases.cash_price_total is 'Valor à vista: bens + frete − desconto. Juros = soma das parcelas − à vista (RN-03).';
comment on column public.purchases.is_opening is 'Compra feita antes do sistema (US-3.6): o recebimento registra o saldo que ainda resta.';

create table public.purchase_lines (
  id bigint generated always as identity primary key,
  purchase_id bigint not null references public.purchases (id) on delete cascade,
  line_kind text not null check (line_kind in ('ITEM', 'EQUIPMENT', 'EXPENSE')),
  item_id bigint references public.items (id),
  equipment_id bigint references public.equipment (id),
  expense_category_id bigint references public.financial_categories (id),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(16,6) not null check (unit_price >= 0),
  line_total numeric(14,2) not null default 0,
  freight_alloc numeric(14,2) not null default 0,
  discount_alloc numeric(14,2) not null default 0,
  landed_total numeric(14,2) not null default 0,
  landed_unit_cost numeric(16,6) not null default 0,
  qty_received numeric(14,3) not null default 0 check (qty_received >= 0),
  sort_order integer not null default 0,
  check (
    (line_kind = 'ITEM' and item_id is not null and expense_category_id is null)
    or (line_kind = 'EQUIPMENT' and item_id is null and expense_category_id is null)
    or (line_kind = 'EXPENSE' and item_id is null and equipment_id is null and expense_category_id is not null)
  )
);

create index purchase_lines_purchase_idx on public.purchase_lines (purchase_id);
create index purchase_lines_item_idx on public.purchase_lines (item_id);

alter table public.equipment
  add constraint equipment_purchase_line_fk foreign key (purchase_line_id) references public.purchase_lines (id);

create table public.receipts (
  id bigint generated always as identity primary key,
  purchase_id bigint not null references public.purchases (id),
  received_at timestamptz not null,
  notes text,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.receipt_lines (
  id bigint generated always as identity primary key,
  receipt_id bigint not null references public.receipts (id),
  purchase_line_id bigint not null references public.purchase_lines (id),
  qty numeric(14,3) not null check (qty > 0),
  stock_qty numeric(14,3) not null default 0,
  spool_count integer,
  lot_codes text[] not null default '{}',
  movement_ids bigint[] not null default '{}',
  equipment_ids bigint[] not null default '{}'
);

create index receipt_lines_receipt_idx on public.receipt_lines (receipt_id);

-- -----------------------------------------------------------------------------
-- Cálculos
-- -----------------------------------------------------------------------------

-- 1º vencimento sugerido pelo cartão: compras a partir do dia de fechamento vão para a fatura seguinte.
create function public.suggest_first_due_date(p_account_id bigint, p_purchased_at date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.payment_accounts;
  v_close_month date;
  v_due_month date;
  v_last integer;
begin
  select * into v_account from public.payment_accounts a where a.id = p_account_id;
  if v_account.id is null or v_account.kind <> 'CARTAO_CREDITO' or v_account.card_due_day is null then
    return (p_purchased_at + interval '1 month')::date;
  end if;
  -- Mês em que a fatura desta compra fecha.
  v_close_month := date_trunc('month', p_purchased_at)::date;
  if extract(day from p_purchased_at) >= coalesce(v_account.card_closing_day, 1) then
    v_close_month := (v_close_month + interval '1 month')::date;
  end if;
  -- Vencimento depois do fechamento: no mesmo mês se o dia de vencimento é posterior; senão no seguinte.
  v_due_month := case when v_account.card_due_day > coalesce(v_account.card_closing_day, 0) then v_close_month
                      else (v_close_month + interval '1 month')::date end;
  v_last := extract(day from (v_due_month + interval '1 month' - interval '1 day'))::integer;
  return v_due_month + (least(v_account.card_due_day, v_last) - 1);
end;
$$;

-- Rateio de frete e desconto proporcional ao valor de cada linha (RN-02) e totais da compra.
create function private.recalculate_purchase(p_purchase_id bigint)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
  v_ids bigint[];
  v_totals numeric[];
  v_freight numeric[];
  v_discount numeric[];
  v_goods numeric := 0;
begin
  select * into v_purchase from public.purchases p where p.id = p_purchase_id for update;
  update public.purchase_lines set line_total = round(qty * unit_price, 2) where purchase_id = p_purchase_id;
  select coalesce(array_agg(l.id order by l.sort_order, l.id), '{}'), coalesce(array_agg(l.line_total order by l.sort_order, l.id), '{}')
    into v_ids, v_totals
  from public.purchase_lines l where l.purchase_id = p_purchase_id;
  select coalesce(sum(x), 0) into v_goods from unnest(v_totals) x;
  if v_purchase.discount_total > v_goods + v_purchase.freight_total then
    raise exception 'O desconto é maior que o valor da compra.' using errcode = '22023';
  end if;
  v_freight := private.allocate_money(v_purchase.freight_total, v_totals);
  v_discount := private.allocate_money(v_purchase.discount_total, v_totals);
  for i in 1..coalesce(array_length(v_ids, 1), 0) loop
    update public.purchase_lines l
       set freight_alloc = v_freight[i],
           discount_alloc = v_discount[i],
           landed_total = l.line_total + v_freight[i] - v_discount[i],
           landed_unit_cost = round((l.line_total + v_freight[i] - v_discount[i]) / l.qty, 6)
     where l.id = v_ids[i];
  end loop;
  update public.purchases
     set goods_total = v_goods,
         cash_price_total = v_goods + freight_total - discount_total
   where id = p_purchase_id
   returning * into v_purchase;
  return v_purchase;
end;
$$;

-- Parcelas da compra (RN-03, RN-25): [{due_date, amount}].
create function private.purchase_installments(p_purchase public.purchases)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total numeric := coalesce(p_purchase.installments_total, p_purchase.cash_price_total);
  v_parts numeric[];
  v_first date;
  v_result jsonb := '[]'::jsonb;
  v_sum numeric := 0;
  v_item jsonb;
begin
  if p_purchase.custom_installments is not null and jsonb_array_length(p_purchase.custom_installments) > 0 then
    -- Valores editados para bater com a fatura: a soma tem de igualar o total.
    for v_item in select * from jsonb_array_elements(p_purchase.custom_installments) loop
      v_sum := v_sum + round((v_item ->> 'amount')::numeric, 2);
    end loop;
    if v_sum <> round(v_total, 2) then
      raise exception 'A soma das parcelas (%) não bate com o total (%).', private.fmt_money(v_sum), private.fmt_money(v_total) using errcode = '22023';
    end if;
    return p_purchase.custom_installments;
  end if;
  if p_purchase.payment_method in ('PIX', 'DINHEIRO', 'DEBITO') then
    return jsonb_build_array(jsonb_build_object('due_date', p_purchase.purchased_at, 'amount', round(v_total, 2)));
  end if;
  v_first := coalesce(p_purchase.first_due_date, public.suggest_first_due_date(p_purchase.payment_account_id, p_purchase.purchased_at));
  if p_purchase.payment_method = 'CREDITO_VISTA' then
    return jsonb_build_array(jsonb_build_object('due_date', v_first, 'amount', round(v_total, 2)));
  end if;
  v_parts := private.split_amount(v_total, p_purchase.installments_count);
  for i in 1..p_purchase.installments_count loop
    v_result := v_result || jsonb_build_object('due_date', (v_first + make_interval(months => i - 1))::date, 'amount', v_parts[i]);
  end loop;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Rascunho (US-3.2): nada acontece no estoque nem no financeiro até confirmar.
-- p_purchase: {id?, supplier_id | new_supplier_name, purchased_at, invoice_ref, freight_total, discount_total,
--   payment_method, payment_account_id, payer, owner_funding_type, installments_count, first_due_date,
--   installments_total, interest_unknown, custom_installments, is_opening, manually_allocated, notes,
--   lines: [{line_kind, item_id, expense_category_id, description, qty, unit_price}]}
create function public.save_purchase_draft(p_purchase jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_purchase ->> 'id', '')::bigint;
  v_row public.purchases;
  v_supplier_id bigint := nullif(p_purchase ->> 'supplier_id', '')::bigint;
  v_line jsonb;
  v_order integer := 0;
  v_item public.items;
  v_kind text;
  v_account public.payment_accounts;
  v_payer text := coalesce(nullif(p_purchase ->> 'payer', ''), 'EMPRESA');
  v_category public.financial_categories;
  v_purchased date := coalesce(nullif(p_purchase ->> 'purchased_at', '')::date, private.today());
begin
  perform private.assert_owner();
  if v_supplier_id is null and nullif(btrim(coalesce(p_purchase ->> 'new_supplier_name', '')), '') is not null then
    select s.id into v_supplier_id from public.suppliers s where lower(btrim(s.name)) = lower(btrim(p_purchase ->> 'new_supplier_name'));
    if v_supplier_id is null then
      v_supplier_id := public.save_supplier(jsonb_build_object('name', btrim(p_purchase ->> 'new_supplier_name')));
    end if;
  end if;
  if nullif(p_purchase ->> 'payment_account_id', '') is not null then
    select * into v_account from public.payment_accounts a where a.id = (p_purchase ->> 'payment_account_id')::bigint;
    if v_account.id is null then
      raise exception 'Conta de pagamento não encontrada.' using errcode = '22023';
    end if;
    -- Conta ou cartão do dono força pagador = dono (US-3.4).
    if v_account.owner = 'DONO' then
      v_payer := 'DONO';
    end if;
  end if;

  if v_id is null then
    insert into public.purchases (number, supplier_id, purchased_at)
    values (private.next_doc_number('CMP', v_purchased), v_supplier_id, v_purchased)
    returning * into v_row;
    v_id := v_row.id;
  else
    select * into v_row from public.purchases p where p.id = v_id for update;
    if v_row.id is null then
      raise exception 'Compra não encontrada.' using errcode = '22023';
    end if;
    if v_row.status <> 'RASCUNHO' then
      raise exception 'Só compras em rascunho podem ser alteradas.' using errcode = '22023';
    end if;
  end if;

  update public.purchases p
     set supplier_id = v_supplier_id,
         purchased_at = v_purchased,
         invoice_ref = nullif(btrim(coalesce(p_purchase ->> 'invoice_ref', '')), ''),
         freight_total = round(coalesce(nullif(p_purchase ->> 'freight_total', '')::numeric, 0), 2),
         discount_total = round(coalesce(nullif(p_purchase ->> 'discount_total', '')::numeric, 0), 2),
         payment_method = coalesce(nullif(p_purchase ->> 'payment_method', ''), 'PIX'),
         payment_account_id = v_account.id,
         payer = v_payer,
         owner_funding_type = case when v_payer = 'DONO'
           then coalesce(nullif(p_purchase ->> 'owner_funding_type', ''), (private.settings()).default_owner_funding_type) end,
         installments_count = case when coalesce(nullif(p_purchase ->> 'payment_method', ''), 'PIX') in ('CREDITO_PARCELADO', 'BOLETO')
           then coalesce(nullif(p_purchase ->> 'installments_count', '')::integer, 1) else 1 end,
         first_due_date = nullif(p_purchase ->> 'first_due_date', '')::date,
         installments_total = round(nullif(p_purchase ->> 'installments_total', '')::numeric, 2),
         interest_unknown = coalesce((p_purchase ->> 'interest_unknown')::boolean, false),
         custom_installments = case when jsonb_typeof(p_purchase -> 'custom_installments') = 'array'
           and jsonb_array_length(p_purchase -> 'custom_installments') > 0 then p_purchase -> 'custom_installments' end,
         is_opening = coalesce((p_purchase ->> 'is_opening')::boolean, false),
         manually_allocated = coalesce((p_purchase ->> 'manually_allocated')::boolean, false),
         notes = nullif(btrim(coalesce(p_purchase ->> 'notes', '')), '')
   where p.id = v_id;

  if p_purchase ? 'lines' then
    delete from public.purchase_lines where purchase_id = v_id;
    for v_line in select * from jsonb_array_elements(coalesce(p_purchase -> 'lines', '[]'::jsonb)) loop
      v_order := v_order + 1;
      v_kind := coalesce(nullif(v_line ->> 'line_kind', ''), 'ITEM');
      if v_kind = 'ITEM' then
        select * into v_item from public.items i where i.id = (v_line ->> 'item_id')::bigint;
        if v_item.id is null then
          raise exception 'Item da linha % não encontrado.', v_order using errcode = '22023';
        end if;
        if v_item.kind = 'FINISHED_GOOD' then
          raise exception 'Produto pronto não é comprado: ele é produzido.' using errcode = '22023';
        end if;
      elsif v_kind = 'EXPENSE' then
        select * into v_category from public.financial_categories c where c.id = (v_line ->> 'expense_category_id')::bigint;
        if v_category.id is null or v_category.parent_id is null
           or v_category.nature not in ('DESPESA_VENDA', 'DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA', 'NAO_OPERACIONAL') then
          raise exception 'Escolha uma categoria de despesa para a linha %.', v_order using errcode = '22023';
        end if;
      end if;
      insert into public.purchase_lines (purchase_id, line_kind, item_id, expense_category_id, description, qty, unit_price, sort_order)
      values (
        v_id, v_kind,
        case when v_kind = 'ITEM' then v_item.id end,
        case when v_kind = 'EXPENSE' then v_category.id end,
        coalesce(nullif(btrim(coalesce(v_line ->> 'description', '')), ''), case when v_kind = 'ITEM' then v_item.name else 'Equipamento' end),
        round((v_line ->> 'qty')::numeric, 3), round((v_line ->> 'unit_price')::numeric, 6), v_order
      );
    end loop;
  end if;
  v_row := private.recalculate_purchase(v_id);
  return jsonb_build_object('purchase_id', v_id, 'number', v_row.number, 'goods_total', v_row.goods_total,
    'cash_price_total', v_row.cash_price_total,
    'installments', case when exists (select 1 from public.purchase_lines l where l.purchase_id = v_id)
      then private.purchase_installments(v_row) else '[]'::jsonb end);
end;
$$;

create function public.discard_purchase_draft(p_purchase_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  update public.purchases set status = 'CANCELADA', canceled_at = now(), cancel_reason = 'Rascunho descartado'
   where id = p_purchase_id and status = 'RASCUNHO';
  if not found then
    raise exception 'Só rascunhos podem ser descartados.' using errcode = '22023';
  end if;
end;
$$;

-- Confirma a compra (US-3.3, US-3.4): calcula o custo de aquisição por linha, cria a conta a
-- pagar e as parcelas. À vista (PIX/dinheiro/débito) já sai paga na data da compra.
-- Compra anterior ao sistema: p_paid_count parcelas já pagas são baixadas na data de cada vencimento.
create function private.confirm_purchase_core(p_purchase_id bigint, p_paid_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
  v_installments jsonb;
  v_installments_total numeric;
  v_category_code text;
  v_payable_id bigint;
  v_inst record;
  v_line record;
  v_kinds text[];
  v_supplier text;
  v_label text;
  v_paid integer := 0;
  v_only_expense boolean;
begin
  select * into v_purchase from public.purchases p where p.id = p_purchase_id for update;
  if v_purchase.id is null then
    raise exception 'Compra não encontrada.' using errcode = '22023';
  end if;
  if v_purchase.status <> 'RASCUNHO' then
    raise exception 'A compra % já foi confirmada.', v_purchase.number using errcode = '22023';
  end if;
  if not exists (select 1 from public.purchase_lines l where l.purchase_id = p_purchase_id) then
    raise exception 'Adicione ao menos uma linha à compra.' using errcode = '22023';
  end if;
  if v_purchase.is_opening and (private.settings()).go_live_date is not null and v_purchase.purchased_at >= (private.settings()).go_live_date then
    raise exception 'Compra anterior ao sistema precisa ter data antes do início do uso (%).',
      to_char((private.settings()).go_live_date, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if v_purchase.payment_method <> 'PIX' and v_purchase.payment_method <> 'DINHEIRO' and v_purchase.payment_method <> 'DEBITO'
     and v_purchase.payment_account_id is null and v_purchase.payer = 'EMPRESA' and v_purchase.payment_method <> 'BOLETO' then
    raise exception 'Informe o cartão usado na compra.' using errcode = '22023';
  end if;
  v_purchase := private.recalculate_purchase(p_purchase_id);
  perform private.assert_open_period(v_purchase.purchased_at);

  v_installments_total := coalesce(v_purchase.installments_total, v_purchase.cash_price_total);
  if v_purchase.interest_unknown and v_installments_total <> v_purchase.cash_price_total then
    raise exception 'Sem o valor à vista, a soma das linhas (%) precisa igualar o total parcelado (%).',
      private.fmt_money(v_purchase.cash_price_total), private.fmt_money(v_installments_total) using errcode = '22023';
  end if;
  if v_installments_total < v_purchase.cash_price_total then
    raise exception 'O total parcelado (%) é menor que o valor à vista (%).', private.fmt_money(v_installments_total),
      private.fmt_money(v_purchase.cash_price_total) using errcode = '22023';
  end if;
  v_installments := private.purchase_installments(v_purchase);

  select array_agg(distinct l.line_kind) into v_kinds from public.purchase_lines l where l.purchase_id = p_purchase_id;
  v_only_expense := v_kinds = array['EXPENSE'];
  if v_only_expense then
    select c.code into v_category_code
    from public.purchase_lines l join public.financial_categories c on c.id = l.expense_category_id
    where l.purchase_id = p_purchase_id order by l.landed_total desc limit 1;
  elsif v_kinds = array['EQUIPMENT'] then
    v_category_code := '7.1';
  else
    v_category_code := '7.2';
  end if;
  select s.name into v_supplier from public.suppliers s where s.id = v_purchase.supplier_id;
  v_label := v_purchase.number || coalesce(' — ' || v_supplier, '');

  v_payable_id := private.create_title('PAGAR', v_purchase.supplier_id, 'purchase', v_purchase.id, 'Compra ' || v_label,
    v_category_code, v_purchase.purchased_at, v_purchase.cash_price_total, v_installments, v_purchase.payer,
    v_purchase.owner_funding_type, v_purchase.interest_unknown, v_purchase.payment_account_id);

  -- Despesas da compra entram no DRE na data da compra (competência).
  for v_line in
    select l.*, i.kind as item_kind, i.is_stock_tracked, c.code as expense_code
    from public.purchase_lines l
    left join public.items i on i.id = l.item_id
    left join public.financial_categories c on c.id = l.expense_category_id
    where l.purchase_id = p_purchase_id order by l.sort_order
  loop
    if v_line.line_kind = 'EXPENSE' then
      perform private.post_result(v_purchase.purchased_at, v_line.expense_code, -v_line.landed_total, 'purchase', v_purchase.id,
        v_line.description || ' — ' || v_label);
    elsif v_line.line_kind = 'ITEM' and v_line.item_kind = 'TOOL' then
      perform private.post_result(v_purchase.purchased_at, '4.6', -v_line.landed_total, 'purchase', v_purchase.id,
        v_line.description || ' — ' || v_label, null, v_line.item_id);
    elsif v_line.line_kind = 'ITEM' and not v_line.is_stock_tracked then
      perform private.post_result(v_purchase.purchased_at, '4.7', -v_line.landed_total, 'purchase', v_purchase.id,
        v_line.description || ' — ' || v_label, null, v_line.item_id);
    end if;
  end loop;

  update public.purchases
     set status = case when v_only_expense or not exists (
               select 1 from public.purchase_lines l left join public.items i on i.id = l.item_id
               where l.purchase_id = p_purchase_id and (l.line_kind = 'EQUIPMENT' or (l.line_kind = 'ITEM' and i.is_stock_tracked)))
             then 'RECEBIDA' else 'CONFIRMADA' end,
         confirmed_at = now(), payable_id = v_payable_id,
         installments_total = v_installments_total,
         interest_total = v_installments_total - v_purchase.cash_price_total
   where id = p_purchase_id;

  -- À vista: paga na hora pela conta escolhida. Compra antiga: baixa as parcelas já pagas.
  for v_inst in select i.* from public.installments i where i.payable_id = v_payable_id order by i.number loop
    if v_purchase.payment_method in ('PIX', 'DINHEIRO', 'DEBITO') or (v_purchase.is_opening and v_paid < coalesce(p_paid_count, 0)) then
      if v_purchase.payer = 'EMPRESA' and v_purchase.payment_account_id is null then
        raise exception 'Informe de qual conta da empresa saiu o pagamento.' using errcode = '22023';
      end if;
      perform private.settle_payable_installment(v_inst.id, v_inst.due_date, null,
        case when v_purchase.payment_method in ('PIX', 'DINHEIRO', 'DEBITO') or v_purchase.payer = 'DONO' then v_purchase.payment_account_id end,
        v_purchase.payer, 'DESCONTO', null);
      v_paid := v_paid + 1;
    end if;
  end loop;
  perform private.audit('UPDATE', 'purchase', v_purchase.id, v_purchase.number, 'Compra confirmada',
    jsonb_build_object('total', v_installments_total, 'juros', v_installments_total - v_purchase.cash_price_total, 'pagador', v_purchase.payer));
  return jsonb_build_object('purchase_id', v_purchase.id, 'payable_id', v_payable_id, 'paid_installments', v_paid);
end;
$$;

-- Recebimento (US-3.5). p_lines: [{line_id, qty, spools: [g, g…] (filamento), equipment: {...}}];
-- null = recebe tudo o que falta. Compra anterior ao sistema: a quantidade é o saldo que resta hoje
-- e a linha fica totalmente recebida.
create function private.receive_purchase_core(p_purchase_id bigint, p_lines jsonb, p_received_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
  v_receipt_id bigint;
  v_req jsonb;
  v_line record;
  v_qty numeric;
  v_pending numeric;
  v_spools jsonb;
  v_spool jsonb;
  v_count integer;
  v_each numeric;
  v_rest numeric;
  v_mv public.stock_movements;
  v_movements bigint[];
  v_lots text[];
  v_equipment_ids bigint[];
  v_equipment_id bigint;
  v_details jsonb;
  v_type text;
  v_cost numeric;
  v_at timestamptz := coalesce(p_received_at, now());
  v_any boolean := false;
  v_requests jsonb := p_lines;
  v_nominal integer;
  v_lot_code text;
begin
  select * into v_purchase from public.purchases p where p.id = p_purchase_id for update;
  if v_purchase.id is null then
    raise exception 'Compra não encontrada.' using errcode = '22023';
  end if;
  if v_purchase.status not in ('CONFIRMADA', 'RECEBIDA_PARCIAL') then
    raise exception 'Só compras confirmadas e ainda não recebidas podem ser recebidas.' using errcode = '22023';
  end if;
  if v_requests is null or jsonb_array_length(v_requests) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'qty', l.qty - l.qty_received)), '[]'::jsonb) into v_requests
    from public.purchase_lines l left join public.items i on i.id = l.item_id
    where l.purchase_id = p_purchase_id and l.qty > l.qty_received
      and (l.line_kind = 'EQUIPMENT' or (l.line_kind = 'ITEM' and i.is_stock_tracked));
  end if;
  v_type := case when v_purchase.is_opening then 'OPENING' else 'PURCHASE_RECEIPT' end;

  insert into public.receipts (purchase_id, received_at) values (p_purchase_id, v_at) returning id into v_receipt_id;

  for v_req in select * from jsonb_array_elements(v_requests) loop
    select l.*, i.kind as item_kind, i.is_stock_tracked, i.name as item_name
      into v_line
    from public.purchase_lines l left join public.items i on i.id = l.item_id
    where l.id = (v_req ->> 'line_id')::bigint and l.purchase_id = p_purchase_id
    for update of l;
    if v_line.id is null then
      raise exception 'Linha de compra inválida.' using errcode = '22023';
    end if;
    if v_line.line_kind = 'EXPENSE' or (v_line.line_kind = 'ITEM' and not v_line.is_stock_tracked) then
      continue; -- despesas e itens sem controle de saldo não passam por recebimento
    end if;
    v_pending := v_line.qty - v_line.qty_received;
    v_qty := round(coalesce(nullif(v_req ->> 'qty', '')::numeric, v_pending), 3);
    v_movements := '{}';
    v_lots := '{}';
    v_equipment_ids := '{}';
    v_count := null;
    if v_qty <= 0 then
      continue;
    end if;
    if v_qty > v_pending and not v_purchase.is_opening then
      raise exception 'A linha "%" tem só % pendente(s) de recebimento.', v_line.description, private.fmt_num(v_pending) using errcode = '22023';
    end if;

    if v_line.line_kind = 'EQUIPMENT' then
      v_details := coalesce(v_req -> 'equipment', '{}'::jsonb);
      for i in 1..greatest(floor(v_qty)::integer, 1) loop
        v_equipment_id := public.save_equipment(jsonb_build_object(
          'name', coalesce(nullif(v_details ->> 'name', ''), v_line.description) || case when v_qty > 1 then ' ' || i else '' end,
          'kind', coalesce(nullif(v_details ->> 'kind', ''), 'PRINTER'),
          'brand', v_details ->> 'brand', 'model', v_details ->> 'model', 'serial', v_details ->> 'serial',
          'acquired_at', v_purchase.purchased_at,
          -- Valor do bem com frete rateado, sem juros (US-2.1).
          'acquisition_cost', round(v_line.landed_total / v_line.qty, 2),
          'residual_value', v_details ->> 'residual_value', 'useful_life_hours', v_details ->> 'useful_life_hours',
          'avg_power_w', v_details ->> 'avg_power_w', 'initial_hours', v_details ->> 'initial_hours',
          'maintenance_interval_hours', v_details ->> 'maintenance_interval_hours'));
        update public.equipment set purchase_line_id = v_line.id where id = v_equipment_id;
        v_equipment_ids := v_equipment_ids || v_equipment_id;
      end loop;
      update public.purchase_lines set equipment_id = v_equipment_ids[1], qty_received = least(qty, qty_received + v_qty) where id = v_line.id;
    else
      v_cost := case when v_line.item_kind = 'TOOL' then 0 else v_line.landed_unit_cost end;
      if v_line.item_kind = 'FILAMENT' then
        -- N carretéis viram N lotes (US-3.5).
        v_spools := v_req -> 'spools';
        if v_spools is null or jsonb_array_length(v_spools) = 0 then
          select coalesce(f.nominal_spool_g, 1000) into v_nominal from public.filament_specs f where f.item_id = v_line.item_id;
          v_count := greatest(coalesce(nullif(v_req ->> 'spool_count', '')::integer, round(v_qty / coalesce(v_nominal, 1000))::integer), 1);
          v_each := round(v_qty / v_count, 3);
          v_rest := v_qty - v_each * (v_count - 1);
          v_spools := '[]'::jsonb;
          for i in 1..v_count loop
            v_spools := v_spools || to_jsonb(case when i = v_count then v_rest else v_each end);
          end loop;
        end if;
        v_count := jsonb_array_length(v_spools);
        v_qty := 0;
        for v_spool in select * from jsonb_array_elements(v_spools) loop
          if (v_spool #>> '{}')::numeric > 0 then
            v_mv := private.receive_stock(v_line.item_id, (v_spool #>> '{}')::numeric, v_type, v_at,
              row(v_cost, 0, 0, 0, 0)::private.cost_layers, 'purchase', v_purchase.id, null, false);
            v_movements := v_movements || v_mv.id;
            select l.lot_code into v_lot_code from public.stock_lots l where l.id = v_mv.lot_id;
            v_lots := v_lots || v_lot_code;
            v_qty := v_qty + (v_spool #>> '{}')::numeric;
          end if;
        end loop;
      else
        v_mv := private.receive_stock(v_line.item_id, v_qty, v_type, v_at, row(v_cost, 0, 0, 0, 0)::private.cost_layers,
                                      'purchase', v_purchase.id, null, false);
        v_movements := array[v_mv.id];
      end if;
      update public.purchase_lines
         set qty_received = case when v_purchase.is_opening then qty else least(qty, qty_received + v_qty) end
       where id = v_line.id;
    end if;
    insert into public.receipt_lines (receipt_id, purchase_line_id, qty, stock_qty, spool_count, lot_codes, movement_ids, equipment_ids)
    values (v_receipt_id, v_line.id, case when v_line.line_kind = 'EQUIPMENT' then v_qty else greatest(v_qty, 0.001) end, v_qty,
            v_count, v_lots, v_movements, v_equipment_ids);
    v_any := true;
  end loop;

  if not v_any then
    raise exception 'Nada a receber nesta compra.' using errcode = '22023';
  end if;
  update public.purchases p
     set status = case when exists (
           select 1 from public.purchase_lines l left join public.items i on i.id = l.item_id
           where l.purchase_id = p.id and l.qty_received < l.qty
             and (l.line_kind = 'EQUIPMENT' or (l.line_kind = 'ITEM' and i.is_stock_tracked)))
         then 'RECEBIDA_PARCIAL' else 'RECEBIDA' end
   where p.id = p_purchase_id;
  perform private.audit('UPDATE', 'purchase', v_purchase.id, v_purchase.number, 'Recebimento registrado', jsonb_build_object('recebimento', v_receipt_id));
  return jsonb_build_object('receipt_id', v_receipt_id, 'purchase_id', p_purchase_id);
end;
$$;

create function public.confirm_purchase(p_request_id uuid, p_purchase_id bigint, p_paid_count integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'confirm_purchase');
  if v_done is not null then
    return v_done;
  end if;
  return private.idem_finish(p_request_id, private.confirm_purchase_core(p_purchase_id, p_paid_count));
end;
$$;

create function public.receive_purchase(p_request_id uuid, p_purchase_id bigint, p_lines jsonb default null, p_received_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'receive_purchase');
  if v_done is not null then
    return v_done;
  end if;
  return private.idem_finish(p_request_id, private.receive_purchase_core(p_purchase_id, p_lines, p_received_at));
end;
$$;

-- "Confirmar e receber": quando a compra chega junto, os dois serviços numa única transação.
create function public.confirm_and_receive_purchase(
  p_request_id uuid,
  p_purchase_id bigint,
  p_lines jsonb default null,
  p_received_at timestamptz default null,
  p_paid_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_confirm jsonb;
  v_receive jsonb := null;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'confirm_and_receive_purchase');
  if v_done is not null then
    return v_done;
  end if;
  v_confirm := private.confirm_purchase_core(p_purchase_id, p_paid_count);
  if exists (select 1 from public.purchases p where p.id = p_purchase_id and p.status = 'CONFIRMADA') then
    v_receive := private.receive_purchase_core(p_purchase_id, p_lines, p_received_at);
  end if;
  return private.idem_finish(p_request_id, v_confirm || coalesce(v_receive, '{}'::jsonb));
end;
$$;

-- Estorno de um recebimento: bloqueado se o material já foi consumido ou o equipamento usado.
create function public.reverse_receipt(p_request_id uuid, p_receipt_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_receipt public.receipts;
  v_rl public.receipt_lines;
  v_mv public.stock_movements;
  v_id bigint;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_operation uuid := gen_random_uuid();
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'reverse_receipt');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  select * into v_receipt from public.receipts r where r.id = p_receipt_id for update;
  if v_receipt.id is null or v_receipt.reversed_at is not null then
    raise exception 'Recebimento não encontrado ou já estornado.' using errcode = '22023';
  end if;
  perform 1 from public.purchases p where p.id = v_receipt.purchase_id for update;
  for v_rl in select * from public.receipt_lines l where l.receipt_id = p_receipt_id loop
    foreach v_id in array v_rl.movement_ids loop
      select * into v_mv from public.stock_movements m where m.id = v_id;
      if v_mv.lot_id is not null and exists (select 1 from public.stock_lots l where l.id = v_mv.lot_id and l.qty_remaining < v_mv.qty) then
        raise exception 'O carretel % já foi usado: estorne antes as impressões que o consumiram.',
          (select l.lot_code from public.stock_lots l where l.id = v_mv.lot_id) using errcode = '22023';
      end if;
      perform private.post_movement(v_mv.item_id, 'REVERSAL', -v_mv.qty, now(),
        row(v_mv.unit_cost_material, v_mv.unit_cost_energy, v_mv.unit_cost_depreciation, v_mv.unit_cost_operational, v_mv.unit_cost_labor)::private.cost_layers,
        v_mv.lot_id, 'purchase', v_receipt.purchase_id, v_reason, v_mv.id, 0, v_operation);
      if v_mv.lot_id is not null then
        update public.stock_lots set status = 'DESCARTADO' where id = v_mv.lot_id and qty_remaining = 0;
      end if;
    end loop;
    foreach v_id in array v_rl.equipment_ids loop
      if to_regclass('public.print_jobs') is not null and exists (
        select 1 from public.print_jobs j where j.equipment_id = v_id and j.status <> 'CANCELADA') then
        raise exception 'O equipamento já foi usado em impressões e não pode ter o recebimento estornado.' using errcode = '22023';
      end if;
      update public.equipment set status = 'BAIXADO', disposed_at = private.today(), notes = left(coalesce(notes || ' · ', '') || 'Recebimento estornado: ' || v_reason, 1000)
       where id = v_id;
    end loop;
    update public.purchase_lines l
       set qty_received = greatest(0, l.qty_received - case when (select p.is_opening from public.purchases p where p.id = l.purchase_id) then l.qty else v_rl.qty end),
           equipment_id = case when cardinality(v_rl.equipment_ids) > 0 then null else l.equipment_id end
     where l.id = v_rl.purchase_line_id;
  end loop;
  update public.receipts set reversed_at = now(), reverse_reason = v_reason where id = p_receipt_id;
  update public.purchases p
     set status = case when exists (select 1 from public.purchase_lines l where l.purchase_id = p.id and l.qty_received > 0)
                       then 'RECEBIDA_PARCIAL' else 'CONFIRMADA' end
   where p.id = v_receipt.purchase_id;
  perform private.audit('REVERSE', 'receipt', p_receipt_id, null, 'Recebimento estornado: ' || v_reason, '{}'::jsonb);
  return private.idem_finish(p_request_id, jsonb_build_object('receipt_id', p_receipt_id));
end;
$$;

-- Cancelamento (US-3.8): sem recebimento ativo; parcelas abertas canceladas; o que já foi pago
-- vira conta a receber de reembolso do fornecedor.
create function public.cancel_purchase(p_request_id uuid, p_purchase_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_purchase public.purchases;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_paid numeric;
  v_refund_id bigint;
  v_receipts text;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'cancel_purchase');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;
  select * into v_purchase from public.purchases p where p.id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.status = 'CANCELADA' then
    raise exception 'Compra não encontrada ou já cancelada.' using errcode = '22023';
  end if;
  select string_agg('#' || r.id || ' de ' || to_char(r.received_at, 'DD/MM/YYYY'), ', ') into v_receipts
  from public.receipts r where r.purchase_id = p_purchase_id and r.reversed_at is null;
  if v_receipts is not null then
    raise exception 'Estorne antes os recebimentos desta compra: %.', v_receipts using errcode = '22023', hint = 'estornar_recebimentos';
  end if;
  if v_purchase.payable_id is not null then
    select coalesce(sum(i.paid_amount), 0) into v_paid from public.installments i where i.payable_id = v_purchase.payable_id and i.status = 'PAGA';
    perform private.cancel_open_installments(v_purchase.payable_id, null, v_reason);
    update public.payables set status = case when v_paid > 0 then status else 'CANCELADO' end, canceled_at = now(), cancel_reason = v_reason
     where id = v_purchase.payable_id;
    if v_paid > 0 then
      v_refund_id := private.create_title('RECEBER', null, 'purchase_refund', v_purchase.id, 'Reembolso da compra ' || v_purchase.number,
        '7.2', private.today(), v_paid, jsonb_build_array(jsonb_build_object('due_date', private.today() + 30, 'amount', v_paid)));
    end if;
  end if;
  perform private.reverse_results('purchase', v_purchase.id, v_reason);
  update public.purchases set status = 'CANCELADA', canceled_at = now(), cancel_reason = v_reason where id = p_purchase_id;
  perform private.audit('CANCEL', 'purchase', v_purchase.id, v_purchase.number, 'Compra cancelada: ' || v_reason,
                        jsonb_build_object('reembolso_a_receber', v_paid));
  return private.idem_finish(p_request_id, jsonb_build_object('purchase_id', p_purchase_id, 'refund_receivable_id', v_refund_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_lines enable row level security;

create policy purchases_select on public.purchases for select to authenticated using (private.can_view_costs());
create policy purchase_lines_select on public.purchase_lines for select to authenticated using (private.can_view_costs());
create policy receipts_select on public.receipts for select to authenticated using (private.can_view_costs());
create policy receipt_lines_select on public.receipt_lines for select to authenticated using (private.can_view_costs());

select private.apply_grants();
