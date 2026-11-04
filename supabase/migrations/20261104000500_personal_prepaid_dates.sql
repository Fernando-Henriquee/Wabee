-- =============================================================================
-- Finanças pessoais: parcelas já pagas no cadastro. Ao cadastrar um financiamento ou parcelado
-- que já começou ("14 parcelas já pagas"), a data informada era tratada como a da parcela 1, e a
-- próxima parcela a pagar ia parar 14 meses no futuro. Agora a data informada é a da próxima
-- parcela em aberto (o app calcula a data-base), e aqui consertamos o que já estava cadastrado.
-- =============================================================================

-- Ao mudar o vencimento seguindo as próximas, as parcelas "já pagas" no cadastro (sem lançamento
-- ligado) também voltam no tempo, mês a mês, a partir da nova data.
create or replace function public.pf_set_schedule_due(p_schedule_id bigint, p_date date, p_following boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_item public.pf_schedule;
  v_plan public.pf_plans;
  v_base date;
begin
  if p_date is null then
    raise exception 'Informe a nova data.' using errcode = '22023';
  end if;
  select * into v_item from public.pf_schedule s where s.id = p_schedule_id and s.space_id = v_space for update;
  if v_item.id is null then
    raise exception 'Vencimento não encontrado.' using errcode = '22023';
  end if;
  if v_item.status <> 'PREVISTO' then
    raise exception 'Só vencimentos em aberto podem mudar de data. Desfaça o pagamento antes.' using errcode = '22023';
  end if;
  select * into v_plan from public.pf_plans p where p.id = v_item.plan_id for update;

  if p_following and v_plan.kind in ('CONTA_FIXA', 'ENTRADA_FIXA') and v_item.number > 1 then
    insert into public.pf_schedule (space_id, plan_id, number, due_date, amount, status)
    select v_space, v_plan.id, g, private.pf_due_date(v_plan.first_due, g - 1), v_plan.amount, 'PULADO'
      from generate_series(1, v_item.number - 1) g
    on conflict (plan_id, number) do nothing;
  end if;

  update public.pf_schedule s set due_date = p_date where s.id = v_item.id;

  if p_following then
    update public.pf_schedule s
       set due_date = private.pf_due_date(p_date, s.number - v_item.number)
     where s.plan_id = v_item.plan_id and s.number > v_item.number and s.status = 'PREVISTO';
    -- Parcelas marcadas como já pagas no cadastro (sem lançamento) acompanham o mesmo ritmo.
    if v_plan.kind in ('PARCELADO', 'FINANCIAMENTO') then
      update public.pf_schedule s
         set due_date = private.pf_due_date(p_date, s.number - v_item.number)
       where s.plan_id = v_item.plan_id and s.number < v_item.number and s.status = 'PAGO' and s.transaction_id is null;
    end if;
    v_base := private.pf_due_date(p_date, -(v_item.number - 1));
    update public.pf_plans p set first_due = v_base where p.id = v_plan.id;
  elsif v_item.number = 1 then
    update public.pf_plans p set first_due = p_date where p.id = v_plan.id;
  end if;
end;
$$;

-- Conserta os cadastros que já existem: parcelas pré-pagas com data no futuro.
-- fix:begin
do $fix$
declare
  r record;
  v_k integer;
  v_row1 date;
  v_base date;
begin
  for r in
    select p.id, p.first_due
      from public.pf_plans p
     where p.kind in ('PARCELADO', 'FINANCIAMENTO')
       and exists (select 1 from public.pf_schedule s
                    where s.plan_id = p.id and s.status = 'PAGO' and s.transaction_id is null and s.due_date > private.today())
  loop
    -- Quantas parcelas seguidas, desde a primeira, foram dadas como pagas no cadastro.
    select coalesce(min(s.number) - 1, (select max(s2.number) from public.pf_schedule s2 where s2.plan_id = r.id))
      into v_k
      from public.pf_schedule s
     where s.plan_id = r.id and not (s.status = 'PAGO' and s.transaction_id is null);
    select s.due_date into v_row1 from public.pf_schedule s where s.plan_id = r.id and s.number = 1;
    -- Cadastro intacto: a data digitada era a da próxima parcela, então a base recua v_k meses.
    -- Se alguém já mudou o vencimento pelo app, a data-base atual já está certa.
    v_base := case when v_row1 = r.first_due then private.pf_due_date(r.first_due, -v_k) else r.first_due end;
    update public.pf_schedule s
       set due_date = private.pf_due_date(v_base, s.number - 1)
     where s.plan_id = r.id and (s.status = 'PREVISTO' or (s.status = 'PAGO' and s.transaction_id is null));
    update public.pf_plans p set first_due = v_base where p.id = r.id;
  end loop;
end;
$fix$;
-- fix:end

select private.apply_grants();
