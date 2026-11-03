-- =============================================================================
-- Orçamentos: anotar o pedido de orçamento como um questionário, analisar (ficha, custo e
-- preço), enviar a proposta e, se aceita, virar pedido. Quem não responde continua na lista
-- com a data do próximo retorno, para o dono ir atrás de novo.
--
--   NOVO -> EM_ANALISE -> PROPOSTA_ENVIADA -> GANHO (virou pedido) | PERDIDO (com motivo)
--
-- O produto pontual só é criado quando o cliente aceita (create_custom_item, na hora de virar
-- pedido): com 9 em 10 desistindo, a ficha fica guardada no orçamento (analysis) e não no catálogo.
-- Também entram aqui a chave PIX (texto da proposta) e o intervalo padrão de retorno.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configurações: PIX para a proposta e dias até o próximo retorno
-- -----------------------------------------------------------------------------

alter table public.settings
  add column pix_key text check (pix_key is null or char_length(pix_key) <= 140),
  add column pix_key_type text not null default 'EMAIL' check (pix_key_type in ('EMAIL', 'TELEFONE', 'CPF_CNPJ', 'ALEATORIA')),
  add column pix_holder text check (pix_holder is null or char_length(pix_holder) <= 100),
  add column quote_followup_days integer not null default 7 check (quote_followup_days between 1 and 90);

comment on column public.settings.pix_key is 'Chave PIX que vai no texto da proposta enviada ao cliente.';
comment on column public.settings.quote_followup_days is 'Dias até o próximo retorno de um orçamento sem resposta.';

update public.settings set pix_key = 'storewabee@gmail.com', pix_key_type = 'EMAIL' where pix_key is null;

