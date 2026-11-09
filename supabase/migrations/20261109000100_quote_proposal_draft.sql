-- =============================================================================
-- Orçamentos: salvar o valor da venda combinado sem precisar "enviar" a proposta, e anexar até
-- 3 imagens da proposta (o que vai junto da mensagem do WhatsApp). As fotos de referência
-- continuam sendo as que o cliente mandou; estas são as que o dono manda de volta.
-- =============================================================================

alter table public.quote_requests
  add column proposal_photo_paths text[] not null default '{}' check (cardinality(proposal_photo_paths) <= 3);

comment on column public.quote_requests.proposal_photo_paths is 'Até 3 imagens que acompanham a proposta enviada ao cliente (pasta quotes/ do bucket).';

-- Mesma view, com a coluna nova no fim (create or replace só aceita colunas novas ao final).
create or replace view public.v_quotes with (security_invoker = true) as
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
  q.lost_reason, q.lost_note, q.closed_at, q.order_id, o.number as order_number, q.created_at, q.updated_at,
  q.proposal_photo_paths
from public.quote_requests q
left join public.customers c on c.id = q.customer_id
left join public.sales_orders o on o.id = q.order_id;

-- Guarda o valor combinado, a validade, a descrição e as imagens da proposta sem enviar nada:
-- não muda o status, não agenda retorno e não mexe na linha do tempo. Valor em branco limpa o valor.
create function public.save_quote_proposal(p_quote_id bigint, p_unit_price numeric default null, p_valid_until date default null,
                                           p_description text default null, p_photo_paths jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_requests;
  v_photos text[];
begin
  perform private.assert_owner();
  v_quote := private.open_quote(p_quote_id);
  if p_unit_price is not null and p_unit_price <= 0 then
    raise exception 'O valor combinado precisa ser maior que zero.' using errcode = '22023';
  end if;
  if p_valid_until is not null and p_valid_until < private.today() and p_valid_until is distinct from v_quote.valid_until then
    raise exception 'A validade da proposta já passou.' using errcode = '22023';
  end if;
  v_photos := case when p_photo_paths is null then v_quote.proposal_photo_paths else private.quote_photo_paths(p_photo_paths) end;
  update public.quote_requests
     set quoted_unit_price = round(p_unit_price, 2), valid_until = p_valid_until,
         proposal_description = nullif(btrim(coalesce(p_description, '')), ''), proposal_photo_paths = v_photos
   where id = p_quote_id;
end;
$$;

-- send_quote ganha as imagens da proposta (null = mantém as atuais).
drop function public.send_quote(bigint, numeric, date, text, date);

create function public.send_quote(p_quote_id bigint, p_unit_price numeric, p_valid_until date default null,
                                  p_description text default null, p_follow_up_at date default null,
                                  p_photo_paths jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_requests;
  v_photos text[];
begin
  perform private.assert_owner();
  v_quote := private.open_quote(p_quote_id);
  if p_unit_price is null or p_unit_price <= 0 then
    raise exception 'Informe o preço por peça.' using errcode = '22023';
  end if;
  if p_valid_until is not null and p_valid_until < private.today() then
    raise exception 'A validade da proposta já passou.' using errcode = '22023';
  end if;
  v_photos := case when p_photo_paths is null then v_quote.proposal_photo_paths else private.quote_photo_paths(p_photo_paths) end;
  update public.quote_requests
     set status = 'PROPOSTA_ENVIADA', quoted_unit_price = round(p_unit_price, 2), quoted_at = now(), valid_until = p_valid_until,
         proposal_description = nullif(btrim(coalesce(p_description, '')), ''), proposal_photo_paths = v_photos, last_contact_at = now(),
         follow_up_at = coalesce(p_follow_up_at, private.today() + (private.settings()).quote_followup_days)
   where id = p_quote_id;
  perform private.quote_event(p_quote_id, 'PRECO',
    'Proposta enviada: R$ ' || replace(to_char(round(p_unit_price, 2), 'FM999999990.00'), '.', ',') ||
    case when v_quote.qty > 1 then ' por peça (' || v_quote.qty || ' peças).' else '.' end);
end;
$$;

select private.apply_grants();
