-- =============================================================================
-- Finanças pessoais: mudar a data de vencimento. Até aqui só dava para mudar o valor de um
-- vencimento; quem cadastrou com a data errada não tinha como corrigir.
-- =============================================================================

-- Muda a data de um vencimento em aberto. Com p_following, os vencimentos seguintes ainda em aberto
-- seguem o novo dia mês a mês (parcelas, financiamentos e contas fixas). A data-base do cadastro
-- acompanha, para que o que for gerado depois também caia no dia novo.
create function public.pf_set_schedule_due(p_schedule_id bigint, p_date date, p_following boolean default false)
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

  -- Contas recorrentes: vencimentos anteriores que nunca foram gerados ficam como pulados, para não
  -- reaparecerem como atrasados quando a data-base mudar.
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
    v_base := private.pf_due_date(p_date, -(v_item.number - 1));
    update public.pf_plans p set first_due = v_base where p.id = v_plan.id;
  elsif v_item.number = 1 then
    update public.pf_plans p set first_due = p_date where p.id = v_plan.id;
  end if;
end;
$$;

select private.apply_grants();