create or replace function public.save_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  update public.settings s
     set company_name = coalesce(nullif(btrim(p_settings ->> 'company_name'), ''), s.company_name),
         timezone = coalesce(nullif(p_settings ->> 'timezone', ''), s.timezone),
         allow_negative_stock = coalesce((p_settings ->> 'allow_negative_stock')::boolean, s.allow_negative_stock),
         absorb_scrap_cost = coalesce((p_settings ->> 'absorb_scrap_cost')::boolean, s.absorb_scrap_cost),
         default_owner_funding_type = coalesce(nullif(p_settings ->> 'default_owner_funding_type', ''), s.default_owner_funding_type),
         default_channel_id = coalesce(nullif(p_settings ->> 'default_channel_id', '')::bigint, s.default_channel_id),
         margin_target_pct = coalesce(nullif(p_settings ->> 'margin_target_pct', '')::numeric, s.margin_target_pct),
         tax_regime = coalesce(nullif(p_settings ->> 'tax_regime', ''), s.tax_regime),
         sales_tax_pct = coalesce(nullif(p_settings ->> 'sales_tax_pct', '')::numeric, s.sales_tax_pct),
         mei_monthly_das = coalesce(nullif(p_settings ->> 'mei_monthly_das', '')::numeric, s.mei_monthly_das),
         coverage_alert_days = coalesce(nullif(p_settings ->> 'coverage_alert_days', '')::integer, s.coverage_alert_days),
         go_live_date = case when p_settings ? 'go_live_date' then nullif(p_settings ->> 'go_live_date', '')::date else s.go_live_date end,
         filament_reference_cost_g = coalesce(nullif(p_settings ->> 'filament_reference_cost_g', '')::numeric, s.filament_reference_cost_g),
         default_order_packaging_item_id = case when p_settings ? 'default_order_packaging_item_id'
           then nullif(p_settings ->> 'default_order_packaging_item_id', '')::bigint else s.default_order_packaging_item_id end,
         monthly_fixed_expenses = case when p_settings ? 'monthly_fixed_expenses'
           then nullif(p_settings ->> 'monthly_fixed_expenses', '')::numeric else s.monthly_fixed_expenses end,
         monthly_profit_target = coalesce(nullif(p_settings ->> 'monthly_profit_target', '')::numeric, s.monthly_profit_target),
         printer_hours_per_day = coalesce(nullif(p_settings ->> 'printer_hours_per_day', '')::numeric, s.printer_hours_per_day),
         cash_reserve_months = coalesce(nullif(p_settings ->> 'cash_reserve_months', '')::numeric, s.cash_reserve_months),
         pix_key = case when p_settings ? 'pix_key' then nullif(btrim(p_settings ->> 'pix_key'), '') else s.pix_key end,
         pix_key_type = coalesce(nullif(p_settings ->> 'pix_key_type', ''), s.pix_key_type),
         pix_holder = case when p_settings ? 'pix_holder' then nullif(btrim(p_settings ->> 'pix_holder'), '') else s.pix_holder end,
         quote_followup_days = coalesce(nullif(p_settings ->> 'quote_followup_days', '')::integer, s.quote_followup_days)
   where s.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table public.quote_requests (
  id bigint generated always as identity primary key,
  number text not null unique,
  status text not null default 'NOVO' check (status in ('NOVO', 'EM_ANALISE', 'PROPOSTA_ENVIADA', 'GANHO', 'PERDIDO')),
  source text check (source is null or source in ('WHATSAPP', 'INSTAGRAM', 'PRESENCIAL', 'FEIRA', 'INDICACAO', 'OUTRO')),
  -- Questionário: só o "que" é obrigatório; quem pediu pode nem ser cliente cadastrado.
  customer_id bigint references public.customers (id),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 30),
  contact_instagram text check (contact_instagram is null or char_length(contact_instagram) <= 60),
  item_wanted text not null check (char_length(btrim(item_wanted)) between 1 and 200),
  size_text text check (size_text is null or char_length(size_text) <= 100),
  color_text text check (color_text is null or char_length(color_text) <= 100),
  qty integer not null default 1 check (qty > 0 and qty <= 100000),
  desired_date date,
  notes text check (notes is null or char_length(notes) <= 2000),
  reference_links text check (reference_links is null or char_length(reference_links) <= 1000),
  reference_photo_paths text[] not null default '{}' check (cardinality(reference_photo_paths) <= 3),
  -- Análise (ficha simplificada no formato de preview_custom_item) e proposta.
  analysis jsonb,
  cost_estimate jsonb,
  proposal_description text check (proposal_description is null or char_length(proposal_description) <= 2000),
  quoted_unit_price numeric(14,2) check (quoted_unit_price is null or quoted_unit_price >= 0),
  quoted_at timestamptz,
  valid_until date,
  -- Retomada
  follow_up_at date,
  follow_up_count integer not null default 0 check (follow_up_count >= 0),
  last_contact_at timestamptz,
  -- Fechamento
  lost_reason text check (lost_reason is null or lost_reason in ('PRECO', 'PRAZO', 'SUMIU', 'ACHOU_PRONTO', 'DESISTIU', 'OUTRO')),
  lost_note text check (lost_note is null or char_length(lost_note) <= 500),
  closed_at timestamptz,
  order_id bigint references public.sales_orders (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (status <> 'PERDIDO' or lost_reason is not null)
);

create index quote_requests_status_idx on public.quote_requests (status, follow_up_at);
create index quote_requests_customer_idx on public.quote_requests (customer_id);
create trigger quote_requests_touch before update on public.quote_requests for each row execute function private.touch_updated_at();
create trigger quote_requests_audit after insert or update on public.quote_requests for each row execute function private.audit_row('quote_request');

