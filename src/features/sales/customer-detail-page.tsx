import { AtSign, ClipboardList, Mail, MessageCircle, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type CustomerRow, type SalesOrderRow, useAnonymizeCustomer, useCustomer, useOrderLines, useSalesOrders } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { formatDateBR } from '@/lib/dates';
import { formatBRL, formatNumber, toNumber } from '@/lib/money';
import { ConsentExplanation, CustomerFormDialog } from './customer-dialogs';
import { BackLink, Info, OrderStatusBadge } from './sales-bits';
import { instagramLink, localDate, type OrderPrefill, whatsappLink } from './sales-utils';

export function CustomerDetailPage() {
  const { id } = useParams();
  const customer = useCustomer(Number(id));
  if (customer.isError) return <Page><ErrorState error={customer.error} onRetry={() => void customer.refetch()} /></Page>;
  if (customer.data === undefined) return <Page><LoadingBlock /></Page>;
  if (customer.data === null) {
    return (
      <Page>
        <EmptyState
          title="Cliente não encontrado"
          action={
            <Button asChild>
              <Link to="/clientes">Voltar para clientes</Link>
            </Button>
          }
        />
      </Page>
    );
  }
  return <CustomerDetail customer={customer.data} />;
}

interface Favorite {
  key: string;
  description: string;
  qty: number;
  revenue: number;
  orders: number;
}

