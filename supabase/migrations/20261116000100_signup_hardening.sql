-- =============================================================================
-- Wabee — Cadastro aberto (criar conta): endurecimento
--
-- Com qualquer pessoa podendo criar conta, duas coisas deixam de ser "entre conhecidos":
--   1. Convites são entregues pelo e-mail da conta. Só vale e-mail CONFIRMADO: sem isso, quem
--      cadastrasse o e-mail de outra pessoa poderia aceitar o convite dela e entrar na empresa.
--   2. Finanças pessoais: adicionar a segunda pessoa só vale para quem participa de uma das
--      empresas de quem adiciona (como era antes, quando todos eram da mesma empresa), e a
--      resposta é a mesma para qualquer falha, para não revelar quais e-mails têm conta.
-- =============================================================================

create or replace function private.my_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(u.email)) from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
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
  select u.id into v_user from auth.users u
   where lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.email_confirmed_at is not null;
  if v_user is null
     or not private.shares_company(v_user)
     or exists (select 1 from public.pf_space_members m where m.user_id = v_user) then
    raise exception 'Não foi possível adicionar essa pessoa. Ela precisa ter conta no Wabee, participar de uma das suas empresas e não usar outro espaço pessoal.'
      using errcode = '22023';
  end if;
  insert into public.pf_space_members (space_id, user_id) values (v_space, v_user);
  select p.display_name into v_name from public.profiles p where p.id = v_user;
  return jsonb_build_object('user_id', v_user, 'display_name', coalesce(nullif(v_name, ''), p_email));
end;
$$;

select private.apply_grants();
