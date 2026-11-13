-- =============================================================================
-- Finanças pessoais: ajuste de saldo e limite do cartão.
--
-- Em vez de lançar gasto a gasto, a pessoa informa quanto tem em cada conta (e quanto deve em cada
-- cartão) e o app calcula a diferença. A diferença vira um lançamento AJUSTE, com valor COM SINAL:
--   * não é gasto nem entrada (fora do resumo por categoria e do "gasto de hoje");
--   * vale desde o INÍCIO do dia em que foi feito, então o valor do dia (pf_budget) já parte do
--     saldo informado e divide pelos dias que faltam no ciclo.
-- O cartão ganha limite (credit_limit); o que se deve nele continua sendo o saldo negativo da conta.
-- =============================================================================

alter table public.pf_transactions drop constraint if exists pf_transactions_kind_check;
alter table public.pf_transactions add constraint pf_transactions_kind_check check (kind in ('GASTO', 'ENTRADA', 'TRANSFERENCIA', 'AJUSTE'));
alter table public.pf_transactions drop constraint if exists pf_transactions_amount_check;
alter table public.pf_transactions add constraint pf_transactions_amount_check check (amount > 0 or (kind = 'AJUSTE' and amount <> 0));

alter table public.pf_accounts add column credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0);

-- -----------------------------------------------------------------------------
-- Saldo
-- -----------------------------------------------------------------------------

-- Saldo, no início de p_date, das contas que entram no cálculo. Ajuste vale desde o início do próprio dia.
create or replace function private.pf_balance_before(p_space bigint, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(x.delta), 0) from (
    select a.opening_balance as delta
      from public.pf_accounts a
     where a.space_id = p_space and a.in_budget and a.opening_date <= p_date
    union all
    select case when t.kind in ('ENTRADA', 'AJUSTE') then t.amount else -t.amount end
      from public.pf_transactions t join public.pf_accounts a on a.id = t.account_id
     where t.space_id = p_space and a.in_budget and t.date >= a.opening_date
       and (t.date < p_date or (t.kind = 'AJUSTE' and t.date = p_date))
    union all
    select t.amount
      from public.pf_transactions t join public.pf_accounts a on a.id = t.to_account_id
     where t.space_id = p_space and t.kind = 'TRANSFERENCIA' and a.in_budget and t.date < p_date and t.date >= a.opening_date
  ) x;
$$;

-- Saldo de UMA conta até p_through (inclusive).
create function private.pf_account_balance(p_space bigint, p_account bigint, p_through date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.opening_balance from public.pf_accounts a where a.id = p_account and a.space_id = p_space), 0)
       + coalesce((select sum(case when t.kind in ('ENTRADA', 'AJUSTE') then t.amount else -t.amount end)
                     from public.pf_transactions t join public.pf_accounts a on a.id = t.account_id
                    where t.space_id = p_space and t.account_id = p_account and t.date between a.opening_date and p_through), 0)
       + coalesce((select sum(t.amount)
                     from public.pf_transactions t join public.pf_accounts a on a.id = t.to_account_id
                    where t.space_id = p_space and t.kind = 'TRANSFERENCIA' and t.to_account_id = p_account
                      and t.date between a.opening_date and p_through), 0);
$$;

-- Saldo de hoje de cada conta ativa e quando foi ajustado pela última vez.
create function public.pf_account_balances()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_today date := private.today();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'account_id', a.id,
             'balance', private.pf_account_balance(v_space, a.id, v_today),
             'last_adjusted_at', (select max(t.created_at) from public.pf_transactions t where t.account_id = a.id and t.kind = 'AJUSTE'))
           order by a.id)
      from public.pf_accounts a where a.space_id = v_space and a.active), '[]'::jsonb);
end;
$$;

