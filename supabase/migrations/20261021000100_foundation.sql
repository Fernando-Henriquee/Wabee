-- =============================================================================
-- Wabee — 0100 Fundação
-- Membros e perfis de acesso, configurações, auditoria, idempotência,
-- numeração de documentos e fechamento de mês.
--
-- Convenções (seção 3.2 da especificação):
--   * Toda regra que muda estado fica em funções do banco (RPCs). O navegador
--     só lê tabelas/views; nenhuma tabela aceita INSERT/UPDATE/DELETE direto.
--   * Uma operação = uma transação; saldos são travados com SELECT ... FOR UPDATE.
--   * Decimal sempre: dinheiro numeric(14,2); custo unitário numeric(16,6);
--     quantidade numeric(14,3); percentual numeric(7,4) (0,1250 = 12,5%).
--   * Funções internas ficam no schema "private" (não exposto pela API).
--   * Funções SECURITY DEFINER usam search_path vazio e nomes qualificados.
--   * Regras citadas como RN-xx / US-x.y referem-se à especificação.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Tipo usado por todos os cálculos de custo em camadas (RN-01, seção 2.3).
create type private.cost_layers as (
  material numeric,
  energy numeric,
  depreciation numeric,
  operational numeric,
  labor numeric
);

-- -----------------------------------------------------------------------------
-- Membros e perfis (seção 1.3): dono, produção, leitura
-- -----------------------------------------------------------------------------

create table public.app_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('dono', 'producao', 'leitura')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_members is
  'Quem tem acesso ao sistema. dono: tudo; producao: impressões e consulta de estoque; leitura: relatórios sem editar.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.app_members m where m.user_id = (select auth.uid()) and m.active;
$$;

create function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.active);
$$;

create function private.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m
    where m.user_id = (select auth.uid()) and m.active and m.role = any (p_roles)
  );
$$;

-- Produção não vê valores financeiros (US-0.3).
create function private.can_view_costs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(array['dono', 'leitura']);
$$;

