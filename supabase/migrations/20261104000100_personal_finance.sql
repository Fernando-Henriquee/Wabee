-- =============================================================================
-- Finanças pessoais (aba "Pessoal"). Dados SEPARADOS da empresa:
--   * tabelas pf_* sem nenhuma chave estrangeira para a Wabee (só para auth.users);
--   * cada espaço (pf_spaces) é visto só por seus membros (no máximo 2, ambos donos);
--   * sem gatilhos de auditoria (audit_logs é lido por dono e leitura);
--   * fora do TRUNCATE de reset_system.
-- Esta migration traz as tabelas, a segurança e o cadastro (espaço, contas, categorias e
-- lançamentos). Parcelas, financiamentos e o valor do dia estão na migration seguinte.
-- =============================================================================

create table public.pf_spaces (
  id bigint generated always as identity primary key,
  name text not null default 'Minhas finanças' check (char_length(btrim(name)) between 1 and 80),
  -- Dia em que o dinheiro costuma entrar: o ciclo vai dele até o dia anterior ao próximo.
  cycle_start_day integer not null default 1 check (cycle_start_day between 1 and 28),
  -- Quanto deve sobrar no fim do ciclo (não entra no valor do dia).
  cycle_reserve numeric(14,2) not null default 0 check (cycle_reserve >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pf_space_members (
  space_id bigint not null references public.pf_spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

-- Cada pessoa usa um único espaço.
create unique index pf_space_members_user_uq on public.pf_space_members (user_id);

create table public.pf_accounts (
  id bigint generated always as identity primary key,
  space_id bigint not null references public.pf_spaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null default 'CONTA' check (kind in ('CONTA', 'CARTEIRA', 'POUPANCA', 'INVESTIMENTO', 'CARTAO')),
  -- Saldo no início de opening_date. No cartão, negativo = quanto está devendo.
  opening_balance numeric(14,2) not null default 0,
  opening_date date not null,
  -- Entra no cálculo do valor do dia (poupança e investimento ficam de fora por padrão).
  in_budget boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index pf_accounts_name_uq on public.pf_accounts (space_id, lower(name));

create table public.pf_categories (
  id bigint generated always as identity primary key,
  space_id bigint not null references public.pf_spaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('GASTO', 'ENTRADA')),
  -- Palavras que a voz associa a esta categoria (mercado, uber…).
  keywords text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index pf_categories_name_uq on public.pf_categories (space_id, kind, lower(name));

create table public.pf_plans (
  id bigint generated always as identity primary key,
  space_id bigint not null references public.pf_spaces (id) on delete cascade,
  kind text not null check (kind in ('CONTA_FIXA', 'ENTRADA_FIXA', 'PARCELADO', 'FINANCIAMENTO')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  account_id bigint references public.pf_accounts (id),
  category_id bigint references public.pf_categories (id),
  -- Valor de cada vencimento (no financiamento Price/SAC é calculado).
  amount numeric(14,2) not null default 0 check (amount >= 0),
  -- Nulo = recorrente sem fim (conta fixa, salário).
  installments_total integer check (installments_total is null or installments_total between 1 and 600),
  first_due date not null,
  status text not null default 'ATIVO' check (status in ('ATIVO', 'ENCERRADO')),
  lender text check (lender is null or char_length(lender) <= 80),
  principal numeric(14,2) check (principal is null or principal > 0),
  down_payment numeric(14,2) check (down_payment is null or down_payment >= 0),
  rate_month numeric(8,6) check (rate_month is null or (rate_month >= 0 and rate_month < 1)),
  system text check (system is null or system in ('PRICE', 'SAC', 'FIXA')),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'FINANCIAMENTO' or (principal is not null and installments_total is not null and system is not null)),
  check (kind in ('CONTA_FIXA', 'ENTRADA_FIXA') or installments_total is not null)
);

create table public.pf_schedule (
  id bigint generated always as identity primary key,
  space_id bigint not null references public.pf_spaces (id) on delete cascade,
  plan_id bigint not null references public.pf_plans (id) on delete cascade,
  number integer not null check (number >= 1),
  due_date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  -- Parte da parcela que é juros (financiamento Price/SAC).
  interest numeric(14,2) check (interest is null or interest >= 0),
  status text not null default 'PREVISTO' check (status in ('PREVISTO', 'PAGO', 'PULADO')),
  transaction_id bigint,
  paid_at timestamptz,
  unique (plan_id, number)
);

create index pf_schedule_due_idx on public.pf_schedule (space_id, due_date);

create table public.pf_transactions (
  id bigint generated always as identity primary key,
  space_id bigint not null references public.pf_spaces (id) on delete cascade,
  kind text not null check (kind in ('GASTO', 'ENTRADA', 'TRANSFERENCIA')),
  account_id bigint not null references public.pf_accounts (id),
  to_account_id bigint references public.pf_accounts (id),
  category_id bigint references public.pf_categories (id),
  amount numeric(14,2) not null check (amount > 0),
  date date not null,
  description text check (description is null or char_length(description) <= 200),
  source text not null default 'MANUAL' check (source in ('MANUAL', 'VOZ')),
  transcript text check (transcript is null or char_length(transcript) <= 500),
  -- Quando o lançamento paga uma parcela ou conta prevista (não conta como gasto do dia).
  schedule_id bigint references public.pf_schedule (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'TRANSFERENCIA' or to_account_id is null),
  check (kind <> 'TRANSFERENCIA' or (to_account_id is not null and to_account_id <> account_id))
);

alter table public.pf_schedule add constraint pf_schedule_transaction_fk foreign key (transaction_id) references public.pf_transactions (id) on delete set null;

create index pf_transactions_date_idx on public.pf_transactions (space_id, date);
create index pf_transactions_account_idx on public.pf_transactions (account_id);

create trigger pf_spaces_touch before update on public.pf_spaces for each row execute function private.touch_updated_at();
create trigger pf_accounts_touch before update on public.pf_accounts for each row execute function private.touch_updated_at();
create trigger pf_categories_touch before update on public.pf_categories for each row execute function private.touch_updated_at();
create trigger pf_plans_touch before update on public.pf_plans for each row execute function private.touch_updated_at();
create trigger pf_transactions_touch before update on public.pf_transactions for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Segurança: só os membros do espaço leem, e só quem é dono
-- -----------------------------------------------------------------------------

alter table public.pf_spaces enable row level security;
alter table public.pf_space_members enable row level security;
alter table public.pf_accounts enable row level security;
alter table public.pf_categories enable row level security;
alter table public.pf_plans enable row level security;
alter table public.pf_schedule enable row level security;
alter table public.pf_transactions enable row level security;

-- A tabela de membros só mostra a própria linha (a outra pessoa vem por pf_members()); assim
-- as demais políticas podem consultá-la sem recursão.
create policy pf_space_members_select on public.pf_space_members for select to authenticated
  using (user_id = (select auth.uid()) and private.has_role(array['dono']));
create policy pf_spaces_select on public.pf_spaces for select to authenticated
  using (private.has_role(array['dono']) and id in (select m.space_id from public.pf_space_members m where m.user_id = (select auth.uid())));
create policy pf_accounts_select on public.pf_accounts for select to authenticated
  using (private.has_role(array['dono']) and space_id in (select m.space_id from public.pf_space_members m where m.user_id = (select auth.uid())));
create policy pf_categories_select on public.pf_categories for select to authenticated
  using (private.has_role(array['dono']) and space_id in (select m.space_id from public.pf_space_members m where m.user_id = (select auth.uid())));
create policy pf_plans_select on public.pf_plans for select to authenticated
  using (private.has_role(array['dono']) and space_id in (select m.space_id from public.pf_space_members m where m.user_id = (select auth.uid())));
create policy pf_schedule_select on public.pf_schedule for select to authenticated
  using (private.has_role(array['dono']) and space_id in (select m.space_id from public.pf_space_members m where m.user_id = (select auth.uid())));
create policy pf_transactions_select on public.pf_transactions for select to authenticated
  using (private.has_role(array['dono']) and space_id in (select m.space_id from public.pf_space_members m where m.user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- Funções internas
-- -----------------------------------------------------------------------------

-- Espaço de quem chama (e confere que é dono).
create function private.pf_space()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space bigint;
begin
  perform private.assert_owner();
  select m.space_id into v_space from public.pf_space_members m where m.user_id = (select auth.uid());
  if v_space is null then
    raise exception 'Abra a aba Pessoal para começar.' using errcode = '22023';
  end if;
  return v_space;
end;
$$;

-- Valida e normaliza os campos de um lançamento. Devolve o necessário para gravar.
create function private.pf_check_tx(p_space bigint, p_kind text, p_account bigint, p_to_account bigint, p_category bigint, p_amount numeric, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.pf_accounts;
  v_category public.pf_categories;
begin
  if p_kind not in ('GASTO', 'ENTRADA', 'TRANSFERENCIA') then
    raise exception 'Tipo de lançamento inválido.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Informe um valor maior que zero.' using errcode = '22023';
  end if;
  if p_date is null or p_date > private.today() then
    raise exception 'A data não pode ser futura. Para compromissos que ainda vão vencer, use Parcelas e contas.' using errcode = '22023';
  end if;
  select * into v_account from public.pf_accounts a where a.id = p_account and a.space_id = p_space;
  if v_account.id is null then
    raise exception 'Conta não encontrada.' using errcode = '22023';
  end if;
  if p_date < v_account.opening_date then
    raise exception 'A data é anterior ao saldo inicial da conta "%" (%).', v_account.name, to_char(v_account.opening_date, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_kind = 'TRANSFERENCIA' then
    if p_to_account is null or p_to_account = p_account then
      raise exception 'Escolha uma conta de destino diferente da origem.' using errcode = '22023';
    end if;
    select * into v_account from public.pf_accounts a where a.id = p_to_account and a.space_id = p_space;
    if v_account.id is null then
      raise exception 'Conta de destino não encontrada.' using errcode = '22023';
    end if;
    if p_date < v_account.opening_date then
      raise exception 'A data é anterior ao saldo inicial da conta "%" (%).', v_account.name, to_char(v_account.opening_date, 'DD/MM/YYYY') using errcode = '22023';
    end if;
  elsif p_category is not null then
    select * into v_category from public.pf_categories c where c.id = p_category and c.space_id = p_space;
    if v_category.id is null then
      raise exception 'Categoria não encontrada.' using errcode = '22023';
    end if;
    if v_category.kind <> p_kind then
      raise exception 'A categoria "%" não serve para %.', v_category.name, lower(p_kind) using errcode = '22023';
    end if;
  end if;
end;
$$;

create function private.pf_insert_tx(p_space bigint, p_tx jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := coalesce(nullif(p_tx ->> 'kind', ''), 'GASTO');
  v_account bigint := nullif(p_tx ->> 'account_id', '')::bigint;
  v_to bigint := nullif(p_tx ->> 'to_account_id', '')::bigint;
  v_category bigint := case when coalesce(nullif(p_tx ->> 'kind', ''), 'GASTO') = 'TRANSFERENCIA' then null else nullif(p_tx ->> 'category_id', '')::bigint end;
  v_amount numeric := round(nullif(p_tx ->> 'amount', '')::numeric, 2);
  v_date date := coalesce(nullif(p_tx ->> 'date', '')::date, private.today());
  v_source text := coalesce(nullif(p_tx ->> 'source', ''), 'MANUAL');
  v_id bigint;
begin
  if v_account is null then
    select a.id into v_account from public.pf_accounts a where a.space_id = p_space and a.active order by a.id limit 1;
  end if;
  if v_source not in ('MANUAL', 'VOZ') then
    raise exception 'Origem do lançamento inválida.' using errcode = '22023';
  end if;
  perform private.pf_check_tx(p_space, v_kind, v_account, v_to, v_category, v_amount, v_date);
  insert into public.pf_transactions (space_id, kind, account_id, to_account_id, category_id, amount, date, description, source, transcript)
  values (p_space, v_kind, v_account, v_to, v_category, v_amount, v_date, nullif(btrim(coalesce(p_tx ->> 'description', '')), ''), v_source,
          nullif(btrim(coalesce(p_tx ->> 'transcript', '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Espaço, pessoas e ajustes
-- -----------------------------------------------------------------------------

-- Cria o espaço de quem chama na primeira vez (com categorias e uma conta iniciais).
create function public.pf_ensure_space()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint;
begin
  perform private.assert_owner();
  select m.space_id into v_space from public.pf_space_members m where m.user_id = (select auth.uid());
  if v_space is not null then
    return v_space;
  end if;
  insert into public.pf_spaces default values returning id into v_space;
  insert into public.pf_space_members (space_id, user_id) values (v_space, (select auth.uid()));
  insert into public.pf_categories (space_id, name, kind, keywords)
  select v_space, c.name, c.kind, c.keywords
  from (values
    ('Mercado', 'GASTO', array['mercado', 'supermercado', 'feira', 'hortifruti', 'padaria', 'acougue', 'atacadao']),
    ('Transporte', 'GASTO', array['uber', '99', 'taxi', 'gasolina', 'combustivel', 'estacionamento', 'onibus', 'metro', 'pedagio']),
    ('Alimentação fora', 'GASTO', array['ifood', 'restaurante', 'lanche', 'pizza', 'cafe', 'almoco', 'jantar', 'hamburguer']),
    ('Moradia', 'GASTO', array['aluguel', 'condominio', 'luz', 'energia', 'agua', 'internet', 'gas']),
    ('Saúde', 'GASTO', array['farmacia', 'remedio', 'medico', 'consulta', 'dentista', 'exame']),
    ('Lazer', 'GASTO', array['cinema', 'bar', 'show', 'viagem', 'jogo', 'passeio']),
    ('Educação', 'GASTO', array['curso', 'livro', 'escola', 'faculdade', 'mensalidade']),
    ('Assinaturas', 'GASTO', array['netflix', 'spotify', 'assinatura', 'youtube', 'prime']),
    ('Outros', 'GASTO', array[]::text[]),
    ('Salário', 'ENTRADA', array['salario', 'pagamento']),
    ('Extra', 'ENTRADA', array['extra', 'freela', 'venda', 'reembolso'])
  ) as c(name, kind, keywords);
  insert into public.pf_accounts (space_id, name, kind, opening_date) values (v_space, 'Conta principal', 'CONTA', private.today());
  return v_space;
end;
$$;

create function public.pf_add_member(p_email text)
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
  if v_user is null or not exists (select 1 from public.app_members m where m.user_id = v_user and m.active and m.role = 'dono') then
    raise exception 'Essa pessoa precisa já ter login no sistema com perfil Dono.' using errcode = '22023';
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

-- Sai do espaço (ou tira a outra pessoa). Quem fica mantém os dados; o último não sai.
create function public.pf_remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
begin
  if (select count(*) from public.pf_space_members m where m.space_id = v_space) < 2 then
    raise exception 'Você é a única pessoa neste espaço.' using errcode = '22023';
  end if;
  delete from public.pf_space_members m where m.space_id = v_space and m.user_id = p_user_id;
  if not found then
    raise exception 'Pessoa não encontrada neste espaço.' using errcode = '22023';
  end if;
end;
$$;

create function public.pf_members()
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
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', coalesce(nullif(p.display_name, ''), u.email), 'email', u.email,
                                        'is_me', m.user_id = (select auth.uid())) order by m.added_at)
    from public.pf_space_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.space_id = v_space), '[]'::jsonb);
end;
$$;

-- p_settings: {name?, cycle_start_day?, cycle_reserve?}
create function public.pf_save_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
begin
  update public.pf_spaces s
     set name = coalesce(nullif(btrim(p_settings ->> 'name'), ''), s.name),
         cycle_start_day = coalesce(nullif(p_settings ->> 'cycle_start_day', '')::integer, s.cycle_start_day),
         cycle_reserve = coalesce(nullif(p_settings ->> 'cycle_reserve', '')::numeric, s.cycle_reserve)
   where s.id = v_space;
end;
$$;

-- p_account: {id?, name, kind, opening_balance, opening_date, in_budget, active}
create function public.pf_save_account(p_account jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_id bigint := nullif(p_account ->> 'id', '')::bigint;
  v_name text := btrim(coalesce(p_account ->> 'name', ''));
  v_kind text := coalesce(nullif(p_account ->> 'kind', ''), 'CONTA');
begin
  if char_length(v_name) = 0 then
    raise exception 'Informe o nome da conta.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.pf_accounts (space_id, name, kind, opening_balance, opening_date, in_budget)
    values (v_space, v_name, v_kind, coalesce(nullif(p_account ->> 'opening_balance', '')::numeric, 0),
            coalesce(nullif(p_account ->> 'opening_date', '')::date, private.today()),
            coalesce((p_account ->> 'in_budget')::boolean, v_kind in ('CONTA', 'CARTEIRA', 'CARTAO')))
    returning id into v_id;
    return v_id;
  end if;
  update public.pf_accounts a
     set name = v_name, kind = v_kind,
         opening_balance = coalesce(nullif(p_account ->> 'opening_balance', '')::numeric, a.opening_balance),
         opening_date = coalesce(nullif(p_account ->> 'opening_date', '')::date, a.opening_date),
         in_budget = coalesce((p_account ->> 'in_budget')::boolean, a.in_budget),
         active = coalesce((p_account ->> 'active')::boolean, a.active)
   where a.id = v_id and a.space_id = v_space;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- p_category: {id?, name, kind, keywords: [..], active}
create function public.pf_save_category(p_category jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_id bigint := nullif(p_category ->> 'id', '')::bigint;
  v_name text := btrim(coalesce(p_category ->> 'name', ''));
  v_keywords text[];
begin
  if char_length(v_name) = 0 then
    raise exception 'Informe o nome da categoria.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct lower(btrim(k))) filter (where btrim(k) <> ''), '{}')
    into v_keywords from jsonb_array_elements_text(coalesce(p_category -> 'keywords', '[]'::jsonb)) k;
  if v_id is null then
    insert into public.pf_categories (space_id, name, kind, keywords)
    values (v_space, v_name, coalesce(nullif(p_category ->> 'kind', ''), 'GASTO'), v_keywords)
    returning id into v_id;
    return v_id;
  end if;
  update public.pf_categories c
     set name = v_name, keywords = v_keywords, active = coalesce((p_category ->> 'active')::boolean, c.active)
   where c.id = v_id and c.space_id = v_space;
  if not found then
    raise exception 'Categoria não encontrada.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lançamentos
-- -----------------------------------------------------------------------------

-- p_txs: um lançamento ou uma lista (vários gastos de uma frase falada):
-- {kind?, account_id?, to_account_id?, category_id?, amount, date?, description?, source?, transcript?}
create function public.pf_add_transaction(p_request_id uuid, p_txs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_done jsonb;
  v_items jsonb;
  v_item jsonb;
  v_ids bigint[] := '{}';
begin
  v_done := private.idem_begin(p_request_id, 'pf_add_transaction');
  if v_done is not null then
    return v_done;
  end if;
  v_items := case when jsonb_typeof(p_txs) = 'array' then p_txs else jsonb_build_array(p_txs) end;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'Nada para lançar.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_ids := v_ids || private.pf_insert_tx(v_space, v_item);
  end loop;
  return private.idem_finish(p_request_id, jsonb_build_object('ids', to_jsonb(v_ids)));
end;
$$;

create function public.pf_update_transaction(p_id bigint, p_tx jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_old public.pf_transactions;
  v_kind text;
  v_account bigint;
  v_to bigint;
  v_category bigint;
  v_amount numeric;
  v_date date;
begin
  select * into v_old from public.pf_transactions t where t.id = p_id and t.space_id = v_space for update;
  if v_old.id is null then
    raise exception 'Lançamento não encontrado.' using errcode = '22023';
  end if;
  v_kind := coalesce(nullif(p_tx ->> 'kind', ''), v_old.kind);
  v_account := coalesce(nullif(p_tx ->> 'account_id', '')::bigint, v_old.account_id);
  v_to := case when v_kind = 'TRANSFERENCIA' then coalesce(nullif(p_tx ->> 'to_account_id', '')::bigint, v_old.to_account_id) end;
  v_category := case when v_kind = 'TRANSFERENCIA' then null when p_tx ? 'category_id' then nullif(p_tx ->> 'category_id', '')::bigint else v_old.category_id end;
  v_amount := round(coalesce(nullif(p_tx ->> 'amount', '')::numeric, v_old.amount), 2);
  v_date := coalesce(nullif(p_tx ->> 'date', '')::date, v_old.date);
  perform private.pf_check_tx(v_space, v_kind, v_account, v_to, v_category, v_amount, v_date);
  update public.pf_transactions
     set kind = v_kind, account_id = v_account, to_account_id = v_to, category_id = v_category, amount = v_amount, date = v_date,
         description = case when p_tx ? 'description' then nullif(btrim(coalesce(p_tx ->> 'description', '')), '') else description end
   where id = p_id;
end;
$$;

-- Apaga o lançamento. Se pagava uma parcela ou conta prevista, ela volta a "prevista".
create function public.pf_delete_transaction(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
begin
  update public.pf_schedule s set status = 'PREVISTO', transaction_id = null, paid_at = null
   where s.transaction_id = p_id and s.space_id = v_space;
  delete from public.pf_transactions t where t.id = p_id and t.space_id = v_space;
  if not found then
    raise exception 'Lançamento não encontrado.' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Leitura para as telas (com nomes), sob a mesma RLS das tabelas
-- -----------------------------------------------------------------------------

create view public.v_pf_transactions with (security_invoker = true) as
select t.id, t.kind, t.account_id, a.name as account_name, t.to_account_id, ta.name as to_account_name, t.category_id, c.name as category_name,
       t.amount, t.date, t.description, t.source, t.transcript, t.schedule_id, t.created_at
from public.pf_transactions t
join public.pf_accounts a on a.id = t.account_id
left join public.pf_accounts ta on ta.id = t.to_account_id
left join public.pf_categories c on c.id = t.category_id;

select private.apply_grants();
