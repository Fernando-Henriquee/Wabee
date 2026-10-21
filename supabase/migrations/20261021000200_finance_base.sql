-- =============================================================================
-- Wabee — 0200 Base financeira (seção 4.9 e 13)
-- Contas, plano de categorias, lançamentos de resultado (competência) e de caixa,
-- movimentos do dono, contas a pagar/receber e parcelas.
--
-- Três visões separadas a partir das mesmas operações (princípio 6):
--   * result_entries: o que entra no DRE, na data de competência (somente inserção);
--   * cash_transactions: dinheiro que entrou ou saiu de uma conta DA EMPRESA;
--   * owner_movements: dinheiro do dono que entrou ou saiu do negócio (RN-19).
-- Sinal em result_entries: positivo aumenta o resultado (receita), negativo diminui
-- (custo ou despesa). O DRE é a soma por categoria no período.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Contas financeiras
-- -----------------------------------------------------------------------------

create table public.payment_accounts (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('BANCO', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTEIRA')),
  owner text not null check (owner in ('EMPRESA', 'DONO')),
  opening_balance numeric(14,2) not null default 0,
  opening_date date not null default current_date,
  card_closing_day smallint check (card_closing_day between 1 and 31),
  card_due_day smallint check (card_due_day between 1 and 31),
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (kind = 'CARTAO_CREDITO' or (card_closing_day is null and card_due_day is null)),
  check (owner = 'EMPRESA' or opening_balance = 0)
);

create unique index payment_accounts_name_uq on public.payment_accounts (lower(btrim(name)));

comment on column public.payment_accounts.owner is
  'EMPRESA: entra no caixa. DONO: só registra que o dono pagou (vira investimento, nunca saldo de caixa).';

create trigger payment_accounts_touch before update on public.payment_accounts
  for each row execute function private.touch_updated_at();
create trigger payment_accounts_audit after insert or update on public.payment_accounts
  for each row execute function private.audit_row('payment_account');

-- -----------------------------------------------------------------------------
-- Plano de categorias (seção 18.6)
-- -----------------------------------------------------------------------------

create table public.financial_categories (
  id bigint generated always as identity primary key,
  parent_id bigint references public.financial_categories (id),
  code text not null unique check (code ~ '^[0-9]+(\.[0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  nature text not null check (nature in (
    'RECEITA', 'CUSTO', 'DESPESA_VENDA', 'DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA',
    'NAO_OPERACIONAL', 'INVESTIMENTO', 'DONO', 'TRANSFERENCIA'
  )),
  in_income_statement boolean not null,
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger financial_categories_touch before update on public.financial_categories
  for each row execute function private.touch_updated_at();

create function private.protect_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.nature <> old.nature or new.code <> old.code or new.in_income_statement <> old.in_income_statement then
    raise exception 'A natureza e o código de uma categoria não podem mudar. Crie outra categoria.' using errcode = '22023';
  end if;
  if old.is_system and not new.active then
    raise exception 'Esta categoria é usada pelos cálculos do sistema e não pode ser desativada.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger financial_categories_protect before update on public.financial_categories
  for each row execute function private.protect_category();
create trigger financial_categories_audit after insert or update on public.financial_categories
  for each row execute function private.audit_row('financial_category');

insert into public.financial_categories (code, name, nature, in_income_statement, is_system) values
  ('1', 'Receitas', 'RECEITA', true, true),
  ('2', 'Custos', 'CUSTO', true, true),
  ('3', 'Despesas de venda', 'DESPESA_VENDA', true, true),
  ('4', 'Despesas operacionais', 'DESPESA_OPERACIONAL', true, true),
  ('5', 'Despesas financeiras', 'DESPESA_FINANCEIRA', true, true),
  ('6', 'Resultado não operacional', 'NAO_OPERACIONAL', true, true),
  ('7', 'Investimentos', 'INVESTIMENTO', false, true),
  ('8', 'Dono', 'DONO', false, true),
  ('9', 'Transferências', 'TRANSFERENCIA', false, true);

insert into public.financial_categories (parent_id, code, name, nature, in_income_statement, is_system)
select p.id, c.code, c.name, p.nature, p.in_income_statement, c.system
from (values
  ('1', '1.1', 'Venda de produtos', true),
  ('1', '1.2', 'Frete cobrado', true),
  ('1', '1.3', 'Outras receitas', true),
  ('1', '1.4', 'Descontos e devoluções', true),
  ('2', '2.1', 'CMV — material', true),
  ('2', '2.2', 'CMV — energia', true),
  ('2', '2.3', 'CMV — depreciação', true),
  ('2', '2.4', 'CMV — operacional combinado', true),
  ('2', '2.5', 'CMV — trabalho', true),
  ('2', '2.6', 'Custo de falhas de produção', true),
  ('2', '2.7', 'Ajustes e perdas de estoque', true),
  ('3', '3.1', 'Taxas de canal', true),
  ('3', '3.2', 'Taxas de pagamento', true),
  ('3', '3.3', 'Embalagem', true),
  ('3', '3.4', 'Frete pago', true),
  ('3', '3.5', 'Brindes e amostras', true),
  ('3', '3.6', 'Anúncios e marketing', false),
  ('3', '3.7', 'Impostos sobre vendas', true),
  ('4', '4.1', 'Diferença de energia (conciliação)', true),
  ('4', '4.2', 'Manutenção', true),
  ('4', '4.3', 'Internet e telefone (parte da empresa)', false),
  ('4', '4.4', 'Software e assinaturas', false),
  ('4', '4.5', 'Impostos fixos (DAS)', true),
  ('4', '4.6', 'Ferramentas pequenas', true),
  ('4', '4.7', 'Consumíveis sem controle de estoque', true),
  ('4', '4.8', 'Pró-labore', true),
  ('4', '4.9', 'Outras despesas', false),
  ('5', '5.1', 'Juros de parcelamento', true),
  ('5', '5.2', 'Juros e multas por atraso', true),
  ('5', '5.3', 'Tarifas bancárias', false),
  ('5', '5.4', 'Descontos obtidos', true),
  ('6', '6.1', 'Ganho ou perda na baixa de equipamento', true),
  ('7', '7.1', 'Compra de equipamentos', true),
  ('7', '7.2', 'Compra de materiais para estoque', true),
  ('8', '8.1', 'Aporte de capital', true),
  ('8', '8.2', 'Empréstimo do dono', true),
  ('8', '8.3', 'Reembolso ao dono', true),
  ('8', '8.4', 'Distribuição de lucro', true),
  ('8', '8.5', 'Pagamento de empréstimo ao dono', true),
  ('9', '9.1', 'Transferência entre contas', true),
  ('9', '9.2', 'Devolução de valores a clientes', true)
) as c(parent, code, name, system)
join public.financial_categories p on p.code = c.parent;

create function private.category_id(p_code text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  select c.id into v_id from public.financial_categories c where c.code = p_code;
  if v_id is null then
    raise exception 'Categoria financeira % não encontrada.', p_code using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lançamentos de resultado (competência — base do DRE)
-- -----------------------------------------------------------------------------

create table public.result_entries (
  id bigint generated always as identity primary key,
  occurred_on date not null,
  category_id bigint not null references public.financial_categories (id),
  amount numeric(14,2) not null check (amount <> 0),
  source_type text not null,
  source_id bigint,
  description text,
  channel_id bigint,
  item_id bigint,
  reverses_id bigint unique references public.result_entries (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index result_entries_date_idx on public.result_entries (occurred_on, category_id);
create index result_entries_source_idx on public.result_entries (source_type, source_id);

comment on table public.result_entries is
  'Lançamentos do DRE gerencial por competência. Somente inserção; correção = lançamento inverso (reverses_id).';

create trigger result_entries_immutable before update or delete on public.result_entries
  for each row execute function private.block_mutation();

-- Data em que uma correção deve entrar: a do original, se o mês dele estiver aberto;
-- senão, hoje (RN-22).
create function private.correction_date(p_original date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.month_closes c
      where c.month = date_trunc('month', p_original)::date and c.status = 'FECHADO'
    ) then private.today()
    else p_original
  end;
$$;

create function private.post_result(
  p_on date,
  p_code text,
  p_amount numeric,
  p_source_type text,
  p_source_id bigint,
  p_description text,
  p_channel_id bigint default null,
  p_item_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_id bigint;
begin
  if v_amount = 0 then
    return null;
  end if;
  perform private.assert_open_period(p_on);
  insert into public.result_entries (occurred_on, category_id, amount, source_type, source_id, description, channel_id, item_id)
  values (p_on, private.category_id(p_code), v_amount, p_source_type, p_source_id, p_description, p_channel_id, p_item_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Estorna todos os lançamentos de uma origem que ainda não foram estornados.
create function private.reverse_results(p_source_type text, p_source_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.result_entries;
  v_on date;
begin
  for v_entry in
    select e.* from public.result_entries e
    where e.source_type = p_source_type and e.source_id = p_source_id
      and e.reverses_id is null
      and not exists (select 1 from public.result_entries r where r.reverses_id = e.id)
    order by e.id
  loop
    v_on := private.correction_date(v_entry.occurred_on);
    perform private.assert_open_period(v_on);
    insert into public.result_entries (occurred_on, category_id, amount, source_type, source_id, description, channel_id, item_id, reverses_id)
    values (v_on, v_entry.category_id, -v_entry.amount, v_entry.source_type, v_entry.source_id,
            left('Estorno: ' || coalesce(p_reason, coalesce(v_entry.description, '')), 300), v_entry.channel_id, v_entry.item_id, v_entry.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Caixa (somente contas da empresa)
-- -----------------------------------------------------------------------------

create table public.cash_transactions (
  id bigint generated always as identity primary key,
  account_id bigint not null references public.payment_accounts (id),
  occurred_on date not null,
  direction text not null check (direction in ('IN', 'OUT')),
  amount numeric(14,2) not null check (amount > 0),
  category_id bigint not null references public.financial_categories (id),
  description text,
  installment_id bigint,
  transfer_group uuid,
  owner_movement_id bigint,
  reconciled boolean not null default false,
  source_type text,
  source_id bigint,
  reverses_id bigint unique references public.cash_transactions (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index cash_transactions_account_idx on public.cash_transactions (account_id, occurred_on);
create index cash_transactions_date_idx on public.cash_transactions (occurred_on);
create index cash_transactions_source_idx on public.cash_transactions (source_type, source_id);

create function private.guard_cash_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Só a marca de conferência (US-7.13) pode mudar.
    if (to_jsonb(new) - 'reconciled') <> (to_jsonb(old) - 'reconciled') then
      raise exception 'Lançamento de caixa imutável. Corrija com um estorno.' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Lançamento de caixa imutável. Corrija com um estorno.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.payment_accounts a where a.id = new.account_id and a.owner = 'EMPRESA') then
    raise exception 'Lançamentos de caixa só existem em contas da empresa.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger cash_transactions_guard before insert or update or delete on public.cash_transactions
  for each row execute function private.guard_cash_transaction();

create function private.post_cash(
  p_account_id bigint,
  p_on date,
  p_direction text,
  p_amount numeric,
  p_category_code text,
  p_description text,
  p_source_type text,
  p_source_id bigint,
  p_installment_id bigint default null,
  p_owner_movement_id bigint default null,
  p_transfer_group uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.payment_accounts;
  v_id bigint;
begin
  if round(coalesce(p_amount, 0), 2) <= 0 then
    return null;
  end if;
  select * into v_account from public.payment_accounts a where a.id = p_account_id;
  if v_account.id is null then
    raise exception 'Conta financeira não encontrada.' using errcode = '22023';
  end if;
  if v_account.owner <> 'EMPRESA' then
    raise exception 'A conta "%" é do dono: ela não movimenta o caixa da empresa.', v_account.name using errcode = '22023';
  end if;
  if v_account.kind = 'CARTAO_CREDITO' then
    raise exception 'Cartão de crédito não é caixa: escolha a conta de onde o dinheiro saiu ou entrou.' using errcode = '22023';
  end if;
  if not v_account.active then
    raise exception 'A conta "%" está desativada.', v_account.name using errcode = '22023';
  end if;
  perform private.assert_open_period(p_on);
  insert into public.cash_transactions (
    account_id, occurred_on, direction, amount, category_id, description,
    installment_id, owner_movement_id, transfer_group, source_type, source_id
  )
  values (
    p_account_id, p_on, p_direction, round(p_amount, 2), private.category_id(p_category_code), p_description,
    p_installment_id, p_owner_movement_id, p_transfer_group, p_source_type, p_source_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function private.reverse_cash(p_cash_id bigint, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.cash_transactions;
  v_on date;
  v_id bigint;
begin
  select * into v_tx from public.cash_transactions t where t.id = p_cash_id;
  if v_tx.id is null or exists (select 1 from public.cash_transactions r where r.reverses_id = v_tx.id) then
    return null;
  end if;
  v_on := private.correction_date(v_tx.occurred_on);
  perform private.assert_open_period(v_on);
  insert into public.cash_transactions (
    account_id, occurred_on, direction, amount, category_id, description,
    installment_id, owner_movement_id, transfer_group, source_type, source_id, reverses_id
  )
  values (
    v_tx.account_id, v_on, case v_tx.direction when 'IN' then 'OUT' else 'IN' end, v_tx.amount, v_tx.category_id,
    left('Estorno: ' || coalesce(p_reason, ''), 300), v_tx.installment_id, v_tx.owner_movement_id, v_tx.transfer_group,
    v_tx.source_type, v_tx.source_id, v_tx.id
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Movimentos do dono (RN-19, US-7.8)
-- -----------------------------------------------------------------------------

create table public.owner_movements (
  id bigint generated always as identity primary key,
  kind text not null check (kind in (
    'CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_PAID_EXPENSE', 'OWNER_REIMBURSEMENT',
    'LOAN_REPAYMENT', 'PRO_LABORE', 'PROFIT_DISTRIBUTION', 'GOODS_WITHDRAWAL'
  )),
  occurred_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  direction text not null check (direction in ('DONO_PARA_EMPRESA', 'EMPRESA_PARA_DONO')),
  installment_id bigint,
  purchase_id bigint,
  cash_transaction_id bigint references public.cash_transactions (id),
  stock_movement_id bigint,
  notes text,
  reverses_id bigint unique references public.owner_movements (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (
    reverses_id is not null
    or (kind in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_PAID_EXPENSE') and direction = 'DONO_PARA_EMPRESA')
    or (kind not in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_PAID_EXPENSE') and direction = 'EMPRESA_PARA_DONO')
  )
);

create index owner_movements_date_idx on public.owner_movements (occurred_on);

create trigger owner_movements_immutable before update or delete on public.owner_movements
  for each row execute function private.block_mutation();

create function private.owner_direction(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_kind in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_PAID_EXPENSE') then 'DONO_PARA_EMPRESA' else 'EMPRESA_PARA_DONO' end;
$$;

create function private.post_owner_movement(
  p_kind text,
  p_on date,
  p_amount numeric,
  p_notes text,
  p_installment_id bigint default null,
  p_purchase_id bigint default null,
  p_cash_transaction_id bigint default null,
  p_stock_movement_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if round(coalesce(p_amount, 0), 2) <= 0 then
    return null;
  end if;
  insert into public.owner_movements (kind, occurred_on, amount, direction, installment_id, purchase_id, cash_transaction_id, stock_movement_id, notes)
  values (p_kind, p_on, round(p_amount, 2), private.owner_direction(p_kind), p_installment_id, p_purchase_id, p_cash_transaction_id, p_stock_movement_id, p_notes)
  returning id into v_id;
  return v_id;
end;
$$;

create function private.reverse_owner_movement_row(p_id bigint, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.owner_movements;
  v_id bigint;
begin
  select * into v_row from public.owner_movements m where m.id = p_id;
  if v_row.id is null or v_row.reverses_id is not null
     or exists (select 1 from public.owner_movements r where r.reverses_id = v_row.id) then
    return null;
  end if;
  insert into public.owner_movements (kind, occurred_on, amount, direction, installment_id, purchase_id, cash_transaction_id, stock_movement_id, notes, reverses_id)
  values (
    v_row.kind, private.correction_date(v_row.occurred_on), v_row.amount,
    case v_row.direction when 'DONO_PARA_EMPRESA' then 'EMPRESA_PARA_DONO' else 'DONO_PARA_EMPRESA' end,
    v_row.installment_id, v_row.purchase_id, null, v_row.stock_movement_id, left('Estorno: ' || coalesce(p_reason, ''), 300), v_row.id
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contas a pagar / a receber e parcelas
-- -----------------------------------------------------------------------------

create table public.payables (
  id bigint generated always as identity primary key,
  number text not null unique,
  supplier_id bigint,
  source_type text not null,
  source_id bigint,
  description text not null,
  category_id bigint not null references public.financial_categories (id),
  issue_date date not null,
  principal_total numeric(14,2) not null check (principal_total >= 0),
  interest_total numeric(14,2) not null default 0 check (interest_total >= 0),
  total numeric(14,2) not null check (total >= 0),
  interest_unknown boolean not null default false,
  payer text not null check (payer in ('EMPRESA', 'DONO')),
  owner_funding_type text check (owner_funding_type in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_PAID_EXPENSE')),
  status text not null default 'ABERTO' check (status in ('ABERTO', 'PARCIAL', 'QUITADO', 'CANCELADO')),
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (total = principal_total + interest_total),
  check (payer = 'EMPRESA' or owner_funding_type is not null)
);

create index payables_source_idx on public.payables (source_type, source_id);

create table public.receivables (
  id bigint generated always as identity primary key,
  number text not null unique,
  customer_id bigint,
  source_type text not null,
  source_id bigint,
  description text not null,
  category_id bigint not null references public.financial_categories (id),
  issue_date date not null,
  principal_total numeric(14,2) not null check (principal_total >= 0),
  interest_total numeric(14,2) not null default 0 check (interest_total >= 0),
  total numeric(14,2) not null check (total >= 0),
  status text not null default 'ABERTO' check (status in ('ABERTO', 'PARCIAL', 'QUITADO', 'CANCELADO')),
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (total = principal_total + interest_total)
);

create index receivables_source_idx on public.receivables (source_type, source_id);

create table public.installments (
  id bigint generated always as identity primary key,
  payable_id bigint references public.payables (id),
  receivable_id bigint references public.receivables (id),
  number integer not null check (number >= 1),
  of_total integer not null check (of_total >= number),
  due_date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  principal numeric(14,2) not null,
  interest numeric(14,2) not null default 0 check (interest >= 0),
  status text not null default 'ABERTA' check (status in ('ABERTA', 'PAGA', 'CANCELADA')),
  paid_on date,
  paid_amount numeric(14,2),
  fee_amount numeric(14,2) not null default 0 check (fee_amount >= 0),
  extra_amount numeric(14,2) not null default 0 check (extra_amount >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  payer text not null default 'EMPRESA' check (payer in ('EMPRESA', 'DONO')),
  owner_funding_type text check (owner_funding_type in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_PAID_EXPENSE')),
  account_id bigint references public.payment_accounts (id),
  cash_transaction_id bigint references public.cash_transactions (id),
  owner_movement_id bigint references public.owner_movements (id),
  parent_id bigint references public.installments (id),
  notes text,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(payable_id, receivable_id) = 1),
  check (amount = principal + interest),
  check (status <> 'PAGA' or (paid_on is not null and paid_amount is not null))
);

create index installments_payable_idx on public.installments (payable_id);
create index installments_receivable_idx on public.installments (receivable_id);
create index installments_due_idx on public.installments (status, due_date);

alter table public.cash_transactions
  add constraint cash_transactions_installment_fk foreign key (installment_id) references public.installments (id),
  add constraint cash_transactions_owner_fk foreign key (owner_movement_id) references public.owner_movements (id);
alter table public.owner_movements
  add constraint owner_movements_installment_fk foreign key (installment_id) references public.installments (id);

create trigger payables_touch before update on public.payables for each row execute function private.touch_updated_at();
create trigger receivables_touch before update on public.receivables for each row execute function private.touch_updated_at();
create trigger installments_touch before update on public.installments for each row execute function private.touch_updated_at();

-- Recalcula o status do título a partir das parcelas.
create function private.refresh_title_status(p_payable_id bigint, p_receivable_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open integer;
  v_paid integer;
  v_status text;
begin
  select count(*) filter (where i.status = 'ABERTA'), count(*) filter (where i.status = 'PAGA')
    into v_open, v_paid
  from public.installments i
  where (p_payable_id is not null and i.payable_id = p_payable_id)
     or (p_receivable_id is not null and i.receivable_id = p_receivable_id);
  v_status := case
    when v_open = 0 and v_paid = 0 then 'CANCELADO'
    when v_open = 0 then 'QUITADO'
    when v_paid > 0 then 'PARCIAL'
    else 'ABERTO'
  end;
  if p_payable_id is not null then
    update public.payables set status = v_status where id = p_payable_id and status <> 'CANCELADO';
  else
    update public.receivables set status = v_status where id = p_receivable_id and status <> 'CANCELADO';
  end if;
end;
$$;

-- Cria um título com parcelas (RN-03, RN-25). p_installments: [{due_date, amount}].
-- Juros totais distribuídos linearmente entre as parcelas; cada parcela guarda principal e juros.
-- Os juros viram despesa financeira no mês de vencimento de cada parcela.
create function private.create_title(
  p_kind text,             -- 'PAGAR' | 'RECEBER'
  p_counterparty_id bigint,
  p_source_type text,
  p_source_id bigint,
  p_description text,
  p_category_code text,
  p_issue_date date,
  p_principal numeric,
  p_installments jsonb,
  p_payer text default 'EMPRESA',
  p_owner_funding_type text default null,
  p_interest_unknown boolean default false,
  p_account_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := jsonb_array_length(coalesce(p_installments, '[]'::jsonb));
  v_total numeric(14,2) := 0;
  v_interest numeric(14,2);
  v_interest_parts numeric[];
  v_title_id bigint;
  v_item jsonb;
  v_index integer := 0;
  v_amount numeric(14,2);
  v_installment_id bigint;
  v_number text;
begin
  if v_count = 0 then
    raise exception 'Informe ao menos uma parcela.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_installments) loop
    v_amount := round((v_item ->> 'amount')::numeric, 2);
    if v_amount is null or v_amount < 0 then
      raise exception 'Valor de parcela inválido.' using errcode = '22023';
    end if;
    if (v_item ->> 'due_date') is null then
      raise exception 'Informe o vencimento de cada parcela.' using errcode = '22023';
    end if;
    v_total := v_total + v_amount;
  end loop;
  v_interest := v_total - round(p_principal, 2);
  if v_interest < 0 then
    raise exception 'A soma das parcelas (R$ %) é menor que o valor à vista (R$ %).', v_total, round(p_principal, 2) using errcode = '22023';
  end if;
  v_interest_parts := private.split_amount(v_interest, v_count);

  if p_kind = 'PAGAR' then
    v_number := private.next_doc_number('PAG', p_issue_date);
    insert into public.payables (number, supplier_id, source_type, source_id, description, category_id, issue_date,
                                 principal_total, interest_total, total, interest_unknown, payer, owner_funding_type)
    values (v_number, p_counterparty_id, p_source_type, p_source_id, p_description, private.category_id(p_category_code), p_issue_date,
            round(p_principal, 2), v_interest, v_total, p_interest_unknown, p_payer,
            case when p_payer = 'DONO' then coalesce(p_owner_funding_type, (private.settings()).default_owner_funding_type) end)
    returning id into v_title_id;
  else
    v_number := private.next_doc_number('REC', p_issue_date);
    insert into public.receivables (number, customer_id, source_type, source_id, description, category_id, issue_date,
                                    principal_total, interest_total, total)
    values (v_number, p_counterparty_id, p_source_type, p_source_id, p_description, private.category_id(p_category_code), p_issue_date,
            round(p_principal, 2), v_interest, v_total)
    returning id into v_title_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_installments) loop
    v_index := v_index + 1;
    v_amount := round((v_item ->> 'amount')::numeric, 2);
    if v_interest_parts[v_index] > v_amount then
      raise exception 'Os juros da parcela % superam o valor dela; ajuste os valores.', v_index using errcode = '22023';
    end if;
    insert into public.installments (payable_id, receivable_id, number, of_total, due_date, amount, principal, interest,
                                     payer, owner_funding_type, account_id)
    values (
      case when p_kind = 'PAGAR' then v_title_id end,
      case when p_kind = 'RECEBER' then v_title_id end,
      v_index, v_count, (v_item ->> 'due_date')::date, v_amount, v_amount - v_interest_parts[v_index], v_interest_parts[v_index],
      coalesce(p_payer, 'EMPRESA'),
      case when p_payer = 'DONO' then coalesce(p_owner_funding_type, (private.settings()).default_owner_funding_type) end,
      p_account_id
    )
    returning id into v_installment_id;
    if p_kind = 'PAGAR' and v_interest_parts[v_index] > 0 then
      perform private.post_result((v_item ->> 'due_date')::date, '5.1', -v_interest_parts[v_index], 'installment', v_installment_id,
        format('Juros da parcela %s de %s — %s', v_index, v_count, p_description));
    end if;
  end loop;
  return v_title_id;
end;
$$;

-- Baixa de uma parcela a pagar (US-7.4, RN-19). Uso interno; a RPC pública valida permissões.
create function private.settle_payable_installment(
  p_installment_id bigint,
  p_paid_on date,
  p_amount numeric,
  p_account_id bigint,
  p_payer text,
  p_remainder text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.installments;
  v_title public.payables;
  v_account public.payment_accounts;
  v_payer text;
  v_amount numeric(14,2);
  v_diff numeric(14,2);
  v_cash_id bigint;
  v_owner_id bigint;
  v_child_id bigint;
  v_ratio numeric;
  v_label text;
  v_category_code text;
  v_funding text;
begin
  select * into v_inst from public.installments i where i.id = p_installment_id for update;
  if v_inst.id is null or v_inst.payable_id is null then
    raise exception 'Parcela a pagar não encontrada.' using errcode = '22023';
  end if;
  if v_inst.status <> 'ABERTA' then
    raise exception 'A parcela % de % não está em aberto.', v_inst.number, v_inst.of_total using errcode = '22023';
  end if;
  select * into v_title from public.payables p where p.id = v_inst.payable_id for update;
  if p_paid_on is null then
    raise exception 'Informe a data do pagamento.' using errcode = '22023';
  end if;
  perform private.assert_open_period(p_paid_on);

  if p_account_id is not null then
    select * into v_account from public.payment_accounts a where a.id = p_account_id;
    if v_account.id is null then
      raise exception 'Conta financeira não encontrada.' using errcode = '22023';
    end if;
  end if;
  -- Conta ou cartão do dono força pagador = dono (RN-19).
  v_payer := case when v_account.owner = 'DONO' then 'DONO' else coalesce(p_payer, v_inst.payer) end;
  if v_payer = 'EMPRESA' and v_account.id is null then
    raise exception 'Informe de qual conta da empresa o dinheiro saiu.' using errcode = '22023';
  end if;

  v_amount := round(coalesce(p_amount, v_inst.amount), 2);
  if v_amount <= 0 then
    raise exception 'Valor pago inválido.' using errcode = '22023';
  end if;
  v_diff := v_amount - v_inst.amount;
  v_label := format('Parcela %s de %s — %s', v_inst.number, v_inst.of_total, v_title.description);

  if v_diff < 0 and coalesce(p_remainder, 'DESCONTO') = 'SALDO' then
    -- Pagamento parcial: o restante continua em aberto numa nova parcela, mesmo vencimento.
    v_ratio := v_amount / v_inst.amount;
    insert into public.installments (payable_id, number, of_total, due_date, amount, principal, interest, payer, owner_funding_type, account_id, parent_id, notes)
    values (v_inst.payable_id, v_inst.number, v_inst.of_total, v_inst.due_date, -v_diff,
            -v_diff - (v_inst.interest - round(v_inst.interest * v_ratio, 2)), v_inst.interest - round(v_inst.interest * v_ratio, 2),
            v_inst.payer, v_inst.owner_funding_type, v_inst.account_id, v_inst.id, 'Saldo restante de pagamento parcial')
    returning id into v_child_id;
    update public.installments
       set amount = v_amount, interest = round(v_inst.interest * v_ratio, 2), principal = v_amount - round(v_inst.interest * v_ratio, 2)
     where id = v_inst.id;
    v_diff := 0;
  end if;

  if v_payer = 'EMPRESA' then
    select c.code into v_category_code from public.financial_categories c where c.id = v_title.category_id;
    v_cash_id := private.post_cash(v_account.id, p_paid_on, 'OUT', v_amount, v_category_code, v_label,
                                   'installment_payment', v_inst.id, v_inst.id);
  else
    v_funding := coalesce(v_inst.owner_funding_type, v_title.owner_funding_type, (private.settings()).default_owner_funding_type);
    v_owner_id := private.post_owner_movement(v_funding, p_paid_on, v_amount, v_label, v_inst.id,
      case when v_title.source_type = 'purchase' then v_title.source_id end);
  end if;

  if v_diff > 0 then
    perform private.post_result(p_paid_on, '5.2', -v_diff, 'installment_payment', v_inst.id, 'Juros/multa por atraso — ' || v_label);
  elsif v_diff < 0 then
    perform private.post_result(p_paid_on, '5.4', -v_diff, 'installment_payment', v_inst.id, 'Desconto obtido — ' || v_label);
  end if;

  update public.installments
     set status = 'PAGA', paid_on = p_paid_on, paid_amount = v_amount, account_id = coalesce(v_account.id, account_id),
         payer = v_payer, cash_transaction_id = v_cash_id, owner_movement_id = v_owner_id,
         extra_amount = greatest(v_diff, 0), discount_amount = greatest(-v_diff, 0),
         owner_funding_type = case when v_payer = 'DONO' then v_funding else owner_funding_type end,
         notes = coalesce(p_notes, notes)
   where id = v_inst.id;
  perform private.refresh_title_status(v_inst.payable_id, null);
  return jsonb_build_object('installment_id', v_inst.id, 'cash_transaction_id', v_cash_id, 'owner_movement_id', v_owner_id,
                            'remainder_installment_id', v_child_id, 'payer', v_payer);
end;
$$;

-- Baixa de uma parcela a receber (US-6.7): entra no caixa pelo valor líquido; a taxa vai para despesas de venda.
create function private.settle_receivable_installment(
  p_installment_id bigint,
  p_received_on date,
  p_amount numeric,
  p_account_id bigint,
  p_fee numeric,
  p_remainder text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.installments;
  v_title public.receivables;
  v_amount numeric(14,2);
  v_fee numeric(14,2) := round(coalesce(p_fee, 0), 2);
  v_diff numeric(14,2);
  v_cash_id bigint;
  v_child_id bigint;
  v_label text;
  v_category_code text;
begin
  select * into v_inst from public.installments i where i.id = p_installment_id for update;
  if v_inst.id is null or v_inst.receivable_id is null then
    raise exception 'Parcela a receber não encontrada.' using errcode = '22023';
  end if;
  if v_inst.status <> 'ABERTA' then
    raise exception 'A parcela % de % não está em aberto.', v_inst.number, v_inst.of_total using errcode = '22023';
  end if;
  select * into v_title from public.receivables r where r.id = v_inst.receivable_id for update;
  if p_received_on is null then
    raise exception 'Informe a data do recebimento.' using errcode = '22023';
  end if;
  if p_account_id is null then
    raise exception 'Informe a conta da empresa em que o dinheiro entrou.' using errcode = '22023';
  end if;
  perform private.assert_open_period(p_received_on);
  v_amount := round(coalesce(p_amount, v_inst.amount), 2);
  if v_amount <= 0 then
    raise exception 'Valor recebido inválido.' using errcode = '22023';
  end if;
  if v_fee < 0 or v_fee > v_amount then
    raise exception 'A taxa não pode ser maior que o valor recebido.' using errcode = '22023';
  end if;
  v_diff := v_amount - v_inst.amount;
  v_label := format('Parcela %s de %s — %s', v_inst.number, v_inst.of_total, v_title.description);
  if v_diff < 0 and coalesce(p_remainder, 'SALDO') = 'SALDO' then
    insert into public.installments (receivable_id, number, of_total, due_date, amount, principal, interest, parent_id, notes)
    values (v_inst.receivable_id, v_inst.number, v_inst.of_total, v_inst.due_date, -v_diff, -v_diff, 0, v_inst.id,
            'Saldo restante de recebimento parcial')
    returning id into v_child_id;
    update public.installments set amount = v_amount, principal = v_amount, interest = 0 where id = v_inst.id;
    v_diff := 0;
  end if;

  select c.code into v_category_code from public.financial_categories c where c.id = v_title.category_id;
  v_cash_id := private.post_cash(p_account_id, p_received_on, 'IN', v_amount - v_fee, v_category_code, v_label,
                                 'installment_payment', v_inst.id, v_inst.id);
  perform private.post_result(p_received_on, '3.2', -v_fee, 'installment_payment', v_inst.id, 'Taxa de recebimento — ' || v_label);
  if v_diff > 0 then
    perform private.post_result(p_received_on, '1.3', v_diff, 'installment_payment', v_inst.id, 'Recebido a mais — ' || v_label);
  elsif v_diff < 0 then
    perform private.post_result(p_received_on, '1.4', v_diff, 'installment_payment', v_inst.id, 'Desconto/perda no recebimento — ' || v_label);
  end if;

  update public.installments
     set status = 'PAGA', paid_on = p_received_on, paid_amount = v_amount, fee_amount = v_fee, account_id = p_account_id,
         cash_transaction_id = v_cash_id, extra_amount = greatest(v_diff, 0), discount_amount = greatest(-v_diff, 0),
         notes = coalesce(p_notes, notes)
   where id = v_inst.id;
  perform private.refresh_title_status(null, v_inst.receivable_id);
  return jsonb_build_object('installment_id', v_inst.id, 'cash_transaction_id', v_cash_id, 'remainder_installment_id', v_child_id,
                            'net_amount', v_amount - v_fee);
end;
$$;

-- Desfaz a baixa de uma parcela (a pagar ou a receber).
create function private.unsettle_installment(p_installment_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.installments;
  v_child public.installments;
begin
  select * into v_inst from public.installments i where i.id = p_installment_id for update;
  if v_inst.id is null or v_inst.status <> 'PAGA' then
    raise exception 'Esta parcela não está paga.' using errcode = '22023';
  end if;
  select * into v_child from public.installments c where c.parent_id = v_inst.id and c.status <> 'CANCELADA' for update;
  if v_child.id is not null and v_child.status = 'PAGA' then
    raise exception 'O saldo restante desta parcela já foi baixado. Estorne aquela baixa antes.' using errcode = '22023';
  end if;
  if v_inst.cash_transaction_id is not null then
    perform private.reverse_cash(v_inst.cash_transaction_id, p_reason);
  end if;
  if v_inst.owner_movement_id is not null then
    perform private.reverse_owner_movement_row(v_inst.owner_movement_id, p_reason);
  end if;
  perform private.reverse_results('installment_payment', v_inst.id, p_reason);
  if v_child.id is not null then
    update public.installments set status = 'CANCELADA', canceled_at = now(), notes = 'Reincorporada após estorno da baixa' where id = v_child.id;
    update public.installments
       set amount = v_inst.amount + v_child.amount, principal = v_inst.principal + v_child.principal, interest = v_inst.interest + v_child.interest
     where id = v_inst.id;
  end if;
  update public.installments
     set status = 'ABERTA', paid_on = null, paid_amount = null, fee_amount = 0, extra_amount = 0, discount_amount = 0,
         cash_transaction_id = null, owner_movement_id = null
   where id = v_inst.id;
  perform private.refresh_title_status(v_inst.payable_id, v_inst.receivable_id);
end;
$$;

-- Cancela as parcelas em aberto de um título (e os juros ainda não vencidos lançados para elas).
create function private.cancel_open_installments(p_payable_id bigint, p_receivable_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  for v_id in
    select i.id from public.installments i
    where i.status = 'ABERTA'
      and ((p_payable_id is not null and i.payable_id = p_payable_id) or (p_receivable_id is not null and i.receivable_id = p_receivable_id))
    for update
  loop
    update public.installments set status = 'CANCELADA', canceled_at = now(), notes = left(coalesce(p_reason, ''), 300) where id = v_id;
    perform private.reverse_results('installment', v_id, p_reason);
  end loop;
  perform private.refresh_title_status(p_payable_id, p_receivable_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs públicas
-- -----------------------------------------------------------------------------

create function public.save_payment_account(p_account jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_account ->> 'id', '')::bigint;
  v_kind text := p_account ->> 'kind';
  v_owner text := p_account ->> 'owner';
  v_used boolean;
begin
  perform private.assert_owner();
  if v_id is null then
    insert into public.payment_accounts (name, kind, owner, opening_balance, opening_date, card_closing_day, card_due_day, notes)
    values (
      btrim(p_account ->> 'name'), v_kind, v_owner,
      case when v_owner = 'EMPRESA' then coalesce(nullif(p_account ->> 'opening_balance', '')::numeric, 0) else 0 end,
      coalesce(nullif(p_account ->> 'opening_date', '')::date, private.today()),
      case when v_kind = 'CARTAO_CREDITO' then nullif(p_account ->> 'card_closing_day', '')::smallint end,
      case when v_kind = 'CARTAO_CREDITO' then nullif(p_account ->> 'card_due_day', '')::smallint end,
      nullif(btrim(coalesce(p_account ->> 'notes', '')), '')
    )
    returning id into v_id;
    return v_id;
  end if;
  v_used := exists (select 1 from public.cash_transactions t where t.account_id = v_id)
         or exists (select 1 from public.installments i where i.account_id = v_id and i.status = 'PAGA');
  update public.payment_accounts a
     set name = btrim(p_account ->> 'name'),
         kind = case when v_used then a.kind else v_kind end,
         owner = case when v_used then a.owner else v_owner end,
         opening_balance = case when v_used or v_owner <> 'EMPRESA' then a.opening_balance else coalesce(nullif(p_account ->> 'opening_balance', '')::numeric, 0) end,
         opening_date = case when v_used then a.opening_date else coalesce(nullif(p_account ->> 'opening_date', '')::date, a.opening_date) end,
         card_closing_day = case when coalesce(case when v_used then a.kind else v_kind end, '') = 'CARTAO_CREDITO' then nullif(p_account ->> 'card_closing_day', '')::smallint end,
         card_due_day = case when coalesce(case when v_used then a.kind else v_kind end, '') = 'CARTAO_CREDITO' then nullif(p_account ->> 'card_due_day', '')::smallint end,
         active = coalesce((p_account ->> 'active')::boolean, a.active),
         notes = nullif(btrim(coalesce(p_account ->> 'notes', '')), '')
   where a.id = v_id;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

create function public.save_financial_category(p_category jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := nullif(p_category ->> 'id', '')::bigint;
  v_parent public.financial_categories;
  v_code text;
begin
  perform private.assert_owner();
  if v_id is null then
    select * into v_parent from public.financial_categories c where c.id = (p_category ->> 'parent_id')::bigint and c.parent_id is null;
    if v_parent.id is null then
      raise exception 'Escolha o grupo da nova categoria.' using errcode = '22023';
    end if;
    select v_parent.code || '.' || (coalesce(max(split_part(c.code, '.', 2)::integer), 0) + 1)
      into v_code from public.financial_categories c where c.parent_id = v_parent.id;
    insert into public.financial_categories (parent_id, code, name, nature, in_income_statement)
    values (v_parent.id, v_code, btrim(p_category ->> 'name'), v_parent.nature, v_parent.in_income_statement)
    returning id into v_id;
    return v_id;
  end if;
  update public.financial_categories c
     set name = btrim(coalesce(p_category ->> 'name', c.name)),
         active = coalesce((p_category ->> 'active')::boolean, c.active)
   where c.id = v_id;
  return v_id;
end;
$$;

create function public.pay_installment(
  p_request_id uuid,
  p_installment_id bigint,
  p_paid_on date,
  p_account_id bigint default null,
  p_amount numeric default null,
  p_payer text default null,
  p_remainder text default 'DESCONTO',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_result jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'pay_installment');
  if v_done is not null then
    return v_done;
  end if;
  v_result := private.settle_payable_installment(p_installment_id, p_paid_on, p_amount, p_account_id, p_payer, p_remainder, p_notes);
  perform private.audit('UPDATE', 'installment', p_installment_id, null, 'Parcela paga', v_result);
  return private.idem_finish(p_request_id, v_result);
end;
$$;

-- Fatura do cartão inteira: várias parcelas baixadas juntas pelo valor integral.
create function public.pay_installments(
  p_request_id uuid,
  p_installment_ids bigint[],
  p_paid_on date,
  p_account_id bigint default null,
  p_payer text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_id bigint;
  v_results jsonb := '[]'::jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'pay_installments');
  if v_done is not null then
    return v_done;
  end if;
  if coalesce(array_length(p_installment_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos uma parcela.' using errcode = '22023';
  end if;
  foreach v_id in array p_installment_ids loop
    v_results := v_results || private.settle_payable_installment(v_id, p_paid_on, null, p_account_id, p_payer, 'DESCONTO', null);
  end loop;
  perform private.audit('UPDATE', 'installment', null, null, format('%s parcelas pagas juntas', array_length(p_installment_ids, 1)),
                        jsonb_build_object('parcelas', to_jsonb(p_installment_ids)));
  return private.idem_finish(p_request_id, jsonb_build_object('payments', v_results));
end;
$$;

create function public.receive_installment(
  p_request_id uuid,
  p_installment_id bigint,
  p_received_on date,
  p_account_id bigint,
  p_amount numeric default null,
  p_fee numeric default 0,
  p_remainder text default 'SALDO',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_result jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'receive_installment');
  if v_done is not null then
    return v_done;
  end if;
  v_result := private.settle_receivable_installment(p_installment_id, p_received_on, p_amount, p_account_id, p_fee, p_remainder, p_notes);
  perform private.audit('UPDATE', 'installment', p_installment_id, null, 'Recebimento registrado', v_result);
  return private.idem_finish(p_request_id, v_result);
end;
$$;

create function public.reverse_installment_payment(p_request_id uuid, p_installment_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
begin
  perform private.assert_owner();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  v_done := private.idem_begin(p_request_id, 'reverse_installment_payment');
  if v_done is not null then
    return v_done;
  end if;
  perform private.unsettle_installment(p_installment_id, btrim(p_reason));
  perform private.audit('REVERSE', 'installment', p_installment_id, null, 'Baixa estornada: ' || btrim(p_reason), '{}'::jsonb);
  return private.idem_finish(p_request_id, jsonb_build_object('installment_id', p_installment_id));
end;
$$;

-- Despesa avulsa (US-7.6). Uso misto: só a parte da empresa vira conta a pagar e entra no DRE.
create function public.create_expense(p_request_id uuid, p_expense jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_category public.financial_categories;
  v_total numeric(14,2) := round((p_expense ->> 'amount')::numeric, 2);
  v_share numeric := coalesce(nullif(p_expense ->> 'business_share_pct', '')::numeric, 1);
  v_amount numeric(14,2);
  v_competence date := coalesce(nullif(p_expense ->> 'competence_date', '')::date, private.today());
  v_due date := coalesce(nullif(p_expense ->> 'due_date', '')::date, v_competence);
  v_payer text := coalesce(p_expense ->> 'payer', 'EMPRESA');
  v_account public.payment_accounts;
  v_description text := btrim(coalesce(p_expense ->> 'description', ''));
  v_payable_id bigint;
  v_installment_id bigint;
  v_payment jsonb;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'create_expense');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(v_description) < 2 then
    raise exception 'Descreva a despesa.' using errcode = '22023';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'Informe o valor da despesa.' using errcode = '22023';
  end if;
  if v_share <= 0 or v_share > 1 then
    raise exception 'A parte da empresa deve estar entre 0%% e 100%%.' using errcode = '22023';
  end if;
  select * into v_category from public.financial_categories c where c.id = (p_expense ->> 'category_id')::bigint;
  if v_category.id is null or v_category.parent_id is null or not v_category.active
     or v_category.nature not in ('DESPESA_VENDA', 'DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA', 'NAO_OPERACIONAL') then
    raise exception 'Escolha uma categoria de despesa.' using errcode = '22023';
  end if;
  if nullif(p_expense ->> 'account_id', '') is not null then
    select * into v_account from public.payment_accounts a where a.id = (p_expense ->> 'account_id')::bigint;
    if v_account.owner = 'DONO' then
      v_payer := 'DONO';
    end if;
  end if;
  v_amount := round(v_total * v_share, 2);
  if v_share < 1 then
    v_description := format('%s (%s%% de R$ %s)', v_description, trim(to_char(v_share * 100, 'FM990D##')), to_char(v_total, 'FM999G999G990D00'));
  end if;

  v_payable_id := private.create_title('PAGAR', nullif(p_expense ->> 'supplier_id', '')::bigint, 'expense', null, v_description,
    v_category.code, v_competence, v_amount, jsonb_build_array(jsonb_build_object('due_date', v_due, 'amount', v_amount)),
    v_payer, nullif(p_expense ->> 'owner_funding_type', ''), false, v_account.id);
  update public.payables set source_id = id where id = v_payable_id;
  perform private.post_result(v_competence, v_category.code, -v_amount, 'payable', v_payable_id, v_description);
  select i.id into v_installment_id from public.installments i where i.payable_id = v_payable_id;

  if coalesce((p_expense ->> 'paid')::boolean, false) then
    v_payment := private.settle_payable_installment(v_installment_id, coalesce(nullif(p_expense ->> 'paid_on', '')::date, v_competence),
      null, v_account.id, v_payer, 'DESCONTO', null);
  end if;
  perform private.audit('CREATE', 'payable', v_payable_id, null, 'Despesa: ' || v_description,
                        jsonb_build_object('valor', v_amount, 'categoria', v_category.code));
  return private.idem_finish(p_request_id, jsonb_build_object('payable_id', v_payable_id, 'installment_id', v_installment_id, 'payment', v_payment));
end;
$$;

-- Cancela uma despesa avulsa ainda não paga.
create function public.cancel_expense(p_request_id uuid, p_payable_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_payable public.payables;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'cancel_expense');
  if v_done is not null then
    return v_done;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;
  select * into v_payable from public.payables p where p.id = p_payable_id for update;
  if v_payable.id is null or v_payable.source_type <> 'expense' then
    raise exception 'Despesa não encontrada.' using errcode = '22023';
  end if;
  if exists (select 1 from public.installments i where i.payable_id = p_payable_id and i.status = 'PAGA') then
    raise exception 'Esta despesa já tem pagamento. Estorne o pagamento antes de cancelar.' using errcode = '22023';
  end if;
  perform private.cancel_open_installments(p_payable_id, null, btrim(p_reason));
  perform private.reverse_results('payable', p_payable_id, btrim(p_reason));
  update public.payables set status = 'CANCELADO', canceled_at = now(), cancel_reason = btrim(p_reason) where id = p_payable_id;
  perform private.audit('CANCEL', 'payable', p_payable_id, v_payable.number, 'Despesa cancelada: ' || btrim(p_reason), '{}'::jsonb);
  return private.idem_finish(p_request_id, jsonb_build_object('payable_id', p_payable_id));
end;
$$;

-- Movimento do dono em dinheiro (US-7.8).
create function public.register_owner_movement(
  p_request_id uuid,
  p_kind text,
  p_amount numeric,
  p_occurred_on date,
  p_account_id bigint,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_amount numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_on date := coalesce(p_occurred_on, private.today());
  v_cash_id bigint;
  v_owner_id bigint;
  v_code text;
  v_direction text;
  v_label text;
  v_warning text;
  v_result_total numeric;
  v_distributed numeric;
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'register_owner_movement');
  if v_done is not null then
    return v_done;
  end if;
  if p_kind not in ('CAPITAL_CONTRIBUTION', 'OWNER_LOAN', 'OWNER_REIMBURSEMENT', 'LOAN_REPAYMENT', 'PRO_LABORE', 'PROFIT_DISTRIBUTION') then
    raise exception 'Tipo de movimento do dono inválido.' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'Informe o valor.' using errcode = '22023';
  end if;
  v_code := case p_kind
    when 'CAPITAL_CONTRIBUTION' then '8.1' when 'OWNER_LOAN' then '8.2' when 'OWNER_REIMBURSEMENT' then '8.3'
    when 'LOAN_REPAYMENT' then '8.5' when 'PRO_LABORE' then '4.8' else '8.4' end;
  v_direction := private.owner_direction(p_kind);
  v_label := case p_kind
    when 'CAPITAL_CONTRIBUTION' then 'Aporte de capital' when 'OWNER_LOAN' then 'Empréstimo do dono'
    when 'OWNER_REIMBURSEMENT' then 'Reembolso ao dono' when 'LOAN_REPAYMENT' then 'Pagamento de empréstimo ao dono'
    when 'PRO_LABORE' then 'Pró-labore' else 'Distribuição de lucro' end;
  if p_notes is not null and btrim(p_notes) <> '' then
    v_label := v_label || ' — ' || btrim(p_notes);
  end if;

  if p_kind = 'PROFIT_DISTRIBUTION' then
    select coalesce(sum(e.amount), 0) into v_result_total
    from public.result_entries e join public.financial_categories c on c.id = e.category_id
    where c.in_income_statement;
    select coalesce(sum(case when m.reverses_id is null then m.amount else -m.amount end), 0) into v_distributed
    from public.owner_movements m where m.kind = 'PROFIT_DISTRIBUTION';
    if v_distributed + v_amount > v_result_total then
      v_warning := format('A retirada supera o lucro apurado até hoje (R$ %s disponíveis).',
                          to_char(greatest(v_result_total - v_distributed, 0), 'FM999G999G990D00'));
    end if;
  end if;

  v_cash_id := private.post_cash(p_account_id, v_on, case when v_direction = 'DONO_PARA_EMPRESA' then 'IN' else 'OUT' end,
                                 v_amount, v_code, v_label, 'owner_movement', null);
  v_owner_id := private.post_owner_movement(p_kind, v_on, v_amount, nullif(btrim(coalesce(p_notes, '')), ''), null, null, v_cash_id);
  if p_kind = 'PRO_LABORE' then
    perform private.post_result(v_on, '4.8', -v_amount, 'owner_movement', v_owner_id, v_label);
  end if;
  perform private.audit('CREATE', 'owner_movement', v_owner_id, null, v_label, jsonb_build_object('valor', v_amount));
  return private.idem_finish(p_request_id, jsonb_build_object('owner_movement_id', v_owner_id, 'cash_transaction_id', v_cash_id, 'warning', v_warning));
end;
$$;

create function public.reverse_owner_movement(p_request_id uuid, p_owner_movement_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_row public.owner_movements;
begin
  perform private.assert_owner();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  v_done := private.idem_begin(p_request_id, 'reverse_owner_movement');
  if v_done is not null then
    return v_done;
  end if;
  select * into v_row from public.owner_movements m where m.id = p_owner_movement_id;
  if v_row.id is null or v_row.reverses_id is not null then
    raise exception 'Movimento não encontrado.' using errcode = '22023';
  end if;
  if v_row.installment_id is not null then
    raise exception 'Este movimento veio do pagamento de uma parcela: estorne a baixa da parcela.' using errcode = '22023';
  end if;
  if v_row.stock_movement_id is not null then
    raise exception 'Este movimento veio de uma retirada de estoque: estorne a movimentação de estoque.' using errcode = '22023';
  end if;
  if exists (select 1 from public.owner_movements r where r.reverses_id = v_row.id) then
    raise exception 'Este movimento já foi estornado.' using errcode = '22023';
  end if;
  if v_row.cash_transaction_id is not null then
    perform private.reverse_cash(v_row.cash_transaction_id, btrim(p_reason));
  end if;
  perform private.reverse_owner_movement_row(v_row.id, btrim(p_reason));
  perform private.reverse_results('owner_movement', v_row.id, btrim(p_reason));
  perform private.audit('REVERSE', 'owner_movement', v_row.id, null, 'Movimento do dono estornado: ' || btrim(p_reason), '{}'::jsonb);
  return private.idem_finish(p_request_id, jsonb_build_object('owner_movement_id', v_row.id));
end;
$$;

-- Transferência entre duas contas da empresa (US-7.7): fora do DRE.
create function public.transfer_between_accounts(
  p_request_id uuid,
  p_from_account_id bigint,
  p_to_account_id bigint,
  p_amount numeric,
  p_occurred_on date,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done jsonb;
  v_group uuid := gen_random_uuid();
  v_label text := 'Transferência entre contas' || coalesce(' — ' || nullif(btrim(p_notes), ''), '');
begin
  perform private.assert_owner();
  v_done := private.idem_begin(p_request_id, 'transfer_between_accounts');
  if v_done is not null then
    return v_done;
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'Escolha contas diferentes.' using errcode = '22023';
  end if;
  if round(coalesce(p_amount, 0), 2) <= 0 then
    raise exception 'Informe o valor.' using errcode = '22023';
  end if;
  perform private.post_cash(p_from_account_id, p_occurred_on, 'OUT', p_amount, '9.1', v_label, 'transfer', null, null, null, v_group);
  perform private.post_cash(p_to_account_id, p_occurred_on, 'IN', p_amount, '9.1', v_label, 'transfer', null, null, null, v_group);
  perform private.audit('CREATE', 'transfer', null, null, v_label, jsonb_build_object('valor', round(p_amount, 2)));
  return private.idem_finish(p_request_id, jsonb_build_object('transfer_group', v_group));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS: financeiro visível para dono e leitura (produção não vê valores)
-- -----------------------------------------------------------------------------

alter table public.payment_accounts enable row level security;
alter table public.financial_categories enable row level security;
alter table public.result_entries enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.owner_movements enable row level security;
alter table public.payables enable row level security;
alter table public.receivables enable row level security;
alter table public.installments enable row level security;

create policy payment_accounts_select on public.payment_accounts for select to authenticated using (private.can_view_costs());
create policy financial_categories_select on public.financial_categories for select to authenticated using (private.can_view_costs());
create policy result_entries_select on public.result_entries for select to authenticated using (private.can_view_costs());
create policy cash_transactions_select on public.cash_transactions for select to authenticated using (private.can_view_costs());
create policy owner_movements_select on public.owner_movements for select to authenticated using (private.can_view_costs());
create policy payables_select on public.payables for select to authenticated using (private.can_view_costs());
create policy receivables_select on public.receivables for select to authenticated using (private.can_view_costs());
create policy installments_select on public.installments for select to authenticated using (private.can_view_costs());
