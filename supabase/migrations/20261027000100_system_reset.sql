-- Reset do sistema: apaga toda a operação (compras, produção, vendas, estoque, financeiro,
-- auditoria) e os cadastros de produtos e itens, como se a Wabee começasse do zero.
-- Ficam: configurações, pessoas, canais e taxas de canal, taxas de custo, categorias
-- financeiras, equipamentos, fornecedores, clientes e contas financeiras (com o saldo inicial).
--
-- Um único TRUNCATE com todas as tabelas resolve as FKs circulares sem ordenar deletes e não
-- dispara os gatilhos de imutabilidade (que são por linha). Sem CASCADE: se uma tabela mantida
-- passar a referenciar uma apagada, o TRUNCATE falha em vez de esvaziá-la por tabela.

create function public.reset_system(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner();
  if p_confirm is distinct from 'APAGAR TUDO' then
    raise exception 'Digite APAGAR TUDO para confirmar o reset.' using errcode = '22023';
  end if;

  -- Referências de cadastros mantidos para tabelas que serão apagadas. O Postgres recusa o
  -- TRUNCATE de tabela referenciada por FK de outra fora da lista (mesmo com a coluna nula),
  -- então essas duas FKs saem e voltam na mesma transação.
  update public.equipment set purchase_line_id = null where purchase_line_id is not null;
  update public.settings
     set onboarding_state = '{}'::jsonb, go_live_date = null, default_order_packaging_item_id = null
   where id;
  alter table public.equipment drop constraint equipment_purchase_line_fk;
  alter table public.settings drop constraint settings_default_packaging_fk;

  truncate table
    -- produtos e itens
    public.channel_prices, public.bom_lines, public.bom_versions, public.product_variants, public.products,
    public.tool_specs, public.filament_specs, public.items,
    -- estoque
    public.stock_balances, public.stock_movements, public.stock_lots,
    -- compras
    public.receipt_lines, public.receipts, public.purchase_lines, public.purchases,
    -- produção e equipamentos
    public.post_process_entries, public.print_job_materials, public.print_job_outputs, public.print_jobs,
    public.maintenance_logs,
    -- vendas
    public.reservations, public.order_packaging, public.delivery_lines, public.deliveries,
    public.sales_order_lines, public.sales_orders,
    -- financeiro
    public.installments, public.payables, public.receivables, public.owner_movements,
    public.cash_transactions, public.result_entries, public.month_closes,
    -- controle
    public.doc_sequences, public.idempotency_keys, public.audit_logs
  restart identity;

  alter table public.equipment
    add constraint equipment_purchase_line_fk foreign key (purchase_line_id) references public.purchase_lines (id);
  alter table public.settings
    add constraint settings_default_packaging_fk foreign key (default_order_packaging_item_id) references public.items (id);

  perform private.audit('DELETE', 'system', null, 'reset',
    'Reset do sistema: operação, produtos e itens apagados; configurações e cadastros base mantidos.');
  return jsonb_build_object('ok', true);
end;
$$;

select private.apply_grants();