function CustomerDetail({ customer: c }: { customer: CustomerRow }) {
  const { can, settings } = useMember();
  const tz = settings.timezone;
  const orders = useSalesOrders({ customerId: c.id });
  const valid = (orders.data ?? []).filter((o) => o.status !== 'CANCELADO');
  const lines = useOrderLines(
    valid.map((o) => o.id),
    Boolean(orders.data),
  );
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const anonymize = useAnonymizeCustomer();
  const removed = Boolean(c.anonymized_at);
  const wa = whatsappLink(c.phone);
  const ig = instagramLink(c.instagram);

  const favorites = useMemo<Favorite[]>(() => {
    const map = new Map<string, Favorite & { orderIds: Set<number> }>();
    for (const l of lines.data ?? []) {
      const key = l.variant_id ? `v${l.variant_id}` : l.item_id ? `i${l.item_id}` : `d${l.description}`;
      const entry = map.get(key) ?? { key, description: l.description ?? 'Item', qty: 0, revenue: 0, orders: 0, orderIds: new Set<number>() };
      entry.qty += toNumber(l.qty);
      entry.revenue += toNumber(l.line_total);
      entry.orderIds.add(l.order_id);
      map.set(key, entry);
    }
    return [...map.values()].map(({ orderIds, ...f }) => ({ ...f, orders: orderIds.size })).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  }, [lines.data]);

  const columns: Column<SalesOrderRow>[] = [
    { key: 'number', header: 'Pedido', sortValue: (o) => o.number, cell: (o) => o.number },
    { key: 'date', header: 'Data', sortValue: (o) => o.ordered_at, cell: (o) => formatDateBR(localDate(o.ordered_at, tz)) },
    { key: 'items', header: 'Itens', cell: (o) => <span className="line-clamp-2 max-w-72 text-xs text-ink-soft">{o.lines_summary}</span> },
    { key: 'status', header: 'Situação', cell: (o) => <OrderStatusBadge status={o.status} /> },
    { key: 'total', header: 'Total', align: 'right', sortValue: (o) => toNumber(o.total), cell: (o) => <Money value={o.total} /> },
    {
      key: 'open',
      header: 'A receber',
      align: 'right',
      sortValue: (o) => toNumber(o.open_amount),
      cell: (o) => (toNumber(o.open_amount) > 0 && o.status !== 'CANCELADO' ? <Money value={o.open_amount} className={toNumber(o.overdue_amount) > 0 ? 'text-danger' : undefined} /> : '—'),
    },
  ];

  const prefill: OrderPrefill = { kind: 'ENCOMENDA', customer: { kind: 'existing', id: c.id, name: c.name }, lines: [] };

  return (
    <Page>
      <PageHeader
        back={<BackLink to="/clientes">Clientes</BackLink>}
        title={c.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {removed ? <Badge>dados pessoais excluídos em {formatDateBR(localDate(c.anonymized_at, tz))}</Badge> : null}
            {!removed && !c.active ? <Badge tone="warning">inativo</Badge> : null}
            {!removed ? (
              c.marketing_consent ? (
                <Badge tone="success">
                  <ShieldCheck className="size-3" /> aceita marketing
                </Badge>
              ) : (
                <Badge>
                  <ShieldOff className="size-3" /> sem consentimento de marketing
                </Badge>
              )
            ) : null}
            {wa ? (
              <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink underline decoration-accent decoration-2 underline-offset-4">
                <MessageCircle className="size-3.5" /> {c.phone}
              </a>
            ) : c.phone ? (
              <span>{c.phone}</span>
            ) : null}
            {ig ? (
              <a href={ig} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink underline decoration-accent decoration-2 underline-offset-4">
                <AtSign className="size-3.5" /> {c.instagram?.replace(/^@/, '')}
              </a>
            ) : null}
            {c.email ? (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-ink underline decoration-accent decoration-2 underline-offset-4">
                <Mail className="size-3.5" /> {c.email}
              </a>
            ) : null}
          </span>
        }
        actions={
          can('write') && !removed ? (
            <>
              <Button asChild>
                <Link to="/vendas/nova" state={{ prefill }}>
                  <ClipboardList /> Novo pedido
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Editar
              </Button>
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais ações">
                    <MoreHorizontal />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem tone="danger" onSelect={() => setRemoving(true)}>
                    <UserX /> Excluir dados pessoais
                  </MenuItem>
                </MenuContent>
              </Menu>
            </>
          ) : undefined
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total comprado" value={c.total_purchased} hint="Pedidos entregues" />
        <Stat label="Pedidos" value={c.order_count} format={(v) => formatNumber(v, 0)} hint="Sem os cancelados" />
        <Stat label="Última compra" value={null} format={() => formatDateBR(localDate(c.last_order_at, tz))} />
        <Stat
          label="Em aberto"
          value={c.open_amount}
          tone={toNumber(c.overdue_amount) > 0 ? 'negative' : 'default'}
          hint={toNumber(c.overdue_amount) > 0 ? `${formatBRL(c.overdue_amount)} vencido` : toNumber(c.credit_balance) > 0 ? `Crédito do cliente: ${formatBRL(c.credit_balance)}` : undefined}
        />
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Pedidos</TabsTrigger>
          <TabsTrigger value="favorites">Produtos favoritos</TabsTrigger>
          <TabsTrigger value="data">Dados e LGPD</TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          {orders.isError ? (
            <ErrorState error={orders.error} />
          ) : !orders.data ? (
            <LoadingBlock rows={2} />
          ) : (
            <DataTable
              rows={orders.data}
              columns={columns}
              getRowId={(o) => String(o.id)}
              rowHref={(o) => `/vendas/${o.id}`}
              initialSort={{ key: 'date', direction: 'desc' }}
              emptyTitle="Nenhum pedido deste cliente"
              mobileCard={(o) => (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {o.number} <OrderStatusBadge status={o.status} />
                    </p>
                    <p className="truncate text-xs text-muted">
                      {formatDateBR(localDate(o.ordered_at, tz))} · {o.lines_summary}
                    </p>
                  </div>
                  <Money value={o.total} className="text-sm font-semibold" />
                </div>
              )}
            />
          )}
        </TabsContent>
        <TabsContent value="favorites">
          {!lines.data && valid.length > 0 ? (
            <LoadingBlock rows={2} />
          ) : favorites.length === 0 ? (
            <EmptyState title="Ainda sem compras" description="Os produtos mais comprados por este cliente aparecem aqui." />
          ) : (
            <Card>
              <CardHeader title="O que este cliente mais compra" description="Soma das linhas dos pedidos não cancelados." />
              <ul className="divide-y divide-line">
                {favorites.map((f, index) => (
                  <li key={f.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.description}</span>
                      <span className="text-xs text-muted">em {f.orders} pedido(s)</span>
                    </span>
                    <span className="text-right">
                      <span className="num block font-semibold">{formatNumber(f.qty)} un</span>
                      <Money value={f.revenue} className="text-xs text-muted" />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="data">
          <Card>
            <CardHeader title="Cadastro" />
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              <Info label="Telefone" value={c.phone ?? '—'} />
              <Info label="Instagram" value={c.instagram ?? '—'} />
              <Info label="E-mail" value={c.email ?? '—'} />
              <Info label="CPF / CNPJ" value={c.document ?? '—'} />
              <Info
                label="Endereço"
                className="sm:col-span-2"
                value={
                  [c.address_street && `${c.address_street}${c.address_number ? `, ${c.address_number}` : ''}`, c.address_complement, c.address_district, c.address_city && `${c.address_city}${c.address_state ? `/${c.address_state}` : ''}`, c.address_zip]
                    .filter(Boolean)
                    .join(' · ') || '—'
                }
              />
              {c.notes ? <Info label="Observações" value={c.notes} className="sm:col-span-2" /> : null}
              {toNumber(c.credit_balance) > 0 ? <Info label="Crédito do cliente" value={formatBRL(c.credit_balance)} /> : null}
            </dl>
            <div className="space-y-2 border-t border-line p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                {c.marketing_consent ? <ShieldCheck className="size-4 text-success" /> : <ShieldOff className="size-4 text-muted" />}
                {c.marketing_consent ? 'Autorizou receber novidades e promoções' : 'Não autorizou receber novidades e promoções'}
              </p>
              <ConsentExplanation />
            </div>
            {can('write') && !removed ? (
              <div className="space-y-2 border-t border-line p-4">
                <p className="text-xs text-muted">
                  Direito de eliminação (LGPD): se o cliente pedir, os dados pessoais são apagados e os pedidos continuam nos relatórios e no financeiro, sem identificar a pessoa.
                </p>
                <Button variant="danger-outline" size="sm" onClick={() => setRemoving(true)}>
                  <UserX /> Excluir dados pessoais
                </Button>
              </div>
            ) : null}
          </Card>
        </TabsContent>
      </Tabs>

      {editing ? <CustomerFormDialog customer={c} open onOpenChange={setEditing} /> : null}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Excluir os dados pessoais deste cliente?"
        description={`Nome, telefone, e-mail, Instagram, documento, endereço e observações de ${c.name} serão apagados (LGPD). Os ${c.order_count} pedido(s) continuam nos relatórios e no financeiro como “Cliente removido #${c.id}”. Não dá para desfazer.`}
        confirmLabel="Excluir dados pessoais"
        onConfirm={() => anonymize.mutateAsync(c.id)}
      />
    </Page>
  );
}
