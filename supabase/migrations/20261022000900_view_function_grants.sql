-- Funções chamadas dentro das views rodam com o privilégio de quem consulta (não do
-- dono da view): v_bom_versions usa private.bom_grams_per_unit, que estava sem
-- EXECUTE para authenticated e fazia a leitura das fichas falhar com "permissão negada".

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
  -- Só o que as políticas de RLS e as views chamam diretamente.
  for v_name in select unnest(array[
    'private.current_app_role()', 'private.is_member()', 'private.has_role(text[])', 'private.can_view_costs()', 'private.today()',
    'private.bom_grams_per_unit(bigint)'
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
