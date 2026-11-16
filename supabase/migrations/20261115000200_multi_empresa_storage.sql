-- =============================================================================
-- Wabee — Multi-empresa: fotos por pasta de empresa
--
-- Caminho novo: {company_id}/{products|items|quotes}/{arquivo}. As políticas do Storage
-- só deixam enviar, trocar e remover arquivos da pasta de uma empresa da qual o usuário é
-- membro. O bucket segue público (decisão do produto): quem tiver o link vê a imagem, mas o
-- link tem um UUID e não dá para adivinhar nem listar de outra empresa.
-- =============================================================================

-- Arquivos e caminhos que já existem (todos da primeira empresa) ganham o prefixo da empresa.
do $$
declare
  v_company text := (select c.id::text from public.companies c order by c.created_at limit 1);
  v_uuid_prefix text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';
begin
  update storage.objects set name = v_company || '/' || name
   where bucket_id = 'product-photos' and name !~ v_uuid_prefix;

  -- Sem gatilhos de auditoria: é correção de caminho feita pela migration, não ação de usuário.
  alter table public.products disable trigger user;
  alter table public.items disable trigger user;
  alter table public.quote_requests disable trigger user;

  update public.products set photo_path = v_company || '/' || photo_path
   where photo_path is not null and photo_path !~ v_uuid_prefix;
  update public.items set photo_path = v_company || '/' || photo_path
   where photo_path is not null and photo_path !~ v_uuid_prefix;
  update public.quote_requests q
     set reference_photo_paths = (select coalesce(array_agg(case when x ~ v_uuid_prefix then x else v_company || '/' || x end), '{}') from unnest(q.reference_photo_paths) x),
         proposal_photo_paths = (select coalesce(array_agg(case when x ~ v_uuid_prefix then x else v_company || '/' || x end), '{}') from unnest(q.proposal_photo_paths) x)
   where cardinality(q.reference_photo_paths) > 0 or cardinality(q.proposal_photo_paths) > 0;

  alter table public.products enable trigger user;
  alter table public.items enable trigger user;
  alter table public.quote_requests enable trigger user;
end;
$$;

drop policy product_photos_read on storage.objects;
drop policy product_photos_insert on storage.objects;
drop policy product_photos_update on storage.objects;
drop policy product_photos_delete on storage.objects;

-- A primeira pasta do caminho é a empresa; a segunda, o tipo da foto.
create policy product_photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'product-photos'
    and private.is_company_member(case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then (storage.foldername(name))[1]::uuid end)
  );
create policy product_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-photos'
    and private.is_company_member(case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then (storage.foldername(name))[1]::uuid end)
    and (storage.foldername(name))[2] in ('products', 'items', 'quotes')
  );
create policy product_photos_update on storage.objects for update to authenticated
  using (
    bucket_id = 'product-photos'
    and private.is_company_member(case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then (storage.foldername(name))[1]::uuid end)
  )
  with check (
    bucket_id = 'product-photos'
    and private.is_company_member(case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then (storage.foldername(name))[1]::uuid end)
    and (storage.foldername(name))[2] in ('products', 'items', 'quotes')
  );
create policy product_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-photos'
    and private.is_company_member(case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then (storage.foldername(name))[1]::uuid end)
  );

-- Os caminhos gravados pelas RPCs precisam começar pela empresa ativa.
create or replace function public.set_product_photo(p_product_id bigint, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  perform private.assert_owner();
  if v_path is not null and v_path !~ ('^' || private.company_id()::text || '/products/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'Caminho de foto inválido.' using errcode = '22023';
  end if;
  update public.products set photo_path = v_path where id = p_product_id;
  if not found then
    raise exception 'Produto não encontrado.' using errcode = '22023';
  end if;
  -- O produto pronto em estoque (item de cada variação) mostra a foto do produto.
  update public.items i set photo_path = v_path
   where i.id in (select v.item_id from public.product_variants v where v.product_id = p_product_id);
end;
$$;

create or replace function public.set_item_photo(p_item_id bigint, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  perform private.assert_owner();
  if v_path is not null and v_path !~ ('^' || private.company_id()::text || '/items/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'Caminho de foto inválido.' using errcode = '22023';
  end if;
  update public.items set photo_path = v_path where id = p_item_id;
  if not found then
    raise exception 'Item não encontrado.' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.quote_photo_paths(p_paths jsonb)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_paths text[];
  v_path text;
  v_pattern text := '^' || private.company_id()::text || '/quotes/[A-Za-z0-9._-]{1,120}$';
begin
  if p_paths is null or jsonb_typeof(p_paths) <> 'array' then
    return '{}';
  end if;
  select coalesce(array_agg(x), '{}') into v_paths from jsonb_array_elements_text(p_paths) x;
  if cardinality(v_paths) > 3 then
    raise exception 'Anexe no máximo 3 fotos de referência.' using errcode = '22023';
  end if;
  foreach v_path in array v_paths loop
    if v_path !~ v_pattern then
      raise exception 'Caminho de foto inválido.' using errcode = '22023';
    end if;
  end loop;
  return v_paths;
end;
$$;

select private.apply_grants();