create function private.assert_role(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão inválida ou expirada. Entre novamente.' using errcode = '42501';
  end if;
  if not private.has_role(p_roles) then
    raise exception 'Você não tem permissão para esta operação.' using errcode = '42501';
  end if;
end;
$$;

-- Atalhos legíveis para as RPCs.
create function private.assert_owner()
returns void
language sql
stable
security definer
set search_path = ''
as $$
  select private.assert_role(array['dono']);
$$;

create function private.assert_production()
returns void
language sql
stable
security definer
set search_path = ''
as $$
  select private.assert_role(array['dono', 'producao']);
$$;

-- -----------------------------------------------------------------------------
-- Configurações (registro único — seção 4.1)
-- -----------------------------------------------------------------------------

create table public.settings (
  id boolean primary key default true check (id),
  company_name text not null default 'Wabee' check (char_length(btrim(company_name)) between 1 and 120),
  timezone text not null default 'America/Sao_Paulo',
  allow_negative_stock boolean not null default false,
  absorb_scrap_cost boolean not null default false,
  default_owner_funding_type text not null default 'CAPITAL_CONTRIBUTION'
    check (default_owner_funding_type in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN')),
  default_channel_id bigint,
  margin_target_pct numeric(7,4) not null default 0.3000 check (margin_target_pct >= 0 and margin_target_pct < 1),
  tax_regime text not null default 'CPF_SEM_CNPJ' check (tax_regime in ('CPF_SEM_CNPJ', 'MEI', 'SIMPLES')),
  sales_tax_pct numeric(7,4) not null default 0 check (sales_tax_pct >= 0 and sales_tax_pct < 1),
  mei_monthly_das numeric(14,2) not null default 0 check (mei_monthly_das >= 0),
  coverage_alert_days integer not null default 14 check (coverage_alert_days between 0 and 365),
  go_live_date date,
  filament_reference_cost_g numeric(16,6) not null default 0.100000 check (filament_reference_cost_g >= 0),
  default_order_packaging_item_id bigint,
  onboarding_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.settings is 'Parâmetros gerais (registro único). Alterações valem só para operações futuras.';
comment on column public.settings.go_live_date is 'Data de início do uso. Antes dela só entram operações históricas (US-3.6, US-6.11).';

insert into public.settings default values;

create function private.settings()
returns public.settings
language sql
stable
security definer
set search_path = ''
as $$
  select s from public.settings s where s.id;
$$;

-- "Hoje" no fuso da empresa.
create function private.today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone s.timezone)::date from public.settings s where s.id;
$$;

create function private.local_date(p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (p_at at time zone s.timezone)::date from public.settings s where s.id;
$$;

-- -----------------------------------------------------------------------------
-- Utilitários de gatilho
-- -----------------------------------------------------------------------------

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Registro imutável (%). Corrija com um estorno.', tg_table_name using errcode = '42501';
end;
$$;

create trigger app_members_touch before update on public.app_members
  for each row execute function private.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();

create function private.validate_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger settings_validate before insert or update of timezone on public.settings
  for each row execute function private.validate_settings();

-- Perfil criado automaticamente para cada usuário do Auth.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Auditoria (US-0.5): somente inserção
-- -----------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null check (action in ('CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'REVERSE', 'CLOSE_MONTH', 'REOPEN_MONTH', 'LOGIN')),
  model_label text not null,
  object_id bigint,
  object_ref text,
  summary text,
  changes jsonb not null default '{}'::jsonb,
  ip text,
  occurred_at timestamptz not null default now()
);

create index audit_logs_time_idx on public.audit_logs (occurred_at desc);
create index audit_logs_object_idx on public.audit_logs (model_label, object_id);
create index audit_logs_user_idx on public.audit_logs (user_id, occurred_at desc);

comment on table public.audit_logs is
  'Quem fez o quê e quando. Sem privilégio de escrita para usuários; gravado só por RPCs e gatilhos.';

create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function private.block_mutation();

-- IP de origem como o PostgREST expõe (request.headers).
create function private.request_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers jsonb;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  return nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', ''), ',', 1)), '');
exception when others then
  return null;
end;
$$;

create function private.audit(
  p_action text,
  p_model text,
  p_object_id bigint,
  p_ref text,
  p_summary text,
  p_changes jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (user_id, action, model_label, object_id, object_ref, summary, changes, ip)
  values ((select auth.uid()), p_action, p_model, p_object_id, p_ref, p_summary, coalesce(p_changes, '{}'::jsonb), private.request_ip());
end;
$$;

create function private.json_bigint(p_value jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'number' then (p_value #>> '{}')::bigint end;
$$;

-- Gatilho genérico para cadastros: CREATE com o registro, UPDATE com antes/depois
-- apenas das colunas alteradas. Operações (compras, impressões, vendas…) gravam a
-- própria auditoria nas RPCs, com o resumo da operação.
create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model text := tg_argv[0];
  v_new jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_ref text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_ref := coalesce(v_new ->> 'sku', v_new ->> 'number', v_new ->> 'code', v_new ->> 'name');
    insert into public.audit_logs (user_id, action, model_label, object_id, object_ref, summary, changes, ip)
    values ((select auth.uid()), 'CREATE', v_model, private.json_bigint(v_new -> 'id'), v_ref, null, jsonb_build_object('depois', v_new), private.request_ip());
  elsif tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at') and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('antes', v_old -> v_key, 'depois', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
    v_ref := coalesce(v_new ->> 'sku', v_new ->> 'number', v_new ->> 'code', v_new ->> 'name');
    insert into public.audit_logs (user_id, action, model_label, object_id, object_ref, summary, changes, ip)
    values ((select auth.uid()), 'UPDATE', v_model, private.json_bigint(v_new -> 'id'), v_ref, null, v_changes, private.request_ip());
  end if;
  return null;
end;
$$;

create trigger settings_audit after update on public.settings
  for each row execute function private.audit_row('settings');

-- Login registrado pelo app logo após entrar (o IP vem dos cabeçalhos da API).
create function public.log_login()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  perform private.audit('LOGIN', 'auth', null, null, 'Entrou no sistema', '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Idempotência (princípio 10): o mesmo formulário enviado duas vezes não grava duas vezes
-- -----------------------------------------------------------------------------

create table public.idempotency_keys (
  key uuid primary key,
  operation text not null,
  user_id uuid,
  result jsonb,
  created_at timestamptz not null default now()
);

-- Devolve o resultado já gravado para a chave, ou null se a operação é nova (e reserva a chave).
-- Uma segunda chamada concorrente com a mesma chave espera a primeira terminar.
create function private.idem_begin(p_key uuid, p_operation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.idempotency_keys;
begin
  if p_key is null then
    return null;
  end if;
  insert into public.idempotency_keys (key, operation, user_id)
  values (p_key, p_operation, (select auth.uid()))
  on conflict (key) do nothing;
  if found then
    return null;
  end if;
  select * into v_row from public.idempotency_keys k where k.key = p_key;
  if v_row.operation <> p_operation then
    raise exception 'Identificador de requisição já usado em outra operação.' using errcode = '22023';
  end if;
  return coalesce(v_row.result, '{}'::jsonb);
end;
$$;

create function private.idem_finish(p_key uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is not null then
    update public.idempotency_keys set result = p_result where key = p_key;
  end if;
  return p_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Numeração anual por tipo (RN-28): CMP-2026-0001, IMP-2026-0001, PED-2026-0001…
-- -----------------------------------------------------------------------------

create table public.doc_sequences (
  prefix text not null,
  year integer not null,
  last_value integer not null default 0,
  primary key (prefix, year)
);

create function private.next_doc_number(p_prefix text, p_date date default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from coalesce(p_date, private.today()))::integer;
  v_value integer;
begin
  insert into public.doc_sequences (prefix, year, last_value)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_value = public.doc_sequences.last_value + 1
  returning last_value into v_value;
  return format('%s-%s-%s', p_prefix, v_year, lpad(v_value::text, 4, '0'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Fechamento de mês (RN-22): mês fechado não aceita operação com data dentro dele
-- -----------------------------------------------------------------------------

create table public.month_closes (
  month date primary key check (extract(day from month) = 1),
  status text not null default 'FECHADO' check (status in ('ABERTO', 'FECHADO')),
  closed_at timestamptz,
  closed_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  metrics jsonb not null default '{}'::jsonb,
  notes text
);

create function private.assert_open_period(p_date date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_date is null then
    return;
  end if;
  if exists (
    select 1 from public.month_closes c
    where c.month = date_trunc('month', p_date)::date and c.status = 'FECHADO'
  ) then
    raise exception 'O mês de % está fechado. Lance a correção com data no mês aberto.', to_char(p_date, 'MM/YYYY')
      using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Divisão de valores (RN-25): centavos restantes vão para o último elemento.
-- Ex.: split_amount(5646.19, 18) = 17 × 313,68 + 313,63.
-- -----------------------------------------------------------------------------

create function private.split_amount(p_total numeric, p_parts integer)
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_each numeric(14,2);
  v_result numeric[] := '{}';
begin
  if p_parts is null or p_parts < 1 then
    raise exception 'Número de parcelas inválido.' using errcode = '22023';
  end if;
  v_each := round(p_total / p_parts, 2);
  for i in 1..p_parts - 1 loop
    v_result := v_result || v_each;
  end loop;
  return v_result || (round(p_total, 2) - v_each * (p_parts - 1));
end;
$$;

-- Rateio proporcional de um valor monetário por pesos, com a diferença de
-- centavos na linha de MAIOR peso (RN-02). Devolve na mesma ordem dos pesos.
create function private.allocate_money(p_total numeric, p_weights numeric[])
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum numeric := 0;
  v_result numeric[] := '{}';
  v_allocated numeric := 0;
  v_max_index integer := 1;
  v_value numeric;
begin
  if coalesce(array_length(p_weights, 1), 0) = 0 then
    return v_result;
  end if;
  for i in 1..array_length(p_weights, 1) loop
    v_sum := v_sum + coalesce(p_weights[i], 0);
    if coalesce(p_weights[i], 0) > coalesce(p_weights[v_max_index], 0) then
      v_max_index := i;
    end if;
  end loop;
  for i in 1..array_length(p_weights, 1) loop
    v_value := case when v_sum = 0 then 0 else round(p_total * coalesce(p_weights[i], 0) / v_sum, 2) end;
    v_result := v_result || v_value;
    v_allocated := v_allocated + v_value;
  end loop;
  if v_sum <> 0 then
    v_result[v_max_index] := v_result[v_max_index] + (round(p_total, 2) - v_allocated);
  end if;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.app_members enable row level security;
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.doc_sequences enable row level security;
alter table public.month_closes enable row level security;

create policy app_members_select on public.app_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(array['dono']));

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.is_member());

create policy settings_select on public.settings
  for select to authenticated
  using (private.is_member());

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (private.has_role(array['dono', 'leitura']));

create policy month_closes_select on public.month_closes
  for select to authenticated
  using (private.is_member());

-- idempotency_keys e doc_sequences: sem política (somente funções internas).
