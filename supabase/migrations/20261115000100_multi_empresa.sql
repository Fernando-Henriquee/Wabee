-- =============================================================================
-- Wabee — Multi-empresa (SaaS)
--
-- Cada EMPRESA é um espaço isolado. Todas as tabelas de negócio ganham company_id e a
-- RLS só deixa passar linhas da empresa ativa do usuário. Quem não é membro da empresa não
-- vê nada dela. Convite: só quem já é da empresa convida outra conta.
--
-- Como o isolamento funciona
--   * private.company_id() devolve a empresa ativa: cabeçalho x-company-id (validado contra
--     company_members) ou, sem cabeçalho, a única empresa do usuário.
--   * O dono (owner) de tabelas e funções passa a ser o papel wabee_owner, SEM bypass de RLS,
--     e as tabelas têm FORCE ROW LEVEL SECURITY. Assim as ~150 RPCs SECURITY DEFINER também
--     só enxergam a empresa ativa (sem isso um id de outra empresa passaria).
--   * FKs entre tabelas de negócio viram compostas (company_id, id): o Postgres ignora RLS
--     na checagem de FK, então a empresa vai dentro da própria chave estrangeira.
--   * private.apply_grants() agora também chama private.apply_ownership(), que transfere
--     o que for criado depois e liga RLS + políticas em toda tabela com company_id.
--
-- Papéis: dono (gerencia membros e convites) e membro (acesso a tudo).
-- Finanças pessoais (pf_*) continuam por conta, fora de qualquer empresa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Papel dono dos objetos (sem BYPASSRLS)
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'wabee_owner') then
    create role wabee_owner nologin;
  end if;
end;
$$;

grant wabee_owner to current_user;
grant usage on schema public, private, auth, extensions to wabee_owner;
grant create on schema public, private to wabee_owner;
grant select on auth.users to wabee_owner;

-- -----------------------------------------------------------------------------
-- 2. Empresas, membros e convites
-- -----------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is 'Empresas (espaços isolados). Todo dado de negócio pertence a uma empresa.';

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('dono', 'membro')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index company_members_user_idx on public.company_members (user_id) where active;

comment on table public.company_members is
  'Quem participa de cada empresa. dono: gerencia membros e convites; membro: acesso a tudo da empresa.';

create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente', 'aceito', 'recusado', 'cancelado')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index company_invites_pending_uq on public.company_invites (company_id, email) where status = 'pendente';
create index company_invites_email_idx on public.company_invites (email) where status = 'pendente';

create trigger companies_touch before update on public.companies
  for each row execute function private.touch_updated_at();
create trigger company_members_touch before update on public.company_members
  for each row execute function private.touch_updated_at();

-- Empresa ativa do usuário. Nunca confia no cabeçalho sem conferir o vínculo.
create function private.company_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_header text;
  v_company uuid;
  v_ids uuid[];
