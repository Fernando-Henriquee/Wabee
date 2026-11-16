-- =============================================================================
-- Wabee — Aprovação manual de contas novas
--
-- Em vez de depender de e-mail de confirmação, toda conta criada pela tela "Criar conta" fica
-- PENDENTE até um administrador da plataforma aprovar (página "Cadastros" no app). Conta pendente
-- não cria empresa, não aceita convite e não usa finanças pessoais: não consegue fazer nada.
--
--   * Contas que já existem ficam APROVADAS.
--   * Contas criadas por convite do Supabase (invited_at preenchido pelo servidor, a partir de um
--     convite de dono de empresa) já nascem aprovadas.
--   * O administrador inicial é a conta storewabee@gmail.com; outros entram em platform_admins.
--
-- Atenção: com a confirmação de e-mail desligada no Supabase, o e-mail digitado no cadastro não é
-- verificado. Quem aprova é quem garante que a pessoa é quem diz ser.
-- =============================================================================

create table public.account_approvals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  display_name text,
  requested_company text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);

create index account_approvals_status_idx on public.account_approvals (status, created_at);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.account_approvals enable row level security;
alter table public.platform_admins enable row level security;

-- Cada pessoa lê só o próprio status; o resto passa pelas RPCs de administração.
create policy account_approvals_select on public.account_approvals for select to authenticated
  using (user_id = (select auth.uid()));

-- Contas que já existem ficam aprovadas.
insert into public.account_approvals (user_id, status, display_name, decided_at)
select u.id, 'aprovado', left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(u.email, ''), '@', 1)), 80), now()
from auth.users u
on conflict (user_id) do nothing;

insert into public.platform_admins (user_id)
select u.id from auth.users u where lower(u.email) = 'storewabee@gmail.com'
on conflict (user_id) do nothing;

-- Toda conta nova nasce pendente (ou aprovada, se veio de convite do Supabase).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 80);
begin
  insert into public.profiles (id, display_name) values (new.id, v_name) on conflict (id) do nothing;
  insert into public.account_approvals (user_id, status, display_name, requested_company, decided_at)
  values (
    new.id,
    case when new.invited_at is not null then 'aprovado' else 'pendente' end,
    v_name,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'company_name', '')), 120), ''),
    case when new.invited_at is not null then now() end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create function private.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.account_approvals a where a.user_id = (select auth.uid()) and a.status = 'aprovado');
$$;

create function private.assert_platform_admin()
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
  if not exists (select 1 from public.platform_admins p where p.user_id = (select auth.uid())) then
    raise exception 'Só o administrador da plataforma pode fazer isso.' using errcode = '42501';
  end if;
end;
$$;

create function public.my_account_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.status from public.account_approvals a where a.user_id = (select auth.uid())), 'pendente');
$$;

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins p where p.user_id = (select auth.uid()));
$$;

create function public.admin_pending_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  return jsonb_build_object(
    'pendentes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', a.user_id, 'email', private.auth_email(a.user_id), 'name', a.display_name,
        'company', a.requested_company, 'created_at', a.created_at) order by a.created_at)
      from public.account_approvals a where a.status = 'pendente'), '[]'::jsonb),
    'decididas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', d.user_id, 'email', private.auth_email(d.user_id), 'name', d.display_name,
        'company', d.requested_company, 'status', d.status, 'decided_at', d.decided_at) order by d.decided_at desc)
      from (select * from public.account_approvals where status <> 'pendente' and decided_at is not null order by decided_at desc limit 15) d), '[]'::jsonb));
end;
$$;

create function public.admin_decide_account(p_user_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin();
  if not p_approve and exists (select 1 from public.platform_admins p where p.user_id = p_user_id) then
    raise exception 'Não é possível recusar um administrador da plataforma.' using errcode = '22023';
  end if;
  update public.account_approvals
     set status = case when p_approve then 'aprovado' else 'recusado' end, decided_at = now(), decided_by = (select auth.uid())
   where user_id = p_user_id;
  if not found then
    raise exception 'Cadastro não encontrado.' using errcode = '22023';
  end if;
end;
$$;

-- Conta pendente (ou recusada) não faz nada: sem empresa, sem convite, sem finanças pessoais.
create or replace function public.create_company(p_name text)
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
  if not private.is_approved() then
    raise exception 'Seu cadastro ainda não foi aprovado.' using errcode = '42501';
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

create or replace function public.accept_invite(p_invite_id uuid)
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
  if not private.is_approved() then
    raise exception 'Seu cadastro ainda não foi aprovado.' using errcode = '42501';
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

create or replace function public.my_pending_invites()
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
  where i.status = 'pendente' and i.email = private.my_email() and private.is_approved();
$$;

create or replace function private.assert_personal()
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
  if not private.is_approved() then
    raise exception 'Seu cadastro ainda não foi aprovado.' using errcode = '42501';
  end if;
end;
$$;

select private.apply_grants();
