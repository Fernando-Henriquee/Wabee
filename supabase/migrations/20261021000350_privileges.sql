-- =============================================================================
-- Wabee — 0350 Privilégios explícitos
--
-- Funciona com "Automatically expose new tables" ligado ou desligado no Supabase:
--   * anon (visitante sem login) não recebe privilégio algum em public;
--   * authenticated só LÊ tabelas e views (a RLS decide as linhas) e EXECUTA as
--     RPCs públicas — nenhuma tabela aceita escrita direta (princípio 2);
--   * funções internas (schema private) não são executáveis por usuários, exceto
--     as usadas pelas políticas de RLS;
--   * service_role (chave administrativa, só no provisionamento) tem acesso total.
-- Cada migration posterior chama private.apply_grants() ao final.
-- =============================================================================

create function private.apply_grants()
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
    'private.current_app_role()', 'private.is_member()', 'private.has_role(text[])', 'private.can_view_costs()'
  ]) loop
    execute format('grant execute on function %s to authenticated', v_name);
  end loop;

  grant usage on schema public to service_role;
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
  grant execute on all functions in schema public to service_role;
end;
$$;

-- Objetos criados por migrations futuras (como postgres) não recebem privilégios automáticos.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;
alter default privileges for role postgres in schema private revoke all on functions from anon, authenticated, public;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

select private.apply_grants();
