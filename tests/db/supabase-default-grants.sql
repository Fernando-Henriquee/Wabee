-- Comportamento do Supabase com "Automatically expose new tables" LIGADO:
-- tudo que for criado em public é concedido a anon/authenticated/service_role.
-- Os testes rodam nos dois modos (com e sem estes privilégios automáticos).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
