-- =============================================================================
-- Finanças pessoais: contas fixas, parcelados e financiamentos (pf_plans/pf_schedule) e o
-- valor que se pode gastar por dia (pf_budget) com o calendário (pf_calendar).
--
-- Valor do dia, para um dia d dentro de um ciclo (do dia do salário ao dia anterior ao próximo):
--   disponível(d) = saldo no início de d nas contas do cálculo
--                 + entradas de d até o fim do ciclo (previstas e recebidas)
--                 − compromissos (contas e parcelas previstas até o fim do ciclo, inclusive as
--                   atrasadas, e as já pagas com data a partir de d)
--                 − reserva do ciclo
--   limite(d) = max(disponível(d), 0) ÷ dias de d até o fim do ciclo (contando d)
-- O que não é gasto num dia aumenta o saldo do seguinte, então o limite sobe sozinho.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funções internas
-- -----------------------------------------------------------------------------

-- Vencimento k meses depois de p_first, mantendo o dia (ou o último dia do mês).
create function private.pf_due_date(p_first date, p_k integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', p_first)::date + make_interval(months => p_k))::date
         + (least(extract(day from p_first)::integer,
                  extract(day from (date_trunc('month', p_first) + make_interval(months => p_k + 1) - interval '1 day'))::integer) - 1);
$$;

create function private.pf_cycle(p_space bigint, p_date date, out cycle_start date, out cycle_end date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day integer;
begin
  select s.cycle_start_day into v_day from public.pf_spaces s where s.id = p_space;
  if extract(day from p_date)::integer >= v_day then
    cycle_start := make_date(extract(year from p_date)::integer, extract(month from p_date)::integer, v_day);
  else
    cycle_start := (make_date(extract(year from p_date)::integer, extract(month from p_date)::integer, v_day) - interval '1 month')::date;
  end if;
  cycle_end := (cycle_start + interval '1 month')::date - 1;
end;
$$;

-- Saldo, no início de p_date, das contas que entram no cálculo.
create function private.pf_balance_before(p_space bigint, p_date date)
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
    select case when t.kind = 'ENTRADA' then t.amount else -t.amount end
      from public.pf_transactions t join public.pf_accounts a on a.id = t.account_id
     where t.space_id = p_space and a.in_budget and t.date < p_date and t.date >= a.opening_date
    union all
    select t.amount
      from public.pf_transactions t join public.pf_accounts a on a.id = t.to_account_id
     where t.space_id = p_space and t.kind = 'TRANSFERENCIA' and a.in_budget and t.date < p_date and t.date >= a.opening_date
  ) x;
$$;

-- Entradas de p_from até p_to: recebidas (lançamentos) e previstas ainda não recebidas.
create function private.pf_incomes(p_space bigint, p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(t.amount) from public.pf_transactions t
                    where t.space_id = p_space and t.kind = 'ENTRADA' and t.date between p_from and p_to), 0)
       + coalesce((select sum(s.amount) from public.pf_schedule s join public.pf_plans p on p.id = s.plan_id
                    where s.space_id = p_space and p.kind = 'ENTRADA_FIXA' and s.status = 'PREVISTO' and s.due_date between p_from and p_to), 0);
$$;

-- Compromissos até p_to: previstos (inclusive atrasados) e já pagos com data a partir de p_from.
create function private.pf_commitments(p_space bigint, p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(s.amount) from public.pf_schedule s join public.pf_plans p on p.id = s.plan_id
                    where s.space_id = p_space and p.kind <> 'ENTRADA_FIXA' and s.status = 'PREVISTO' and s.due_date <= p_to), 0)
       + coalesce((select sum(t.amount) from public.pf_transactions t
                    where t.space_id = p_space and t.kind = 'GASTO' and t.schedule_id is not null and t.date between p_from and p_to), 0);
$$;

-- Gasto do dia a dia: o que não paga conta nem parcela cadastrada.
create function private.pf_spent(p_space bigint, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(t.amount), 0) from public.pf_transactions t
   where t.space_id = p_space and t.kind = 'GASTO' and t.schedule_id is null and t.date = p_date;
$$;

