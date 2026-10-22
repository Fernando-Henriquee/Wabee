import { UserRoundPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type CustomerRow, useCustomers } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { toNumber } from '@/lib/money';
import { CustomerFormDialog } from './customer-dialogs';
import { BackLink } from './sales-bits';
import { localDate } from './sales-utils';

/** Clientes (US-6.1): quanto compraram, última compra e o que está em aberto. */
export function CustomersPage() {
  const { can, settings } = useMember();
  const tz = settings.timezone;
  const navigate = useNavigate();
  const customers = useCustomers();
  const [showRemoved, setShowRemoved] = useState(false);
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => (customers.data ?? []).filter((c) => showRemoved || (!c.anonymized_at && c.active)), [customers.data, showRemoved]);

  const columns: Column<CustomerRow>[] = [
    {
      key: 'name',
      header: 'Cliente',
      sortValue: (c) => c.name,
      cell: (c) => (
        <span>
          {c.name}
          {c.anonymized_at ? <Badge className="ml-1.5">dados excluídos</Badge> : null}
          <span className="block text-xs font-normal text-muted">{[c.phone, c.instagram, c.email].filter(Boolean).join(' · ') || '—'}</span>
        </span>
      ),
    },
    { key: 'orders', header: 'Pedidos', align: 'right', sortValue: (c) => c.order_count, cell: (c) => c.order_count },
    { key: 'total', header: 'Total comprado', align: 'right', sortValue: (c) => toNumber(c.total_purchased), cell: (c) => <Money value={c.total_purchased} /> },
    { key: 'last', header: 'Última compra', sortValue: (c) => c.last_order_at ?? '', cell: (c) => formatDateBR(localDate(c.last_order_at, tz)) },
    {
      key: 'open',
      header: 'Em aberto',
      align: 'right',
      sortValue: (c) => toNumber(c.open_amount),
      cell: (c) =>
        toNumber(c.open_amount) > 0 ? (
          <span>
            <Money value={c.open_amount} />
            {toNumber(c.overdue_amount) > 0 ? (
              <span className="block text-xs font-medium text-danger">
                <Money value={c.overdue_amount} /> vencido
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  const exportColumns: ExportColumn<CustomerRow>[] = [
    { header: 'Nome', value: (c) => c.name },
    { header: 'Telefone', value: (c) => c.phone },
    { header: 'Instagram', value: (c) => c.instagram },
    { header: 'E-mail', value: (c) => c.email },
    { header: 'Cidade', value: (c) => c.address_city },
    { header: 'Aceita marketing', value: (c) => c.marketing_consent, kind: 'boolean' },
    { header: 'Pedidos', value: (c) => c.order_count, kind: 'number' },
    { header: 'Total comprado', value: (c) => c.total_purchased, kind: 'money' },
    { header: 'Última compra', value: (c) => localDate(c.last_order_at, tz), kind: 'date' },
    { header: 'Em aberto', value: (c) => c.open_amount, kind: 'money' },
    { header: 'Vencido', value: (c) => c.overdue_amount, kind: 'money' },
  ];

  return (
    <Page>
      <PageHeader
        back={<BackLink to="/vendas">Vendas</BackLink>}
        title="Clientes"
        description="Quem compra da Wabee. Clientes também podem ser cadastrados na hora, dentro da venda."
        actions={
          can('write') ? (
            <Button onClick={() => setCreating(true)}>
              <UserRoundPlus /> Novo cliente
            </Button>
          ) : undefined
        }
      />
      {customers.isError ? (
        <ErrorState error={customers.error} onRetry={() => void customers.refetch()} />
      ) : !customers.data ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(c) => String(c.id)}
          rowHref={(c) => `/clientes/${c.id}`}
          searchText={(c) => `${c.name} ${c.phone ?? ''} ${c.instagram ?? ''} ${c.email ?? ''} ${c.address_city ?? ''}`}
          searchPlaceholder="Pesquisar nome, telefone ou Instagram…"
          initialSort={{ key: 'last', direction: 'desc' }}
          rowClassName={(c) => (c.anonymized_at ? 'opacity-60' : undefined)}
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
                <Checkbox checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Mostrar inativos e dados excluídos
              </label>
              <ExportMenu rows={rows} columns={exportColumns} fileName="clientes" />
            </div>
          }
          emptyTitle="Nenhum cliente cadastrado"
          emptyDescription="Os clientes aparecem aqui quando são cadastrados numa venda ou pelo botão “Novo cliente”."
          emptyAction={
            can('write') ? (
              <Button onClick={() => setCreating(true)}>
                <Users /> Cadastrar cliente
              </Button>
            ) : undefined
          }
          mobileCard={(c) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted">
                  {[c.phone, c.instagram].filter(Boolean).join(' · ') || 'sem contato'} · {c.order_count} pedido(s)
                  {c.last_order_at ? ` · última ${formatDateBR(localDate(c.last_order_at, tz))}` : ''}
                </p>
              </div>
              <div className="text-right">
                <Money value={c.total_purchased} className="block text-sm font-semibold" />
                {toNumber(c.open_amount) > 0 ? (
                  <span className={cn('text-xs', toNumber(c.overdue_amount) > 0 ? 'font-medium text-danger' : 'text-muted')}>
                    aberto <Money value={c.open_amount} />
                  </span>
                ) : null}
              </div>
            </div>
          )}
        />
      )}
      {creating ? <CustomerFormDialog open onOpenChange={setCreating} onSaved={(id) => navigate(`/clientes/${id}`)} /> : null}
    </Page>
  );
}