begin
  if v_user is null then
    return null;
  end if;
  -- wabee.company: empresa fixada só dentro de uma transação (seed_company). Passa pela mesma
  -- conferência de vínculo do cabeçalho, então não dá acesso a empresa de que a pessoa não faz parte.
  v_header := nullif(btrim(coalesce(current_setting('wabee.company', true), '')), '');
  if v_header is null then
    begin
      v_header := nullif(btrim(coalesce((nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-company-id', '')), '');
    exception when others then
      v_header := null;
    end;
  end if;
  if v_header is not null then
    begin
      v_company := v_header::uuid;
    exception when others then
      return null;
    end;
    if exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = v_user and m.active) then
      return v_company;
    end if;
    return null;
  end if;
  select array_agg(m.company_id) into v_ids from public.company_members m where m.user_id = v_user and m.active;
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    return v_ids[1];
  end if;
  return null;
end;
$$;

create function private.is_company_member(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = (select auth.uid()) and m.active
  );
$$;

create function private.is_company_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = private.company_id() and m.user_id = (select auth.uid()) and m.active and m.role = 'dono'
  );
$$;

-- Pessoas que dividem alguma empresa com o usuário (para ver perfis e membros).
create function private.shares_company(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = (select auth.uid()) or exists (
    select 1
    from public.company_members a
    join public.company_members b on b.company_id = a.company_id and b.active
    where a.user_id = (select auth.uid()) and a.active and b.user_id = p_user
  );
$$;

create function private.my_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(u.email)) from auth.users u where u.id = (select auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- 3. Helpers de papel passam a valer por empresa (mesmas assinaturas)
--    Todo membro ativo da empresa tem acesso a tudo; só gerir pessoas é do dono.
-- -----------------------------------------------------------------------------

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.company_members m
  where m.company_id = private.company_id() and m.user_id = (select auth.uid()) and m.active;
$$;

create or replace function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.company_id() is not null;
$$;

create or replace function private.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.company_id() is not null;
$$;

create or replace function private.can_view_costs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.company_id() is not null;
$$;

create function private.assert_company_owner()
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
  if not private.is_company_owner() then
    raise exception 'Só o dono da empresa pode fazer isso.' using errcode = '42501';
  end if;
end;
$$;

-- "Hoje" das finanças pessoais: não depende do fuso de nenhuma empresa.
create function private.pf_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Finanças pessoais: qualquer conta logada, independente de empresa.
create function private.assert_personal()
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
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Empresa Wabee: recebe tudo o que existe hoje
-- -----------------------------------------------------------------------------

do $$
declare
  v_company uuid;
  v_creator uuid;
  v_name text := coalesce((select s.company_name from public.settings s limit 1), 'Wabee');
begin
  select u.id into v_creator
  from auth.users u
  join public.app_members m on m.user_id = u.id and m.active and m.role = 'dono'
  order by (lower(u.email) = 'storewabee@gmail.com') desc, m.created_at
  limit 1;

  insert into public.companies (name, created_by) values (v_name, v_creator) returning id into v_company;

  insert into public.company_members (company_id, user_id, role, active, created_at)
  select v_company, m.user_id, case when m.role = 'dono' then 'dono' else 'membro' end, m.active, m.created_at
  from public.app_members m;


end;
$$;

-- -----------------------------------------------------------------------------
-- 5. company_id em todas as tabelas de negócio
-- -----------------------------------------------------------------------------

do $$
declare
  v_company uuid := (select c.id from public.companies c order by c.created_at limit 1);
  v_tables text[] := array[
    'settings', 'audit_logs', 'idempotency_keys', 'doc_sequences', 'month_closes',
    'payment_accounts', 'financial_categories', 'result_entries', 'cash_transactions', 'owner_movements',
    'payables', 'receivables', 'installments',
    'suppliers', 'items', 'filament_specs', 'tool_specs', 'stock_lots', 'stock_movements', 'stock_balances',
    'equipment', 'cost_rates', 'maintenance_logs', 'sales_channels', 'sales_channel_fees',
    'products', 'product_variants', 'bom_versions', 'bom_lines', 'channel_prices',
    'purchases', 'purchase_lines', 'receipts', 'receipt_lines',
    'print_jobs', 'print_job_outputs', 'print_job_materials', 'post_process_entries',
    'customers', 'sales_orders', 'sales_order_lines', 'deliveries', 'delivery_lines', 'order_packaging', 'reservations',
    'quote_requests', 'quote_events'
  ];
  t text;
begin
  foreach t in array v_tables loop
    -- Default constante preenche as linhas existentes sem disparar gatilhos de imutabilidade.
    execute format('alter table public.%I add column company_id uuid not null default %L', t, v_company);
    execute format('alter table public.%I alter column company_id set default private.company_id()', t);
    execute format('alter table public.%I add constraint %I foreign key (company_id) references public.companies (id)', t, t || '_company_fk');
    execute format('create index %I on public.%I (company_id)', t || '_company_idx', t);
  end loop;
end;
$$;

-- Registros únicos (settings, numeração, fechamento, idempotência) passam a ser por empresa.
alter table public.settings drop constraint settings_pkey;
alter table public.settings add primary key (company_id);

alter table public.doc_sequences drop constraint doc_sequences_pkey;
alter table public.doc_sequences add primary key (company_id, prefix, year);

alter table public.month_closes drop constraint month_closes_pkey;
alter table public.month_closes add primary key (company_id, month);

alter table public.idempotency_keys drop constraint idempotency_keys_pkey;
alter table public.idempotency_keys add primary key (company_id, key);

-- Unicidades visíveis ao usuário passam a ser por empresa.
do $$
declare
  r record;
  v_con text;
  v_attnum smallint;
begin
  for r in select * from (values
    ('financial_categories', 'code'), ('payables', 'number'), ('receivables', 'number'), ('items', 'sku'),
    ('stock_lots', 'lot_code'), ('products', 'slug'), ('product_variants', 'sku'), ('purchases', 'number'),
    ('print_jobs', 'code'), ('sales_orders', 'number'), ('quote_requests', 'number')
  ) as v(t, c) loop
    select a.attnum into v_attnum from pg_attribute a where a.attrelid = format('public.%I', r.t)::regclass and a.attname = r.c;
    select c.conname into v_con from pg_constraint c
    where c.conrelid = format('public.%I', r.t)::regclass and c.contype = 'u' and c.conkey = array[v_attnum]::smallint[];
    if v_con is null then
      raise exception 'Unique de %.% não encontrada', r.t, r.c;
    end if;
    execute format('alter table public.%I drop constraint %I', r.t, v_con);
    execute format('alter table public.%I add constraint %I unique (company_id, %I)', r.t, r.t || '_' || r.c || '_company_key', r.c);
  end loop;
end;
$$;

drop index public.payment_accounts_name_uq;
create unique index payment_accounts_name_uq on public.payment_accounts (company_id, lower(btrim(name)));
drop index public.suppliers_name_uq;
create unique index suppliers_name_uq on public.suppliers (company_id, lower(btrim(name)));
drop index public.sales_channels_name_uq;
create unique index sales_channels_name_uq on public.sales_channels (company_id, lower(btrim(name)));
drop index public.filament_specs_uq;
create unique index filament_specs_uq on public.filament_specs (company_id, material, lower(btrim(brand)), lower(btrim(color_name)));

-- FKs entre tabelas de negócio viram compostas: (company_id, coluna) -> (company_id, id).
-- A checagem de FK ignora RLS; assim uma linha nunca aponta para dado de outra empresa.
do $$
declare
  r record;
  v_m text[];
  v_uq text;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
           pg_get_constraintdef(c.oid) as def,
           (select a.attname from pg_attribute a where a.attrelid = c.confrelid and a.attnum = c.confkey[1]) as refcol
    from pg_constraint c
    join pg_class cc on cc.oid = c.conrelid
    join pg_class pc on pc.oid = c.confrelid
    where c.contype = 'f'
      and cc.relnamespace = 'public'::regnamespace and pc.relnamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1
      and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'company_id' and not a.attisdropped)
      and exists (select 1 from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'company_id' and not a.attisdropped)
      and (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) <> 'company_id'
  loop
    v_m := regexp_match(r.def, '^FOREIGN KEY \(([a-z_0-9]+)\) REFERENCES ([a-z_0-9\."]+)\(([a-z_0-9]+)\)(.*)$');
    if v_m is null then
      raise exception 'FK não reconhecida: % %', r.conname, r.def;
    end if;
    v_uq := replace(replace(r.parent, 'public.', ''), '"', '') || '_' || r.refcol || '_company_uq';
    if not exists (select 1 from pg_constraint x where x.conrelid = r.parent::regclass and x.conname = v_uq) then
      execute format('alter table %s add constraint %I unique (company_id, %I)', r.parent, v_uq, r.refcol);
    end if;
    execute format('alter table %s drop constraint %I', r.child, r.conname);
    -- DEFERRABLE INITIALLY IMMEDIATE não muda nada no dia a dia; permite ao reset da empresa
    -- apagar tabelas com referências circulares dentro de uma transação (SET CONSTRAINTS).
    execute format('alter table %s add constraint %I foreign key (company_id, %I) references %s (company_id, %I)%s%s',
                   r.child, r.conname, v_m[1], r.parent, v_m[3], v_m[4],
                   case when v_m[4] like '%DEFERRABLE%' then '' else ' DEFERRABLE INITIALLY IMMEDIATE' end);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Membros: app_members sai, company_members entra
-- -----------------------------------------------------------------------------

drop table public.app_members cascade;

create view public.v_members as
select m.user_id, m.role, m.active, m.created_at, p.display_name, u.email
from public.company_members m
left join public.profiles p on p.id = m.user_id
left join auth.users u on u.id = m.user_id
where m.company_id = private.company_id();

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (private.shares_company(id));

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;

create policy companies_select on public.companies for select to authenticated
  using (private.is_company_member(id));
create policy company_members_select on public.company_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_company_member(company_id));
create policy company_invites_select on public.company_invites for select to authenticated
  using (private.is_company_member(company_id) or email = private.my_email());

-- -----------------------------------------------------------------------------
-- 7. Auditoria, idempotência e numeração por empresa
-- -----------------------------------------------------------------------------

create or replace function private.audit(
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
declare
  v_company uuid := private.company_id();
begin
  if v_company is null then
    return;
  end if;
  insert into public.audit_logs (company_id, user_id, action, model_label, object_id, object_ref, summary, changes, ip)
  values (v_company, (select auth.uid()), p_action, p_model, p_object_id, p_ref, p_summary, coalesce(p_changes, '{}'::jsonb), private.request_ip());
end;
$$;

create or replace function private.audit_row()
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
  -- Dados iniciais de empresa nova não entram na auditoria (seed_company liga esta marca).
  if current_setting('wabee.seeding', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_ref := coalesce(v_new ->> 'sku', v_new ->> 'number', v_new ->> 'code', v_new ->> 'name');
    insert into public.audit_logs (company_id, user_id, action, model_label, object_id, object_ref, summary, changes, ip)
    values ((v_new ->> 'company_id')::uuid, (select auth.uid()), 'CREATE', v_model, private.json_bigint(v_new -> 'id'), v_ref, null,
            jsonb_build_object('depois', v_new), private.request_ip());
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
    insert into public.audit_logs (company_id, user_id, action, model_label, object_id, object_ref, summary, changes, ip)
    values ((v_new ->> 'company_id')::uuid, (select auth.uid()), 'UPDATE', v_model, private.json_bigint(v_new -> 'id'), v_ref, null, v_changes, private.request_ip());
  end if;
  return null;
end;
$$;

create or replace function private.idem_begin(p_key uuid, p_operation text)
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
  on conflict (company_id, key) do nothing;
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

create or replace function private.next_doc_number(p_prefix text, p_date date default null)
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
  on conflict (company_id, prefix, year) do update set last_value = public.doc_sequences.last_value + 1
  returning last_value into v_value;
  return format('%s-%s-%s', p_prefix, v_year, lpad(v_value::text, 4, '0'));
end;
$$;

create or replace function public.close_month(p_month date, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_metrics jsonb;
begin
  perform private.assert_owner();
  if v_end >= private.today() then
    raise exception 'Só meses já encerrados podem ser fechados.' using errcode = '22023';
  end if;
  v_metrics := jsonb_build_object('dre', public.income_statement(v_start, v_end), 'checklist', public.month_close_checklist(v_start),
                                  'cash_balance', private.cash_balance_at(v_end));
  insert into public.month_closes (month, status, closed_at, closed_by, metrics, notes)
  values (v_start, 'FECHADO', now(), (select auth.uid()), v_metrics, nullif(btrim(coalesce(p_notes, '')), ''))
  on conflict (company_id, month) do update set status = 'FECHADO', closed_at = now(), closed_by = (select auth.uid()), metrics = excluded.metrics,
                                                notes = coalesce(excluded.notes, public.month_closes.notes);
  perform private.audit('CLOSE_MONTH', 'month_close', null, to_char(v_start, 'MM/YYYY'), 'Mês fechado', '{}'::jsonb);
  return v_metrics;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Dados iniciais de cada empresa nova
--    Insere com company_id explícito (a empresa pode não ser a ativa na sessão).
-- -----------------------------------------------------------------------------

create function private.seed_company(p_company uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel bigint;
begin
  -- A empresa nova vira a ativa só durante o seed (INSERT ... RETURNING exige enxergar a linha).
  perform set_config('wabee.seeding', 'on', true);
  perform set_config('wabee.company', p_company::text, true);
  with parents as (
    insert into public.financial_categories (company_id, code, name, nature, in_income_statement, is_system) values
      (p_company, '1', 'Receitas', 'RECEITA', true, true),
      (p_company, '2', 'Custos', 'CUSTO', true, true),
      (p_company, '3', 'Despesas de venda', 'DESPESA_VENDA', true, true),
      (p_company, '4', 'Despesas operacionais', 'DESPESA_OPERACIONAL', true, true),
      (p_company, '5', 'Despesas financeiras', 'DESPESA_FINANCEIRA', true, true),
      (p_company, '6', 'Resultado não operacional', 'NAO_OPERACIONAL', true, true),
      (p_company, '7', 'Investimentos', 'INVESTIMENTO', false, true),
      (p_company, '8', 'Dono', 'DONO', false, true),
      (p_company, '9', 'Transferências', 'TRANSFERENCIA', false, true)
    returning id, code, nature, in_income_statement
  )
  insert into public.financial_categories (company_id, parent_id, code, name, nature, in_income_statement, is_system)
  select p_company, p.id, c.code, c.name, p.nature, p.in_income_statement, c.system
  from (values
    ('1', '1.1', 'Venda de produtos', true),
    ('1', '1.2', 'Frete cobrado', true),
    ('1', '1.3', 'Outras receitas', true),
    ('1', '1.4', 'Descontos e devoluções', true),
    ('2', '2.1', 'CMV — material', true),
    ('2', '2.2', 'CMV — energia', true),
    ('2', '2.3', 'CMV — depreciação', true),
    ('2', '2.4', 'CMV — operacional combinado', true),
    ('2', '2.5', 'CMV — trabalho', true),
    ('2', '2.6', 'Custo de falhas de produção', true),
    ('2', '2.7', 'Ajustes e perdas de estoque', true),
    ('3', '3.1', 'Taxas de canal', true),
    ('3', '3.2', 'Taxas de pagamento', true),
    ('3', '3.3', 'Embalagem', true),
    ('3', '3.4', 'Frete pago', true),
    ('3', '3.5', 'Brindes e amostras', true),
    ('3', '3.6', 'Anúncios e marketing', false),
    ('3', '3.7', 'Impostos sobre vendas', true),
    ('4', '4.1', 'Diferença de energia (conciliação)', true),
    ('4', '4.2', 'Manutenção', true),
    ('4', '4.3', 'Internet e telefone (parte da empresa)', false),
    ('4', '4.4', 'Software e assinaturas', false),
    ('4', '4.5', 'Impostos fixos (DAS)', true),
    ('4', '4.6', 'Ferramentas pequenas', true),
    ('4', '4.7', 'Consumíveis sem controle de estoque', true),
    ('4', '4.8', 'Pró-labore', true),
    ('4', '4.9', 'Outras despesas', false),
    ('5', '5.1', 'Juros de parcelamento', true),
    ('5', '5.2', 'Juros e multas por atraso', true),
    ('5', '5.3', 'Tarifas bancárias', false),
    ('5', '5.4', 'Descontos obtidos', true),
    ('6', '6.1', 'Ganho ou perda na baixa de equipamento', true),
    ('7', '7.1', 'Compra de equipamentos', true),
    ('7', '7.2', 'Compra de materiais para estoque', true),
    ('8', '8.1', 'Aporte de capital', true),
    ('8', '8.2', 'Empréstimo do dono', true),
    ('8', '8.3', 'Reembolso ao dono', true),
    ('8', '8.4', 'Distribuição de lucro', true),
    ('8', '8.5', 'Pagamento de empréstimo ao dono', true),
    ('9', '9.1', 'Transferência entre contas', true),
    ('9', '9.2', 'Devolução de valores a clientes', true)
  ) as c(parent, code, name, system)
  join parents p on p.code = c.parent;

  with ch as (
    insert into public.sales_channels (company_id, name, kind, payout_days, active) values
      (p_company, 'Venda direta', 'DIRETO', 0, true),
      (p_company, 'Instagram / WhatsApp', 'REDE_SOCIAL', 0, true),
      (p_company, 'Feira / evento', 'FEIRA', 0, true),
      (p_company, 'Shopee', 'MARKETPLACE', 14, false),
      (p_company, 'Mercado Livre', 'MARKETPLACE', 14, false)
    returning id, name
  ), fees as (
    insert into public.sales_channel_fees (company_id, channel_id, fee_pct, fee_fixed, payment_fee_pct, valid_from)
    select p_company, ch.id, 0, 0, 0, date '2026-01-01' from ch
  )
  select ch.id into v_channel from ch where ch.name = 'Venda direta';

  insert into public.settings (company_id, company_name, default_channel_id)
  values (p_company, p_name, v_channel);
  perform set_config('wabee.seeding', 'off', true);
  perform set_config('wabee.company', '', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. RPCs de empresas, membros e convites
-- -----------------------------------------------------------------------------

create function public.create_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Sessão inválida ou expirada. Entre novamente.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Informe o nome da empresa (até 120 caracteres).' using errcode = '22023';
  end if;
  if (select count(*) from public.company_members m where m.user_id = v_user and m.role = 'dono') >= 20 then
    raise exception 'Limite de empresas por conta atingido.' using errcode = '22023';
  end if;
  insert into public.companies (name, created_by) values (v_name, v_user) returning id into v_id;
  insert into public.company_members (company_id, user_id, role) values (v_id, v_user, 'dono');
  perform private.seed_company(v_id, v_name);
  return v_id;
end;
$$;

create function public.my_companies()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', m.role) order by c.created_at), '[]'::jsonb)
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.user_id = (select auth.uid()) and m.active;
$$;

create function public.rename_company(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.assert_company_owner();
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Informe o nome da empresa (até 120 caracteres).' using errcode = '22023';
  end if;
  update public.companies set name = v_name where id = private.company_id();
  update public.settings set company_name = v_name where id;
end;
$$;

create or replace function public.set_member_role(p_user_id uuid, p_role text, p_active boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.company_id();
begin
  perform private.assert_company_owner();
  if p_role not in ('dono', 'membro') then
    raise exception 'Perfil inválido.' using errcode = '22023';
  end if;
  update public.company_members set role = p_role, active = p_active
   where company_id = v_company and user_id = p_user_id;
  if not found then
    raise exception 'Membro não encontrado nesta empresa.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.role = 'dono' and m.active) then
    raise exception 'A empresa precisa ter pelo menos um dono ativo.' using errcode = '22023';
  end if;
  perform private.audit('UPDATE', 'company_member', null, p_user_id::text, format('Perfil alterado para %s%s', p_role, case when p_active then '' else ' (inativo)' end), '{}'::jsonb);
end;
$$;

create function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.company_id();
begin
  perform private.assert_company_owner();
  delete from public.company_members where company_id = v_company and user_id = p_user_id;
  if not found then
    raise exception 'Membro não encontrado nesta empresa.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.role = 'dono' and m.active) then
    raise exception 'A empresa precisa ter pelo menos um dono ativo.' using errcode = '22023';
  end if;
  perform private.audit('DELETE', 'company_member', null, p_user_id::text, 'Membro removido da empresa', '{}'::jsonb);
end;
$$;

create function public.invite_member(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_company uuid := private.company_id();
  v_id uuid;
begin
  perform private.assert_company_owner();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Informe um e-mail válido.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.company_members m join auth.users u on u.id = m.user_id
    where m.company_id = v_company and m.active and lower(u.email) = v_email
  ) then
    raise exception 'Essa pessoa já faz parte da empresa.' using errcode = '22023';
  end if;
  insert into public.company_invites (company_id, email, invited_by)
  values (v_company, v_email, (select auth.uid()))
  on conflict (company_id, email) where status = 'pendente' do update set invited_by = excluded.invited_by
  returning id into v_id;
  perform private.audit('CREATE', 'company_invite', null, v_email, 'Convite enviado', '{}'::jsonb);
  return v_id;
end;
$$;

create function public.list_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_company_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'created_at', i.created_at) order by i.created_at desc)
    from public.company_invites i
    where i.company_id = private.company_id() and i.status = 'pendente'
  ), '[]'::jsonb);
end;
$$;

create function public.cancel_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_company_owner();
  update public.company_invites set status = 'cancelado', resolved_at = now()
   where id = p_invite_id and company_id = private.company_id() and status = 'pendente';
  if not found then
    raise exception 'Convite não encontrado.' using errcode = '22023';
  end if;
end;
$$;

create function public.my_pending_invites()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'company_id', i.company_id, 'company_name', c.name,
           'invited_by', coalesce(nullif(p.display_name, ''), 'Alguém'), 'created_at', i.created_at
         ) order by i.created_at desc), '[]'::jsonb)
  from public.company_invites i
  join public.companies c on c.id = i.company_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pendente' and i.email = private.my_email();
$$;

create function public.accept_invite(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_invite public.company_invites;
begin
  if v_user is null then
    raise exception 'Sessão inválida ou expirada. Entre novamente.' using errcode = '42501';
  end if;
  select * into v_invite from public.company_invites i
   where i.id = p_invite_id and i.status = 'pendente' and i.email = private.my_email() for update;
  if v_invite.id is null then
    raise exception 'Convite não encontrado ou já respondido.' using errcode = '22023';
  end if;
  insert into public.company_members (company_id, user_id, role)
  values (v_invite.company_id, v_user, 'membro')
  on conflict (company_id, user_id) do update set active = true;
  update public.company_invites set status = 'aceito', resolved_at = now() where id = v_invite.id;
  return v_invite.company_id;
end;
$$;

create function public.decline_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.company_invites set status = 'recusado', resolved_at = now()
   where id = p_invite_id and status = 'pendente' and email = private.my_email();
  if not found then
    raise exception 'Convite não encontrado ou já respondido.' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Reset por empresa (antes era TRUNCATE global)
-- -----------------------------------------------------------------------------

create or replace function public.reset_system(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.company_id();
  v_tables text[] := array[
    'channel_prices', 'bom_lines', 'bom_versions', 'product_variants', 'products',
    'tool_specs', 'filament_specs', 'items',
    'stock_balances', 'stock_movements', 'stock_lots',
    'receipt_lines', 'receipts', 'purchase_lines', 'purchases',
    'post_process_entries', 'print_job_materials', 'print_job_outputs', 'print_jobs', 'maintenance_logs',
    'quote_events', 'quote_requests',
    'reservations', 'order_packaging', 'delivery_lines', 'deliveries', 'sales_order_lines', 'sales_orders',
    'installments', 'payables', 'receivables', 'owner_movements', 'cash_transactions', 'result_entries', 'month_closes',
    'doc_sequences', 'idempotency_keys', 'audit_logs'
  ];
  t text;
begin
  perform private.assert_owner();
  if p_confirm is distinct from 'APAGAR TUDO' then
    raise exception 'Digite APAGAR TUDO para confirmar o reset.' using errcode = '22023';
  end if;
  if not private.is_company_owner() then
    raise exception 'Só o dono da empresa pode resetar.' using errcode = '42501';
  end if;

  -- Gatilhos de imutabilidade e de auditoria saem de cena só nesta transação.
  foreach t in array v_tables loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  -- Cadastros mantidos que apontam para tabelas apagadas.
  update public.settings set onboarding_state = '{}'::jsonb, go_live_date = null, default_order_packaging_item_id = null where id;
  update public.equipment set purchase_line_id = null where purchase_line_id is not null;

  -- As FKs são adiáveis: a checagem acontece no fim da transação, então a ordem dos deletes
  -- não importa (há referências circulares entre financeiro, vendas e produção).
  set constraints all deferred;
  foreach t in array v_tables loop
    execute format('delete from public.%I where company_id = $1', t) using v_company;
  end loop;
  set constraints all immediate;   -- confere as FKs agora; sem eventos pendentes dá para religar os gatilhos

  foreach t in array v_tables loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  perform private.audit('DELETE', 'system', null, 'reset',
    'Reset do sistema: operação, produtos e itens apagados; configurações e cadastros base mantidos.');
  return jsonb_build_object('ok', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Finanças pessoais: por conta, sem exigir empresa
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_changed integer := 0;
begin
  -- Funções que exigiam perfil dono da empresa.
  for r in
    select p.oid, p.proname from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and (p.proname like 'pf\_%' escape '\')
      and (pg_get_functiondef(p.oid) like '%private.assert_owner()%' or pg_get_functiondef(p.oid) like '%private.today()%')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(replace(v_def, 'private.assert_owner()', 'private.assert_personal()'), 'private.today()', 'private.pf_today()');
    execute v_new;
    v_changed := v_changed + 1;
  end loop;
  if v_changed < 2 then
    raise exception 'Funções pf_* esperadas não foram ajustadas (%).', v_changed;
  end if;

  -- Políticas: de "dono da empresa" para "conta logada".
  for r in
    select pol.tablename, pol.policyname, pol.qual
    from pg_policies pol
    where pol.schemaname = 'public' and pol.tablename like 'pf\_%' escape '\' and pol.qual like '%has_role%'
  loop
    v_new := regexp_replace(r.qual, 'private\.has_role\(ARRAY\[''dono''::text\]\)', '((select auth.uid()) is not null)');
    if v_new = r.qual then
      raise exception 'Política % não reconhecida: %', r.policyname, r.qual;
    end if;
    execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, v_new);
  end loop;
end;
$$;

create or replace function public.pf_add_member(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_user uuid;
  v_name text;
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then
    raise exception 'Não foi possível adicionar essa pessoa. Ela precisa já ter uma conta no Wabee.' using errcode = '22023';
  end if;
  if exists (select 1 from public.pf_space_members m where m.user_id = v_user) then
    raise exception 'Essa pessoa já usa um espaço de finanças pessoais.' using errcode = '22023';
  end if;
  if (select count(*) from public.pf_space_members m where m.space_id = v_space) >= 2 then
    raise exception 'O espaço já tem duas pessoas.' using errcode = '22023';
  end if;
  insert into public.pf_space_members (space_id, user_id) values (v_space, v_user);
  select p.display_name into v_name from public.profiles p where p.id = v_user;
  return jsonb_build_object('user_id', v_user, 'display_name', coalesce(nullif(v_name, ''), p_email));
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Dono dos objetos, RLS forçada e políticas (rodado também por apply_grants)
-- -----------------------------------------------------------------------------

create function private.apply_ownership()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  -- Tabelas, views e views materializadas (as sequências de identidade acompanham a tabela).
  for r in
    select c.oid::regclass::text as obj, c.relkind
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
      and pg_get_userbyid(c.relowner) <> 'wabee_owner'
  loop
    execute format('alter %s %s owner to wabee_owner',
                   case r.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, r.obj);
  end loop;

  -- Funções e procedimentos (menos as que o migrador executa).
  for r in
    select p.oid::regprocedure::text as obj
    from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind in ('f', 'p')
      and pg_get_userbyid(p.proowner) <> 'wabee_owner'
      and p.proname not in ('apply_grants', 'apply_ownership')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s owner to wabee_owner', r.obj);
  end loop;

  -- RLS forçada e políticas em toda tabela com company_id (exceto as de gestão de empresas).
  for r in
    select c.relname
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and c.relname not in ('company_members', 'company_invites')
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('alter table public.%I force row level security', r.relname);
    execute format('drop policy if exists tenant_select on public.%I', r.relname);
    execute format('drop policy if exists tenant_write on public.%I', r.relname);
    execute format('create policy tenant_select on public.%I for select to authenticated using (company_id = (select private.company_id()))', r.relname);
    execute format('create policy tenant_write on public.%I for all to wabee_owner using (company_id = (select private.company_id())) with check (private.is_company_member(company_id))', r.relname);
  end loop;
end;
$$;

-- Políticas antigas (por papel global) saem; ficam as de empresa criadas acima.
do $$
declare
  r record;
begin
  for r in
    select pol.tablename, pol.policyname
    from pg_policies pol
    join pg_class c on c.relname = pol.tablename and c.relnamespace = 'public'::regnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
    where pol.schemaname = 'public' and pol.tablename not in ('company_members', 'company_invites')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

create or replace function private.apply_grants()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  perform private.apply_ownership();

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
    'private.bom_grams_per_unit(bigint)', 'private.company_id()', 'private.is_company_member(uuid)', 'private.is_company_owner()',
    'private.shares_company(uuid)', 'private.my_email()', 'private.pf_today()'
  ]) loop
    execute format('grant execute on function %s to authenticated', v_name);
  end loop;

  grant usage on schema public to service_role;
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
  grant execute on all functions in schema public to service_role;
end;
$$;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, public;

select private.apply_grants();

-- O dono (wabee_owner) acessa o que as funções e views precisam fora do schema public.
grant execute on all functions in schema private to wabee_owner;