-- Os números do valor do dia para uma data.
create function private.pf_day(p_space bigint, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cycle record;
  v_balance numeric;
  v_incomes numeric;
  v_commitments numeric;
  v_reserve numeric;
  v_available numeric;
  v_days integer;
begin
  select * into v_cycle from private.pf_cycle(p_space, p_date);
  v_balance := private.pf_balance_before(p_space, p_date);
  v_incomes := private.pf_incomes(p_space, p_date, v_cycle.cycle_end);
  v_commitments := private.pf_commitments(p_space, p_date, v_cycle.cycle_end);
  select s.cycle_reserve into v_reserve from public.pf_spaces s where s.id = p_space;
  v_available := v_balance + v_incomes - v_commitments - v_reserve;
  v_days := v_cycle.cycle_end - p_date + 1;
  return jsonb_build_object(
    'date', p_date, 'cycle_start', v_cycle.cycle_start, 'cycle_end', v_cycle.cycle_end, 'days_left', v_days,
    'balance', v_balance, 'incomes', v_incomes, 'commitments', v_commitments, 'reserve', v_reserve,
    'available', v_available, 'allowance', round(greatest(v_available, 0) / v_days, 2));
end;
$$;

-- Parcelas de um financiamento. PRICE: parcela fixa; SAC: amortização fixa; FIXA: valor informado.
-- A última parcela absorve o arredondamento e zera o saldo devedor.
create function private.pf_amortization(p_system text, p_principal numeric, p_rate numeric, p_n integer, p_fixed numeric)
returns table (installment integer, payment numeric, interest numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_balance numeric := p_principal;
  v_rate numeric := coalesce(p_rate, 0);
  v_pmt numeric;
  v_interest numeric;
  v_amort numeric;
  v_pay numeric;
  k integer;
begin
  if p_system = 'PRICE' then
    v_pmt := case when v_rate = 0 then p_principal / p_n else p_principal * v_rate / (1 - power(1 + v_rate, -p_n)) end;
  end if;
  for k in 1..p_n loop
    v_interest := round(v_balance * v_rate, 2);
    if p_system = 'PRICE' then
      v_pay := case when k = p_n then v_balance + v_interest else round(v_pmt, 2) end;
    elsif p_system = 'SAC' then
      v_amort := case when k = p_n then v_balance else round(p_principal / p_n, 2) end;
      v_pay := v_amort + v_interest;
    else
      v_pay := p_fixed;
      v_interest := null;
    end if;
    installment := k;
    payment := v_pay;
    interest := v_interest;
    return next;
    if v_interest is not null then
      v_balance := v_balance - (v_pay - v_interest);
    end if;
  end loop;
end;
$$;

-- Gera os vencimentos das contas e entradas recorrentes até 90 dias além do fim do ciclo.
create function private.pf_sync(p_space bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.today();
  v_cycle record;
  v_horizon date;
  v_plan public.pf_plans;
  v_k integer;
  v_due date;
  v_created integer := 0;
begin
  select * into v_cycle from private.pf_cycle(p_space, v_today);
  v_horizon := v_cycle.cycle_end + 90;
  for v_plan in select * from public.pf_plans p where p.space_id = p_space and p.status = 'ATIVO' and p.kind in ('CONTA_FIXA', 'ENTRADA_FIXA') loop
    v_k := 0;
    loop
      exit when v_k >= 1200 or (v_plan.installments_total is not null and v_k >= v_plan.installments_total);
      v_due := private.pf_due_date(v_plan.first_due, v_k);
      exit when v_due > v_horizon;
      -- Meses anteriores ao ciclo atual não geram vencimento (o histórico fica no saldo inicial).
      if v_due >= greatest(v_plan.first_due, v_cycle.cycle_start) then
        insert into public.pf_schedule (space_id, plan_id, number, due_date, amount)
        values (p_space, v_plan.id, v_k + 1, v_due, v_plan.amount)
        on conflict (plan_id, number) do nothing;
        if found then
          v_created := v_created + 1;
        end if;
      end if;
      v_k := v_k + 1;
    end loop;
  end loop;
  return v_created;
end;
$$;

-- -----------------------------------------------------------------------------
-- Planos e vencimentos
-- -----------------------------------------------------------------------------

-- p_plan: {id?, kind, name, account_id?, category_id?, amount, installments_total?, first_due, paid_count?,
--          lender?, principal?, down_payment?, rate_month?, system?, notes?}
-- Criar: CONTA_FIXA/ENTRADA_FIXA recorrem todo mês; PARCELADO e FINANCIAMENTO nascem com todas as parcelas
-- (paid_count marca as primeiras como já pagas, sem mexer em saldo). Editar: nome, conta, categoria, observação
-- e, nas recorrentes, o valor dos próximos vencimentos.
create function public.pf_save_plan(p_plan jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_id bigint := nullif(p_plan ->> 'id', '')::bigint;
  v_kind text := p_plan ->> 'kind';
  v_name text := btrim(coalesce(p_plan ->> 'name', ''));
  v_account bigint := nullif(p_plan ->> 'account_id', '')::bigint;
  v_category bigint := nullif(p_plan ->> 'category_id', '')::bigint;
  v_amount numeric := round(coalesce(nullif(p_plan ->> 'amount', '')::numeric, 0), 2);
  v_total integer := nullif(p_plan ->> 'installments_total', '')::integer;
  v_first date := nullif(p_plan ->> 'first_due', '')::date;
  v_paid integer := coalesce(nullif(p_plan ->> 'paid_count', '')::integer, 0);
  v_principal numeric := round(nullif(p_plan ->> 'principal', '')::numeric, 2);
  v_rate numeric := coalesce(nullif(p_plan ->> 'rate_month', '')::numeric, 0);
  v_system text := coalesce(nullif(p_plan ->> 'system', ''), 'PRICE');
  v_cat_kind text;
  v_cat_expected text;
  v_old public.pf_plans;
  r record;
begin
  if char_length(v_name) = 0 then
    raise exception 'Informe o nome.' using errcode = '22023';
  end if;
  if v_account is not null and not exists (select 1 from public.pf_accounts a where a.id = v_account and a.space_id = v_space) then
    raise exception 'Conta não encontrada.' using errcode = '22023';
  end if;

  if v_id is not null then
    select * into v_old from public.pf_plans p where p.id = v_id and p.space_id = v_space for update;
    if v_old.id is null then
      raise exception 'Cadastro não encontrado.' using errcode = '22023';
    end if;
    v_kind := v_old.kind;
  end if;
  if v_kind not in ('CONTA_FIXA', 'ENTRADA_FIXA', 'PARCELADO', 'FINANCIAMENTO') then
    raise exception 'Tipo de cadastro inválido.' using errcode = '22023';
  end if;
  if v_category is not null then
    v_cat_expected := case when v_kind = 'ENTRADA_FIXA' then 'ENTRADA' else 'GASTO' end;
    select c.kind into v_cat_kind from public.pf_categories c where c.id = v_category and c.space_id = v_space;
    if v_cat_kind is null or v_cat_kind <> v_cat_expected then
      raise exception 'Categoria inválida para este cadastro.' using errcode = '22023';
    end if;
  end if;

  if v_id is not null then
    update public.pf_plans p
       set name = v_name, account_id = v_account, category_id = v_category,
           lender = case when p_plan ? 'lender' then nullif(btrim(p_plan ->> 'lender'), '') else p.lender end,
           notes = case when p_plan ? 'notes' then nullif(btrim(p_plan ->> 'notes'), '') else p.notes end,
           amount = case when p.kind in ('CONTA_FIXA', 'ENTRADA_FIXA') and p_plan ? 'amount' then v_amount else p.amount end
     where p.id = v_id;
    if v_old.kind in ('CONTA_FIXA', 'ENTRADA_FIXA') and p_plan ? 'amount' then
      if v_amount <= 0 then
        raise exception 'Informe o valor.' using errcode = '22023';
      end if;
      update public.pf_schedule s set amount = v_amount where s.plan_id = v_id and s.status = 'PREVISTO' and s.due_date >= private.today();
    end if;
    return v_id;
  end if;

  if v_first is null then
    raise exception 'Informe a data do primeiro vencimento.' using errcode = '22023';
  end if;
  if v_kind in ('CONTA_FIXA', 'ENTRADA_FIXA') then
    if v_amount <= 0 then
      raise exception 'Informe o valor.' using errcode = '22023';
    end if;
  elsif v_total is null or v_total < 1 then
    raise exception 'Informe o número de parcelas.' using errcode = '22023';
  end if;
  if v_paid < 0 or (v_total is not null and v_paid > v_total) then
    raise exception 'As parcelas já pagas não podem passar do total.' using errcode = '22023';
  end if;

  if v_kind = 'PARCELADO' then
    if v_amount <= 0 then
      raise exception 'Informe o valor da parcela.' using errcode = '22023';
    end if;
    insert into public.pf_plans (space_id, kind, name, account_id, category_id, amount, installments_total, first_due, notes)
    values (v_space, v_kind, v_name, v_account, v_category, v_amount, v_total, v_first, nullif(btrim(p_plan ->> 'notes'), ''))
    returning id into v_id;
    insert into public.pf_schedule (space_id, plan_id, number, due_date, amount, status, paid_at)
    select v_space, v_id, k, private.pf_due_date(v_first, k - 1), v_amount, case when k <= v_paid then 'PAGO' else 'PREVISTO' end,
           case when k <= v_paid then now() end
    from generate_series(1, v_total) k;
  elsif v_kind = 'FINANCIAMENTO' then
    if v_principal is null or v_principal <= 0 then
      raise exception 'Informe o valor financiado.' using errcode = '22023';
    end if;
    if v_system not in ('PRICE', 'SAC', 'FIXA') then
      raise exception 'Sistema de amortização inválido.' using errcode = '22023';
    end if;
    if v_system = 'FIXA' and v_amount <= 0 then
      raise exception 'Informe o valor da parcela.' using errcode = '22023';
    end if;
    insert into public.pf_plans (space_id, kind, name, account_id, category_id, amount, installments_total, first_due, lender, principal,
                                 down_payment, rate_month, system, notes)
    values (v_space, v_kind, v_name, v_account, v_category, v_amount, v_total, v_first, nullif(btrim(p_plan ->> 'lender'), ''), v_principal,
            nullif(p_plan ->> 'down_payment', '')::numeric, v_rate, v_system, nullif(btrim(p_plan ->> 'notes'), ''))
    returning id into v_id;
    for r in select * from private.pf_amortization(v_system, v_principal, v_rate, v_total, v_amount) loop
      insert into public.pf_schedule (space_id, plan_id, number, due_date, amount, interest, status, paid_at)
      values (v_space, v_id, r.installment, private.pf_due_date(v_first, r.installment - 1), r.payment, r.interest,
              case when r.installment <= v_paid then 'PAGO' else 'PREVISTO' end, case when r.installment <= v_paid then now() end);
    end loop;
    -- A parcela "padrão" do cadastro é a primeira calculada.
    update public.pf_plans p set amount = (select s.amount from public.pf_schedule s where s.plan_id = v_id and s.number = 1) where p.id = v_id;
  else
    insert into public.pf_plans (space_id, kind, name, account_id, category_id, amount, installments_total, first_due, notes)
    values (v_space, v_kind, v_name, v_account, v_category, v_amount, v_total, v_first, nullif(btrim(p_plan ->> 'notes'), ''))
    returning id into v_id;
    perform private.pf_sync(v_space);
  end if;
  return v_id;
end;
$$;

create function public.pf_sync()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.pf_sync(private.pf_space());
end;
$$;

-- Paga um vencimento: cria o lançamento (gasto ou entrada) ligado a ele. Não conta como gasto do dia.
create function public.pf_pay_schedule(p_schedule_id bigint, p_date date default null, p_account_id bigint default null, p_amount numeric default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_item public.pf_schedule;
  v_plan public.pf_plans;
  v_kind text;
  v_account bigint;
  v_amount numeric;
  v_date date := coalesce(p_date, private.today());
  v_tx bigint;
begin
  select * into v_item from public.pf_schedule s where s.id = p_schedule_id and s.space_id = v_space for update;
  if v_item.id is null then
    raise exception 'Vencimento não encontrado.' using errcode = '22023';
  end if;
  if v_item.status <> 'PREVISTO' then
    raise exception 'Este vencimento já foi % — desfaça antes de pagar de novo.', lower(v_item.status) using errcode = '22023';
  end if;
  select * into v_plan from public.pf_plans p where p.id = v_item.plan_id;
  v_kind := case when v_plan.kind = 'ENTRADA_FIXA' then 'ENTRADA' else 'GASTO' end;
  v_account := coalesce(p_account_id, v_plan.account_id, (select a.id from public.pf_accounts a where a.space_id = v_space and a.active order by a.id limit 1));
  v_amount := round(coalesce(p_amount, v_item.amount), 2);
  perform private.pf_check_tx(v_space, v_kind, v_account, null, v_plan.category_id, v_amount, v_date);
  insert into public.pf_transactions (space_id, kind, account_id, category_id, amount, date, description, schedule_id)
  values (v_space, v_kind, v_account, v_plan.category_id, v_amount, v_date,
          v_plan.name || ' (' || v_item.number || coalesce('/' || v_plan.installments_total, '') || ')', v_item.id)
  returning id into v_tx;
  update public.pf_schedule s set status = 'PAGO', transaction_id = v_tx, paid_at = now(), amount = v_amount where s.id = v_item.id;
  return v_tx;
end;
$$;

-- Desfaz o pagamento (ou o "pular") e apaga o lançamento criado.
create function public.pf_unpay_schedule(p_schedule_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_item public.pf_schedule;
begin
  select * into v_item from public.pf_schedule s where s.id = p_schedule_id and s.space_id = v_space for update;
  if v_item.id is null then
    raise exception 'Vencimento não encontrado.' using errcode = '22023';
  end if;
  update public.pf_schedule s set status = 'PREVISTO', transaction_id = null, paid_at = null where s.id = v_item.id;
  if v_item.transaction_id is not null then
    delete from public.pf_transactions t where t.id = v_item.transaction_id;
  end if;
end;
$$;

create function public.pf_skip_schedule(p_schedule_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
begin
  update public.pf_schedule s set status = 'PULADO' where s.id = p_schedule_id and s.space_id = v_space and s.status = 'PREVISTO';
  if not found then
    raise exception 'Só vencimentos previstos podem ser pulados.' using errcode = '22023';
  end if;
end;
$$;

create function public.pf_set_schedule_amount(p_schedule_id bigint, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'Informe um valor válido.' using errcode = '22023';
  end if;
  update public.pf_schedule s set amount = round(p_amount, 2) where s.id = p_schedule_id and s.space_id = v_space and s.status = 'PREVISTO';
  if not found then
    raise exception 'Só vencimentos previstos podem mudar de valor.' using errcode = '22023';
  end if;
end;
$$;

-- Encerra o cadastro: recorrentes perdem os vencimentos futuros; parcelas restantes ficam como puladas.
create function public.pf_close_plan(p_plan_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_plan public.pf_plans;
begin
  select * into v_plan from public.pf_plans p where p.id = p_plan_id and p.space_id = v_space for update;
  if v_plan.id is null then
    raise exception 'Cadastro não encontrado.' using errcode = '22023';
  end if;
  update public.pf_plans p set status = 'ENCERRADO' where p.id = p_plan_id;
  if v_plan.kind in ('CONTA_FIXA', 'ENTRADA_FIXA') then
    delete from public.pf_schedule s where s.plan_id = p_plan_id and s.status = 'PREVISTO' and s.due_date > private.today();
  else
    update public.pf_schedule s set status = 'PULADO' where s.plan_id = p_plan_id and s.status = 'PREVISTO';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Valor do dia, calendário e resumo
-- -----------------------------------------------------------------------------

create function public.pf_budget(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_date date := coalesce(p_date, private.today());
  v_day jsonb;
  v_next jsonb;
  v_spent numeric;
  v_allowance numeric;
  v_remaining numeric;
  v_tomorrow_save numeric;
  v_tomorrow_spend numeric;
  v_bills jsonb;
  v_overdue integer;
begin
  perform private.pf_sync(v_space);
  v_day := private.pf_day(v_space, v_date);
  v_spent := private.pf_spent(v_space, v_date);
  v_allowance := (v_day ->> 'allowance')::numeric;
  v_remaining := v_allowance - v_spent;
  if v_date < (v_day ->> 'cycle_end')::date then
    v_next := private.pf_day(v_space, v_date + 1);
    v_tomorrow_save := round(greatest((v_next ->> 'available')::numeric, 0) / (v_next ->> 'days_left')::integer, 2);
    v_tomorrow_spend := round(greatest((v_next ->> 'available')::numeric - greatest(v_remaining, 0), 0) / (v_next ->> 'days_left')::integer, 2);
  end if;
  select coalesce(jsonb_agg(b order by b.due_date, b.schedule_id), '[]'::jsonb) into v_bills from (
    select s.id as schedule_id, p.name, p.kind, s.number, p.installments_total, s.due_date, s.amount, (s.due_date < private.today()) as overdue
      from public.pf_schedule s join public.pf_plans p on p.id = s.plan_id
     where s.space_id = v_space and s.status = 'PREVISTO' and s.due_date <= (v_day ->> 'cycle_end')::date
     order by s.due_date, s.id limit 8) b;
  select count(*) into v_overdue from public.pf_schedule s join public.pf_plans p on p.id = s.plan_id
   where s.space_id = v_space and s.status = 'PREVISTO' and s.due_date < private.today() and p.kind <> 'ENTRADA_FIXA';
  return v_day || jsonb_build_object(
    'spent', v_spent, 'remaining', v_remaining, 'tomorrow_if_save', v_tomorrow_save, 'tomorrow_if_spend', v_tomorrow_spend,
    'next_bills', v_bills, 'overdue_count', v_overdue);
end;
$$;

-- Um dia por linha. Dias passados mostram o limite que valia; futuros, o limite previsto se gastar o limite.
create function public.pf_calendar(p_month date default null)
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
      'allowance', v_allowance,
      'bills', coalesce((select jsonb_agg(jsonb_build_object('schedule_id', s.id, 'name', p.name, 'kind', p.kind, 'amount', s.amount, 'status', s.status) order by s.id)
                           from public.pf_schedule s join public.pf_plans p on p.id = s.plan_id where s.space_id = v_space and s.due_date = d), '[]'::jsonb));
  end loop;
  return jsonb_build_object('today', v_today, 'cycle_start', v_today_day -> 'cycle_start', 'cycle_end', v_today_day -> 'cycle_end', 'days', v_days);
end;
$$;

-- Totais por categoria no período (gastos de todo tipo e entradas).
create function public.pf_summary(p_from date, p_to date)
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
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', x.category_id, 'name', x.name, 'total', x.total) order by x.total desc)
      from (select t.category_id, coalesce(c.name, 'Sem categoria') as name, sum(t.amount) as total
              from public.pf_transactions t left join public.pf_categories c on c.id = t.category_id
             where t.space_id = v_space and t.kind = 'GASTO' and t.date between p_from and p_to
             group by t.category_id, c.name) x), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Leitura para as telas
-- -----------------------------------------------------------------------------

create view public.v_pf_schedule with (security_invoker = true) as
select s.id, s.plan_id, p.name as plan_name, p.kind as plan_kind, p.installments_total, p.account_id, p.category_id, s.number, s.due_date,
       s.amount, s.interest, s.status, s.transaction_id, s.paid_at
from public.pf_schedule s join public.pf_plans p on p.id = s.plan_id;

create view public.v_pf_plans with (security_invoker = true) as
select p.id, p.kind, p.name, p.account_id, p.category_id, p.amount, p.installments_total, p.first_due, p.status, p.lender, p.principal,
       p.down_payment, p.rate_month, p.system, p.notes,
       (select count(*) from public.pf_schedule s where s.plan_id = p.id and s.status = 'PAGO')::integer as paid_count,
       (select count(*) from public.pf_schedule s where s.plan_id = p.id and s.status = 'PREVISTO')::integer as open_count,
       (select coalesce(sum(s.amount), 0) from public.pf_schedule s where s.plan_id = p.id and s.status = 'PAGO') as paid_amount,
       (select coalesce(sum(s.amount), 0) from public.pf_schedule s where s.plan_id = p.id and s.status = 'PREVISTO') as remaining_amount,
       (select sum(s.interest) from public.pf_schedule s where s.plan_id = p.id) as total_interest,
       (select min(s.due_date) from public.pf_schedule s where s.plan_id = p.id and s.status = 'PREVISTO') as next_due,
       (select max(s.due_date) from public.pf_schedule s where s.plan_id = p.id and s.status <> 'PULADO') as last_due,
       -- Saldo devedor do financiamento: valor financiado menos a parte amortizada das parcelas pagas.
       case when p.principal is not null
         then p.principal - (select coalesce(sum(s.amount - coalesce(s.interest, 0)), 0) from public.pf_schedule s where s.plan_id = p.id and s.status = 'PAGO')
       end as outstanding_principal
from public.pf_plans p;

select private.apply_grants();
