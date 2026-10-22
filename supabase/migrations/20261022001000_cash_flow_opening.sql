-- Fluxo de caixa realizado (US-7.10): contas abertas dentro do período entravam sem o
-- saldo inicial e o "saldo no fim" não batia com o saldo das contas. Agora:
--   saldo no fim = saldo no início + saldos iniciais de contas abertas no período + entradas − saídas.
-- Com uma conta escolhida, transferências contam como entrada/saída dela; no total da
-- empresa continuam fora (se anulam).

create or replace function public.cash_flow(p_from date, p_to date, p_grain text default 'month', p_account_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_grain text := case when p_grain in ('day', 'week', 'month') then p_grain else 'month' end;
  v_opening numeric;
  v_opened numeric;
  v_buckets jsonb;
  v_categories jsonb;
begin
  perform private.assert_role(array['dono', 'leitura']);
  -- Saldo no fim do dia anterior ao período (mesma regra de private.cash_balance_at).
  select coalesce(sum(a.opening_balance) filter (where a.opening_date < p_from), 0)
       + coalesce((select sum(case t.direction when 'IN' then t.amount else -t.amount end)
                   from public.cash_transactions t join public.payment_accounts a2 on a2.id = t.account_id
                   where a2.owner = 'EMPRESA' and t.occurred_on < p_from and t.occurred_on >= a2.opening_date
                     and (p_account_id is null or t.account_id = p_account_id)), 0),
         coalesce(sum(a.opening_balance) filter (where a.opening_date between p_from and p_to), 0)
    into v_opening, v_opened
  from public.payment_accounts a where a.owner = 'EMPRESA' and (p_account_id is null or a.id = p_account_id);

  select coalesce(jsonb_agg(jsonb_build_object('bucket', x.bucket, 'inflows', x.ins, 'outflows', x.outs, 'net', x.ins - x.outs) order by x.bucket), '[]'::jsonb)
    into v_buckets
  from (select date_trunc(v_grain, t.occurred_on)::date as bucket,
               coalesce(sum(t.amount) filter (where t.direction = 'IN'), 0) as ins,
               coalesce(sum(t.amount) filter (where t.direction = 'OUT'), 0) as outs
        from public.cash_transactions t join public.payment_accounts a on a.id = t.account_id
        where a.owner = 'EMPRESA' and t.occurred_on between p_from and p_to and t.occurred_on >= a.opening_date
          and (p_account_id is null or t.account_id = p_account_id)
          and (p_account_id is not null or t.transfer_group is null)
        group by 1) x;

  select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'direction', x.direction, 'amount', x.amount) order by x.direction, x.amount desc), '[]'::jsonb)
    into v_categories
  from (select c.code, c.name, t.direction, sum(t.amount) as amount
        from public.cash_transactions t
        join public.payment_accounts a on a.id = t.account_id
        join public.financial_categories c on c.id = t.category_id
        where a.owner = 'EMPRESA' and t.occurred_on between p_from and p_to and t.occurred_on >= a.opening_date
          and (p_account_id is null or t.account_id = p_account_id)
          and (p_account_id is not null or t.transfer_group is null)
        group by c.code, c.name, t.direction) x;

  return jsonb_build_object(
    'opening', v_opening,
    'opened_in_period', v_opened,
    'buckets', v_buckets,
    'categories', v_categories,
    'closing', v_opening + v_opened + coalesce((select sum((b ->> 'net')::numeric) from jsonb_array_elements(v_buckets) b), 0));
end;
$$;

select private.apply_grants();
