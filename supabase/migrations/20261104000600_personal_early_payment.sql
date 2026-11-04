-- =============================================================================
-- Finanças pessoais: antecipar parcela. Ao pagar uma parcela de financiamento por um valor
-- diferente do previsto (antecipando, o banco cobra menos juros; atrasando, cobra mais), a parte
-- que é amortização continua a mesma e a diferença vai para os juros. Antes, o juros ficava
-- como estava e o saldo devedor caía menos (ou mais) do que deveria.
-- =============================================================================

create or replace function public.pf_pay_schedule(p_schedule_id bigint, p_date date default null, p_account_id bigint default null, p_amount numeric default null)
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
  v_amortization numeric;
  v_interest numeric;
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
  -- Financiamento Price/SAC: a amortização prevista não muda; o que sobra ou falta é juros.
  v_interest := v_item.interest;
  if v_item.interest is not null then
    v_amortization := v_item.amount - v_item.interest;
    v_interest := greatest(v_amount - v_amortization, 0);
  end if;
  update public.pf_schedule s
     set status = 'PAGO', transaction_id = v_tx, paid_at = now(), amount = v_amount, interest = v_interest
   where s.id = v_item.id;
  return v_tx;
end;
$$;

select private.apply_grants();