-- Linha do tempo: anotações, contatos, mudanças de status e propostas. Só inserção.
create table public.quote_events (
  id bigint generated always as identity primary key,
  quote_id bigint not null references public.quote_requests (id) on delete cascade,
  kind text not null check (kind in ('NOTA', 'CONTATO', 'STATUS', 'PRECO')),
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index quote_events_quote_idx on public.quote_events (quote_id, created_at);

alter table public.quote_requests enable row level security;
alter table public.quote_events enable row level security;
create policy quote_requests_select on public.quote_requests for select to authenticated using (private.can_view_costs());
create policy quote_events_select on public.quote_events for select to authenticated using (private.can_view_costs());

create view public.v_quotes with (security_invoker = true) as
select
  q.id, q.number, q.status, q.source, q.customer_id,
  coalesce(c.name, q.contact_name) as display_name,
  coalesce(nullif(q.contact_phone, ''), c.phone) as phone,
  coalesce(nullif(q.contact_instagram, ''), c.instagram) as instagram,
  q.contact_name, q.contact_phone, q.contact_instagram,
  q.item_wanted, q.size_text, q.color_text, q.qty, q.desired_date, q.notes, q.reference_links, q.reference_photo_paths,
  q.analysis, q.cost_estimate, q.proposal_description, q.quoted_unit_price, q.quoted_at, q.valid_until,
  case when q.quoted_unit_price is not null then round(q.quoted_unit_price * q.qty, 2) end as quoted_total,
  q.follow_up_at, q.follow_up_count, q.last_contact_at,
  (q.status in ('NOVO', 'EM_ANALISE', 'PROPOSTA_ENVIADA')) as is_open,
  (q.status in ('NOVO', 'EM_ANALISE', 'PROPOSTA_ENVIADA') and q.follow_up_at is not null and q.follow_up_at <= private.today()) as follow_up_due,
  floor(extract(epoch from (now() - q.created_at)) / 86400)::integer as age_days,
  q.lost_reason, q.lost_note, q.closed_at, q.order_id, o.number as order_number, q.created_at, q.updated_at
from public.quote_requests q
left join public.customers c on c.id = q.customer_id
left join public.sales_orders o on o.id = q.order_id;

-- -----------------------------------------------------------------------------
-- Funções internas
-- -----------------------------------------------------------------------------

create function private.quote_status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'NOVO' then 'Novo' when 'EM_ANALISE' then 'Em análise' when 'PROPOSTA_ENVIADA' then 'Proposta enviada'
    when 'GANHO' then 'Ganho' when 'PERDIDO' then 'Perdido' else p_status end;
$$;

create function private.quote_event(p_quote_id bigint, p_kind text, p_text text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.quote_events (quote_id, kind, text) values (p_quote_id, p_kind, left(p_text, 1000));
$$;

-- Dados de um orçamento em aberto (trava a linha); erro se não existe ou já foi encerrado.
create function private.open_quote(p_quote_id bigint)
returns public.quote_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_requests;
begin
  select * into v_quote from public.quote_requests q where q.id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'Orçamento não encontrado.' using errcode = '22023';
  end if;
  if v_quote.status in ('GANHO', 'PERDIDO') then
    raise exception 'Este orçamento já foi encerrado (%). Reabra para alterar.', private.quote_status_label(v_quote.status) using errcode = '22023';
  end if;
  return v_quote;
end;
$$;

create function private.quote_photo_paths(p_paths jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_paths text[];
  v_path text;
begin
  if p_paths is null or jsonb_typeof(p_paths) <> 'array' then
    return '{}';
  end if;
  select coalesce(array_agg(x), '{}') into v_paths from jsonb_array_elements_text(p_paths) x;
  if cardinality(v_paths) > 3 then
    raise exception 'Anexe no máximo 3 fotos de referência.' using errcode = '22023';
  end if;
  foreach v_path in array v_paths loop
    if v_path !~ '^quotes/[A-Za-z0-9._-]{1,120}$' then
      raise exception 'Caminho de foto inválido.' using errcode = '22023';
    end if;
  end loop;
  return v_paths;
end;
$$;

-- Chamada pela criação do pedido: o orçamento vira ganho e guarda o pedido (e o cliente, se faltava).
create function private.link_quote_order(p_quote_id bigint, p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_requests;
  v_order public.sales_orders;
begin
  select * into v_quote from public.quote_requests q where q.id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'Orçamento não encontrado.' using errcode = '22023';
  end if;
  if v_quote.order_id is not null then
    raise exception 'Este orçamento já virou o pedido %.', (select o.number from public.sales_orders o where o.id = v_quote.order_id) using errcode = '22023';
  end if;
  select * into v_order from public.sales_orders o where o.id = p_order_id;
  update public.quote_requests
     set status = 'GANHO', order_id = p_order_id, closed_at = now(), follow_up_at = null,
         lost_reason = null, lost_note = null, customer_id = coalesce(customer_id, v_order.customer_id)
   where id = p_quote_id;
  perform private.quote_event(p_quote_id, 'STATUS', 'Virou o pedido ' || v_order.number || '.');
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs públicas (todas do dono)
-- -----------------------------------------------------------------------------

-- p_quote: {id?, item_wanted, contact_name, contact_phone, contact_instagram, customer_id, source, size_text,
--           color_text, qty, desired_date, notes, reference_links, reference_photo_paths: [..]}
create function public.save_quote(p_quote jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_quote ->> 'id', '')::bigint;
  v_item text := btrim(coalesce(p_quote ->> 'item_wanted', ''));
  v_customer bigint := nullif(p_quote ->> 'customer_id', '')::bigint;
  v_qty integer := coalesce(nullif(p_quote ->> 'qty', '')::integer, 1);
  v_photos text[] := private.quote_photo_paths(p_quote -> 'reference_photo_paths');
begin
  perform private.assert_owner();
  if char_length(v_item) = 0 then
    raise exception 'Escreva o que a pessoa pediu.' using errcode = '22023';
  end if;
  if v_qty <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.' using errcode = '22023';
  end if;
  if v_customer is not null and not exists (select 1 from public.customers c where c.id = v_customer) then
    raise exception 'Cliente não encontrado.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.quote_requests (number, source, customer_id, contact_name, contact_phone, contact_instagram, item_wanted,
                                       size_text, color_text, qty, desired_date, notes, reference_links, reference_photo_paths)
    values (private.next_doc_number('ORC', private.local_date(now())), nullif(p_quote ->> 'source', ''), v_customer,
            nullif(btrim(coalesce(p_quote ->> 'contact_name', '')), ''), nullif(btrim(coalesce(p_quote ->> 'contact_phone', '')), ''),
            nullif(btrim(coalesce(p_quote ->> 'contact_instagram', '')), ''), v_item,
            nullif(btrim(coalesce(p_quote ->> 'size_text', '')), ''), nullif(btrim(coalesce(p_quote ->> 'color_text', '')), ''), v_qty,
            nullif(p_quote ->> 'desired_date', '')::date, nullif(btrim(coalesce(p_quote ->> 'notes', '')), ''),
            nullif(btrim(coalesce(p_quote ->> 'reference_links', '')), ''), v_photos)
    returning id into v_id;
    perform private.quote_event(v_id, 'NOTA', 'Orçamento anotado.');
    return v_id;
  end if;
  perform private.open_quote(v_id);
  update public.quote_requests
     set source = nullif(p_quote ->> 'source', ''), customer_id = v_customer,
         contact_name = nullif(btrim(coalesce(p_quote ->> 'contact_name', '')), ''),
         contact_phone = nullif(btrim(coalesce(p_quote ->> 'contact_phone', '')), ''),
         contact_instagram = nullif(btrim(coalesce(p_quote ->> 'contact_instagram', '')), ''),
         item_wanted = v_item, size_text = nullif(btrim(coalesce(p_quote ->> 'size_text', '')), ''),
         color_text = nullif(btrim(coalesce(p_quote ->> 'color_text', '')), ''), qty = v_qty,
         desired_date = nullif(p_quote ->> 'desired_date', '')::date, notes = nullif(btrim(coalesce(p_quote ->> 'notes', '')), ''),
         reference_links = nullif(btrim(coalesce(p_quote ->> 'reference_links', '')), ''), reference_photo_paths = v_photos
   where id = v_id;
  return v_id;
end;
$$;

-- Guarda a ficha simplificada (mesmo formato de preview_custom_item) e devolve custo e preço sugerido
-- por peça. Não cria produto. NOVO passa a EM_ANALISE.
create function public.analyze_quote(p_quote_id bigint, p_analysis jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_requests;
  v_analysis jsonb := coalesce(p_analysis, '{}'::jsonb);
  v_preview jsonb;
begin
  perform private.assert_owner();
  v_quote := private.open_quote(p_quote_id);
  if jsonb_typeof(v_analysis -> 'lines') is distinct from 'array' or jsonb_array_length(v_analysis -> 'lines') = 0 then
    -- Ficha ainda sem filamento: guarda o rascunho, sem cálculo.
    v_preview := null;
  else
    v_preview := public.preview_custom_item(v_analysis || jsonb_build_object('channel_id', coalesce(nullif(v_analysis ->> 'channel_id', ''), (private.settings()).default_channel_id::text)));
  end if;
  update public.quote_requests
     set analysis = v_analysis, cost_estimate = v_preview,
         status = case when status = 'NOVO' then 'EM_ANALISE' else status end
   where id = p_quote_id;
  if v_quote.status = 'NOVO' then
    perform private.quote_event(p_quote_id, 'STATUS', 'Em análise.');
  end if;
  return jsonb_build_object('preview', v_preview);
end;
$$;

-- Registra o preço por peça, a descrição e a validade, e agenda o primeiro retorno.
create function public.send_quote(p_quote_id bigint, p_unit_price numeric, p_valid_until date default null,
                                  p_description text default null, p_follow_up_at date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_requests;
begin
  perform private.assert_owner();
  v_quote := private.open_quote(p_quote_id);
  if p_unit_price is null or p_unit_price <= 0 then
    raise exception 'Informe o preço por peça.' using errcode = '22023';
  end if;
  if p_valid_until is not null and p_valid_until < private.today() then
    raise exception 'A validade da proposta já passou.' using errcode = '22023';
  end if;
  update public.quote_requests
     set status = 'PROPOSTA_ENVIADA', quoted_unit_price = round(p_unit_price, 2), quoted_at = now(), valid_until = p_valid_until,
         proposal_description = nullif(btrim(coalesce(p_description, '')), ''), last_contact_at = now(),
         follow_up_at = coalesce(p_follow_up_at, private.today() + (private.settings()).quote_followup_days)
   where id = p_quote_id;
  perform private.quote_event(p_quote_id, 'PRECO',
    'Proposta enviada: R$ ' || replace(to_char(round(p_unit_price, 2), 'FM999999990.00'), '.', ',') ||
    case when v_quote.qty > 1 then ' por peça (' || v_quote.qty || ' peças).' else '.' end);
end;
$$;

-- "Chamei": registra o contato e agenda o próximo retorno (padrão: configuração da empresa).
create function public.log_quote_contact(p_quote_id bigint, p_note text default null, p_next_follow_up date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_requests;
  v_next date;
begin
  perform private.assert_owner();
  v_quote := private.open_quote(p_quote_id);
  v_next := coalesce(p_next_follow_up, private.today() + (private.settings()).quote_followup_days);
  if v_next < private.today() then
    raise exception 'A data do próximo retorno não pode estar no passado.' using errcode = '22023';
  end if;
  update public.quote_requests
     set follow_up_count = follow_up_count + 1, last_contact_at = now(), follow_up_at = v_next
   where id = p_quote_id;
  perform private.quote_event(p_quote_id, 'CONTATO',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Contato feito.') || ' Próximo retorno em ' || to_char(v_next, 'DD/MM') || '.');
end;
$$;

-- Adia (ou define) o próximo retorno sem contar como contato.
create function public.set_quote_follow_up(p_quote_id bigint, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  perform private.open_quote(p_quote_id);
  if p_date is null or p_date < private.today() then
    raise exception 'Escolha uma data de hoje em diante.' using errcode = '22023';
  end if;
  update public.quote_requests set follow_up_at = p_date where id = p_quote_id;
  perform private.quote_event(p_quote_id, 'NOTA', 'Retorno marcado para ' || to_char(p_date, 'DD/MM') || '.');
end;
$$;

create function public.add_quote_note(p_quote_id bigint, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  if not exists (select 1 from public.quote_requests q where q.id = p_quote_id) then
    raise exception 'Orçamento não encontrado.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_text, ''))) = 0 then
    raise exception 'Escreva a anotação.' using errcode = '22023';
  end if;
  perform private.quote_event(p_quote_id, 'NOTA', btrim(p_text));
end;
$$;

-- Troca o status. Perder exige motivo; reabrir limpa o motivo. Virar pedido é feito ao criar o pedido.
create function public.set_quote_status(p_quote_id bigint, p_status text, p_reason text default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_requests;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.assert_owner();
  select * into v_quote from public.quote_requests q where q.id = p_quote_id for update;
  if v_quote.id is null then
    raise exception 'Orçamento não encontrado.' using errcode = '22023';
  end if;
  if p_status not in ('NOVO', 'EM_ANALISE', 'PROPOSTA_ENVIADA', 'GANHO', 'PERDIDO') then
    raise exception 'Status inválido.' using errcode = '22023';
  end if;
  if v_quote.order_id is not null then
    raise exception 'Este orçamento já virou pedido: o status acompanha o pedido.' using errcode = '22023';
  end if;
  if p_status = 'PERDIDO' then
    if v_reason is null or v_reason not in ('PRECO', 'PRAZO', 'SUMIU', 'ACHOU_PRONTO', 'DESISTIU', 'OUTRO') then
      raise exception 'Escolha o motivo da perda.' using errcode = '22023';
    end if;
    update public.quote_requests set status = 'PERDIDO', lost_reason = v_reason, lost_note = v_note, closed_at = now(), follow_up_at = null
     where id = p_quote_id;
  elsif p_status = 'GANHO' then
    update public.quote_requests set status = 'GANHO', lost_reason = null, lost_note = null, closed_at = now(), follow_up_at = null
     where id = p_quote_id;
  else
    if p_status = 'PROPOSTA_ENVIADA' and v_quote.quoted_unit_price is null then
      raise exception 'Informe o preço antes de marcar a proposta como enviada.' using errcode = '22023';
    end if;
    update public.quote_requests
       set status = p_status, lost_reason = null, lost_note = null, closed_at = null,
           follow_up_at = case when p_status = 'PROPOSTA_ENVIADA' then coalesce(follow_up_at, private.today() + (private.settings()).quote_followup_days)
                               else follow_up_at end
     where id = p_quote_id;
  end if;
  perform private.quote_event(p_quote_id, 'STATUS',
    private.quote_status_label(v_quote.status) || ' → ' || private.quote_status_label(p_status) ||
    case when v_reason is not null and p_status = 'PERDIDO' then ' (' || v_reason || ')' else '' end ||
    case when v_note is not null then '. ' || v_note else '.' end);
end;
$$;

-- Pedido (US-6.4) com vínculo ao orçamento: p_order pode trazer quote_id.
create or replace function public.create_order(p_request_id uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_id bigint;
  v_result jsonb;
  v_quote bigint := nullif(p_order ->> 'quote_id', '')::bigint;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'create_order');
  if v_done is not null then
    return v_done;
  end if;
  v_id := private.create_order_core(p_order, coalesce(nullif(p_order ->> 'kind', ''), 'ENCOMENDA'));
  if v_quote is not null then
    perform private.link_quote_order(v_quote, v_id);
  end if;
  if coalesce((p_order ->> 'confirm')::boolean, false) then
    v_result := private.confirm_order_core(v_id);
  else
    v_result := jsonb_build_object('order_id', v_id, 'number', (select o.number from public.sales_orders o where o.id = v_id), 'status', 'RASCUNHO');
    perform private.audit('CREATE', 'sales_order', v_id, v_result ->> 'number', 'Pedido criado (rascunho)', '{}'::jsonb);
  end if;
  return private.idem_finish(p_request_id, v_result);
end;
$$;

-- -----------------------------------------------------------------------------
-- Reset do sistema: os orçamentos entram na lista (referenciam pedidos que são apagados)
-- -----------------------------------------------------------------------------

create or replace function public.reset_system(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  if p_confirm is distinct from 'APAGAR TUDO' then
    raise exception 'Digite APAGAR TUDO para confirmar o reset.' using errcode = '22023';
  end if;

  update public.equipment set purchase_line_id = null where purchase_line_id is not null;
  update public.settings
     set onboarding_state = '{}'::jsonb, go_live_date = null, default_order_packaging_item_id = null
   where id;
  alter table public.equipment drop constraint equipment_purchase_line_fk;
  alter table public.settings drop constraint settings_default_packaging_fk;

  truncate table
    -- produtos e itens
    public.channel_prices, public.bom_lines, public.bom_versions, public.product_variants, public.products,
    public.tool_specs, public.filament_specs, public.items,
    -- estoque
    public.stock_balances, public.stock_movements, public.stock_lots,
    -- compras
    public.receipt_lines, public.receipts, public.purchase_lines, public.purchases,
    -- produção e equipamentos
    public.post_process_entries, public.print_job_materials, public.print_job_outputs, public.print_jobs,
    public.maintenance_logs,
    -- vendas e orçamentos
    public.quote_events, public.quote_requests,
    public.reservations, public.order_packaging, public.delivery_lines, public.deliveries,
    public.sales_order_lines, public.sales_orders,
    -- financeiro
    public.installments, public.payables, public.receivables, public.owner_movements,
    public.cash_transactions, public.result_entries, public.month_closes,
    -- controle
    public.doc_sequences, public.idempotency_keys, public.audit_logs
  restart identity;

  alter table public.equipment
    add constraint equipment_purchase_line_fk foreign key (purchase_line_id) references public.purchase_lines (id);
  alter table public.settings
    add constraint settings_default_packaging_fk foreign key (default_order_packaging_item_id) references public.items (id);

  perform private.audit('DELETE', 'system', null, 'reset',
    'Reset do sistema: operação, orçamentos, produtos e itens apagados; configurações e cadastros base mantidos.');
  return jsonb_build_object('ok', true);
end;
$$;

select private.apply_grants();
