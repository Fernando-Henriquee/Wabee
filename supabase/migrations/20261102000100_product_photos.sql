-- =============================================================================
-- Fotos de produtos e itens. Bucket público (foto de produto não é segredo, evita
-- URL assinada em cada tela); só o dono envia, troca e remove arquivos.
-- products.photo_path e items.photo_path já existiam: guardam o caminho no bucket.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Pastas permitidas: products/ (produtos), items/ (itens de estoque) e quotes/ (referências de orçamento).
create policy product_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'product-photos');
create policy product_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and private.has_role(array['dono']) and (storage.foldername(name))[1] in ('products', 'items', 'quotes'));
create policy product_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'product-photos' and private.has_role(array['dono']))
  with check (bucket_id = 'product-photos' and private.has_role(array['dono']) and (storage.foldername(name))[1] in ('products', 'items', 'quotes'));
create policy product_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and private.has_role(array['dono']));

-- A foto é gravada depois do envio do arquivo. A auditoria sai dos gatilhos de products/items.
create function public.set_product_photo(p_product_id bigint, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  perform private.assert_owner();
  if v_path is not null and v_path !~ '^products/[A-Za-z0-9._-]{1,120}$' then
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

-- Variação criada depois da foto herda a foto do produto.
create function private.variant_inherits_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.items i set photo_path = p.photo_path
    from public.products p
   where p.id = new.product_id and i.id = new.item_id and p.photo_path is not null and i.photo_path is null;
  return new;
end;
$$;

create trigger product_variants_inherit_photo after insert on public.product_variants
  for each row execute function private.variant_inherits_photo();

create function public.set_item_photo(p_item_id bigint, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  perform private.assert_owner();
  if v_path is not null and v_path !~ '^items/[A-Za-z0-9._-]{1,120}$' then
    raise exception 'Caminho de foto inválido.' using errcode = '22023';
  end if;
  update public.items set photo_path = v_path where id = p_item_id;
  if not found then
    raise exception 'Item não encontrado.' using errcode = '22023';
  end if;
end;
$$;

select private.apply_grants();