-- p_items: [{account_id, target}] — target é o saldo que a conta deve ter agora (no cartão, o negativo do que se deve).
-- Só grava o que mudou. Devolve {adjusted: quantos}.
create function public.pf_adjust_balances(p_request_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_today date := private.today();
  v_done jsonb;
  v_item jsonb;
  v_account public.pf_accounts;
  v_target numeric;
  v_delta numeric;
  v_count integer := 0;
begin
  v_done := private.idem_begin(p_request_id, 'pf_adjust_balances');
  if v_done is not null then
    return v_done;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nada para ajustar.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_account from public.pf_accounts a
     where a.id = nullif(v_item ->> 'account_id', '')::bigint and a.space_id = v_space and a.active;
    if v_account.id is null then
      raise exception 'Conta não encontrada.' using errcode = '22023';
    end if;
    if nullif(v_item ->> 'target', '') is null then
      raise exception 'Informe o saldo de "%".', v_account.name using errcode = '22023';
    end if;
    v_target := round((v_item ->> 'target')::numeric, 2);
    if v_account.opening_date > v_today then
      raise exception 'O saldo inicial da conta "%" é de %, depois de hoje. Mude a data do saldo em Ajustes.', v_account.name, to_char(v_account.opening_date, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    v_delta := round(v_target - private.pf_account_balance(v_space, v_account.id, v_today), 2);
    if v_delta <> 0 then
      insert into public.pf_transactions (space_id, kind, account_id, amount, date, description)
      values (v_space, 'AJUSTE', v_account.id, v_delta, v_today, 'Ajuste de saldo');
      v_count := v_count + 1;
    end if;
  end loop;
  return private.idem_finish(p_request_id, jsonb_build_object('adjusted', v_count));
end;
$$;

-- -----------------------------------------------------------------------------
-- Contas (com limite do cartão) e lançamentos
-- -----------------------------------------------------------------------------

-- p_account: {id?, name, kind, opening_balance, opening_date, in_budget, active, credit_limit?}
create or replace function public.pf_save_account(p_account jsonb)
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
  v_limit numeric := round(nullif(p_account ->> 'credit_limit', '')::numeric, 2);
begin
  if char_length(v_name) = 0 then
    raise exception 'Informe o nome da conta.' using errcode = '22023';
  end if;
  if v_limit is not null and v_limit < 0 then
    raise exception 'O limite não pode ser negativo.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.pf_accounts (space_id, name, kind, opening_balance, opening_date, in_budget, credit_limit)
    values (v_space, v_name, v_kind, coalesce(nullif(p_account ->> 'opening_balance', '')::numeric, 0),
            coalesce(nullif(p_account ->> 'opening_date', '')::date, private.today()),
            coalesce((p_account ->> 'in_budget')::boolean, v_kind in ('CONTA', 'CARTEIRA', 'CARTAO')),
            case when v_kind = 'CARTAO' then v_limit end)
    returning id into v_id;
    return v_id;
  end if;
  update public.pf_accounts a
     set name = v_name, kind = v_kind,
         opening_balance = coalesce(nullif(p_account ->> 'opening_balance', '')::numeric, a.opening_balance),
         opening_date = coalesce(nullif(p_account ->> 'opening_date', '')::date, a.opening_date),
         in_budget = coalesce((p_account ->> 'in_budget')::boolean, a.in_budget),
         active = coalesce((p_account ->> 'active')::boolean, a.active),
         credit_limit = case when v_kind <> 'CARTAO' then null when p_account ? 'credit_limit' then v_limit else a.credit_limit end
   where a.id = v_id and a.space_id = v_space;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- Ajuste de saldo não se edita: apague ou faça outro ajuste.
create or replace function public.pf_update_transaction(p_id bigint, p_tx jsonb)
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
  if v_old.kind = 'AJUSTE' then
    raise exception 'Ajuste de saldo não se edita. Apague-o ou faça um novo ajuste.' using errcode = '22023';
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

-- -----------------------------------------------------------------------------
-- Resumo e calendário: ajustes aparecem à parte
-- -----------------------------------------------------------------------------

create or replace function public.pf_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
begin
  return jsonb_build_object(
    'spent', coalesce((select sum(t.amount) from public.pf_transactions t where t.space_id = v_space and t.kind = 'GASTO' and t.date between p_from and p_to), 0),
    'spent_daily', coalesce((select sum(t.amount) from public.pf_transactions t where t.space_id = v_space and t.kind = 'GASTO' and t.schedule_id is null and t.date between p_from and p_to), 0),
    'income', coalesce((select sum(t.amount) from public.pf_transactions t where t.space_id = v_space and t.kind = 'ENTRADA' and t.date between p_from and p_to), 0),
    'adjustments', coalesce((select sum(t.amount) from public.pf_transactions t where t.space_id = v_space and t.kind = 'AJUSTE' and t.date between p_from and p_to), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', x.category_id, 'name', x.name, 'total', x.total) order by x.total desc)
      from (select t.category_id, coalesce(c.name, 'Sem categoria') as name, sum(t.amount) as total
              from public.pf_transactions t left join public.pf_categories c on c.id = t.category_id
             where t.space_id = v_space and t.kind = 'GASTO' and t.date between p_from and p_to
             group by t.category_id, c.name) x), '[]'::jsonb));
end;
$$;

create or replace function public.pf_calendar(p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_today date := private.today();
  v_first date := date_trunc('month', coalesce(p_month, private.today()))::date;
  v_last date;
  v_start_day integer;
  v_first_open date;
  v_today_day jsonb;
  v_days jsonb := '[]'::jsonb;
  d date;
  v_allowance numeric;
begin
  perform private.pf_sync(v_space);
  v_last := (v_first + interval '1 month')::date - 1;
  select s.cycle_start_day into v_start_day from public.pf_spaces s where s.id = v_space;
  select min(a.opening_date) into v_first_open from public.pf_accounts a where a.space_id = v_space and a.in_budget;
  v_today_day := private.pf_day(v_space, v_today);
  for d in select g::date from generate_series(v_first, v_last, interval '1 day') g loop
    v_allowance := case
      when v_first_open is null or d < v_first_open then null
      when d <= v_today then (private.pf_day(v_space, d) ->> 'allowance')::numeric
      when d <= (v_today_day ->> 'cycle_end')::date then (v_today_day ->> 'allowance')::numeric
      else null end;
    v_days := v_days || jsonb_build_object(
      'date', d,
      'is_future', d > v_today,
      'is_cycle_start', extract(day from d)::integer = v_start_day,
      'spent', private.pf_spent(v_space, d),
      'income', coalesce((select sum(t.amount) from public.pf_transactions t where t.space_id = v_space and t.kind = 'ENTRADA' and t.date = d), 0),
      'paid_bills', coalesce((select sum(t.amount) from public.pf_transactions t where t.space_id = v_space and t.kind = 'GASTO' and t.schedule_id is not null and t.date = d), 0),
      'adjust', coalesce((select sum(t.amount) from public.pf_transactions t join public.pf_accounts a on a.id = t.account_id
                           where t.space_id = v_space and t.kind = 'AJUSTE' and a.in_budget and t.date = d), 0),
      'allowance', v_allowance,
      'bills', coalesce((select jsonb_agg(jsonb_build_object('schedule_id', s.id, 'name', p.name, 'kind', p.kind, 'amount', s.amount, 'status', s.status) order by s.id)
                           from public.pf_schedule s join public.pf_plans p on p.id = s.plan_id where s.space_id = v_space and s.due_date = d), '[]'::jsonb));
  end loop;
  return jsonb_build_object('today', v_today, 'cycle_start', v_today_day -> 'cycle_start', 'cycle_end', v_today_day -> 'cycle_end', 'days', v_days);
end;
$$;

select private.apply_grants();
