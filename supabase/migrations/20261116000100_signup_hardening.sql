-- =============================================================================
-- Wabee — Cadastro aberto (criar conta): endurecimento
--
-- Com qualquer pessoa podendo criar conta, duas coisas deixam de ser "entre conhecidos":
--   1. Convites são entregues pelo e-mail da conta. Só vale e-mail CONFIRMADO: sem isso, quem
--      cadastrasse o e-mail de outra pessoa poderia aceitar o convite dela e entrar na empresa.
--   2. O papel wabee_owner NÃO enxerga auth.users no Supabase (a tabela tem RLS e ele não ignora RLS), então
--      toda leitura de e-mail passa por duas funções pequenas que continuam do postgres:
--      private.auth_email e private.auth_user_id. Sem isso, convites, lista de pessoas e finanças
--      pessoais não encontrariam ninguém.
--   3. Finanças pessoais: adicionar a segunda pessoa só vale para quem participa de uma das
--      empresas de quem adiciona (como era antes, quando todos eram da mesma empresa), e a
--      resposta é a mesma para qualquer falha, para não revelar quais e-mails têm conta.
-- =============================================================================

-- A lista de funções que ficam com o postgres cresce (ver apply_ownership).
create or replace function private.apply_ownership()
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
      and p.proname not in ('apply_grants', 'apply_ownership', 'auth_email', 'auth_user_id')
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

-- Leitura de auth.users: ficam com o postgres (que ignora RLS) e só o wabee_owner executa.
create function private.auth_email(p_user uuid, p_only_confirmed boolean default false)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(u.email)) from auth.users u
  where u.id = p_user and (not p_only_confirmed or u.email_confirmed_at is not null);
$$;

create function private.auth_user_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where lower(btrim(u.email)) = lower(btrim(coalesce(p_email, ''))) and u.email_confirmed_at is not null
  limit 1;
$$;

revoke all on function private.auth_email(uuid, boolean), private.auth_user_id(text) from public, anon, authenticated;
grant execute on function private.auth_email(uuid, boolean), private.auth_user_id(text) to wabee_owner;

create or replace function private.my_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.auth_email((select auth.uid()), true);
$$;

-- Views chamam funções com o privilégio de quem consulta (não do dono da view), então a lista de pessoas
-- lê os e-mails por uma view do postgres (só o wabee_owner enxerga), não por função.
create view private.auth_emails as
select u.id, lower(btrim(u.email)) as email from auth.users u;
revoke all on private.auth_emails from public, anon, authenticated;
grant select on private.auth_emails to wabee_owner;

drop view public.v_members;
create view public.v_members as
select m.user_id, m.role, m.active, m.created_at, p.display_name, ae.email
from public.company_members m
left join public.profiles p on p.id = m.user_id
left join private.auth_emails ae on ae.id = m.user_id
where m.company_id = private.company_id();

create or replace function public.invite_member(p_email text)
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
    select 1 from public.company_members m
    where m.company_id = v_company and m.active and private.auth_email(m.user_id) = v_email
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
  if (select count(*) from public.pf_space_members m where m.space_id = v_space) >= 2 then
    raise exception 'O espaço já tem duas pessoas.' using errcode = '22023';
  end if;
  v_user := private.auth_user_id(p_email);
  if v_user is null
     or not private.shares_company(v_user)
     or exists (select 1 from public.pf_space_members m where m.user_id = v_user) then
    raise exception 'Não foi possível adicionar essa pessoa. Ela precisa ter conta no Wabee, participar de uma das suas empresas e não usar outro espaço pessoal.'
      using errcode = '22023';
  end if;
  insert into public.pf_space_members (space_id, user_id) values (v_space, v_user);
  select p.display_name into v_name from public.profiles p where p.id = v_user;
  return jsonb_build_object('user_id', v_user, 'display_name', coalesce(nullif(v_name, ''), btrim(p_email)));
end;
$$;

create or replace function public.pf_members()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', coalesce(nullif(p.display_name, ''), private.auth_email(m.user_id)),
                                        'email', private.auth_email(m.user_id), 'is_me', m.user_id = (select auth.uid())) order by m.added_at)
    from public.pf_space_members m
    left join public.profiles p on p.id = m.user_id
    where m.space_id = v_space), '[]'::jsonb);
end;
$$;

select private.apply_grants();
