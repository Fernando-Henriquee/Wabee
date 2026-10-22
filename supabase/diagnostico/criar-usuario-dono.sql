-- =============================================================================
-- Wabee — criar (ou redefinir) a conta do dono direto pelo banco.
-- Onde rodar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Troque os 3 valores abaixo. Depois de rodar, apague a senha do editor e, se
-- quiser, troque-a no app em "Meu perfil".
-- Alternativa sem SQL: Authentication → Users → Add user → Create new user
-- (marque "Auto Confirm User") e depois `npm run member:add -- <email> dono`.
-- =============================================================================
do $$
declare
  v_email text := 'seu-email@exemplo.com';
  v_password text := 'troque-esta-senha';
  v_name text := 'Seu nome';
  v_id uuid;
begin
  if char_length(v_password) < 8 then
    raise exception 'Use uma senha com pelo menos 8 caracteres.';
  end if;
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    )
    values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', lower(v_email),
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', v_name),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', lower(v_email), 'email_verified', true), 'email', now(), now(), now());
  else
    -- Conta já existe: só redefine a senha e confirma o e-mail.
    update auth.users
       set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = v_id;
  end if;
  insert into public.app_members (user_id, role, active) values (v_id, 'dono', true)
  on conflict (user_id) do update set role = 'dono', active = true;
  insert into public.profiles (id, display_name) values (v_id, v_name)
  on conflict (id) do update set display_name = excluded.display_name;
  raise notice 'Conta % pronta como dono.', v_email;
end $$;
