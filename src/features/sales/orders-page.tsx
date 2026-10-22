import { ClipboardList, History, MoreHorizontal, ShoppingBag, UserRound, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { EntityPicker } from '@/components/shared/entity-picker';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuTrigger, Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { OPEN_STATUSES, ORDER_KIND_LABELS, ORDER_STATUS_LABELS, type SalesOrderRow, useCustomers, useSalesChannels, useSalesOrders } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { sumMoney } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatBRL, formatNumber, formatPercent, toNumber } from '@/lib/money';
import { OrderStatusBadge } from './sales-bits';
import { localDate } from './sales-utils';

type TabKey = 'abertos' | 'prontos' | 'receber' | 'concluidos' | 'cancelados';

interface TabDef {
  key: TabKey;
  label: string;
  match: (o: SalesOrderRow) => boolean;
  /** O período filtra esta aba (as filas de trabalho mostram tudo). */
  period: boolean;
  empty: string;
}

const TABS: TabDef[] = [
  { key: 'abertos', label: 'Em aberto', match: (o) => OPEN_STATUSES.includes(o.status), period: false, empty: 'Nenhum pedido em aberto.' },
  { key: 'prontos', label: 'Prontos para entregar', match: (o) => o.status === 'PRONTO', period: false, empty: 'Nenhum pedido pronto aguardando entrega.' },
  { key: 'receber', label: 'Entregues a receber', match: (o) => o.status === 'ENTREGUE' && toNumber(o.open_amount) > 0, period: false, empty: 'Nada a receber de pedidos entregues.' },
  { key: 'concluidos', label: 'Concluídos', match: (o) => o.status === 'ENTREGUE' && toNumber(o.open_amount) <= 0, period: true, empty: 'Nenhuma venda concluída no período.' },
  { key: 'cancelados', label: 'Cancelados', match: (o) => o.status === 'CANCELADO', period: true, empty: 'Nenhum pedido cancelado no período.' },
];

/** Data de referência: a da entrega para vendas entregues; a do pedido para as demais. */
function referenceDate(o: SalesOrderRow, tz: string): string {
  return (o.status === 'ENTREGUE' ? localDate(o.delivered_at ?? o.ordered_at, tz) : localDate(o.ordered_at, tz)) ?? '';
}

/** Lista e funil de vendas (US-6.13). */
export function OrdersPage() {
  const { can, settings } = useMember();
  const showCosts = can('costs');
  const tz = settings.timezone;
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('aba'))?.key ?? 'abertos') as TabKey;
  const channelId = params.get('canal') ? Number(params.get('canal')) : null;
  const customerId = params.get('cliente') ? Number(params.get('cliente')) : null;
  const [range, setRange] = useDateRange('mes');
  const [customerPicker, setCustomerPicker] = useState(false);
  const orders = useSalesOrders();
  const channels = useSalesChannels(true);
  const customers = useCustomers();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const refDate = (o: SalesOrderRow) => referenceDate(o, tz);

  const byTab = useMemo(() => {
    const base = (orders.data ?? []).filter((o) => (!channelId || o.channel_id === channelId) && (!customerId || o.customer_id === customerId));
    const result = {} as Record<TabKey, SalesOrderRow[]>;
    for (const t of TABS) {
      result[t.key] = base.filter((o) => {
        if (!t.match(o)) return false;
        if (!t.period) return true;
        const day = referenceDate(o, tz);
        return day >= range.from && day <= range.to;
      });
    }
    return result;
  }, [orders.data, channelId, customerId, range.from, range.to, tz]);

  const rows = byTab[tab];
  const current = TABS.find((t) => t.key === tab)!;
  const tabValue = (key: TabKey) => sumMoney(byTab[key].map((o) => (key === 'receber' ? o.open_amount : o.total)));

  const revenue = sumMoney(rows.map((o) => o.total));
  const cogs = sumMoney(rows.map((o) => o.cogs_total));
  const delivered = rows.filter((o) => o.contribution_margin !== null);
  const margin = sumMoney(delivered.map((o) => o.contribution_margin));
  const deliveredNet = delivered.reduce((s, o) => s + toNumber(o.items_subtotal) - toNumber(o.discount_total), 0);

  const columns = useMemo<Column<SalesOrderRow>[]>(() => {
    const cols: Column<SalesOrderRow>[] = [
      {
        key: 'number',
        header: 'Pedido',
        sortValue: (o) => o.number,
        cell: (o) => (
          <span>
            {o.number}
            <span className="block text-xs font-normal text-muted">
              {ORDER_KIND_LABELS[o.kind]}
              {o.is_historical ? ' · anterior ao sistema' : ''}
            </span>
          </span>
        ),
      },
      {
        key: 'date',
        header: tab === 'concluidos' || tab === 'receber' ? 'Entrega' : 'Data',
        sortValue: (o) => (o.status === 'ENTREGUE' ? (o.delivered_at ?? o.ordered_at) : o.ordered_at),
        cell: (o) => (
          <span className="whitespace-nowrap">
            {formatDateBR(referenceDate(o, tz))}
            {o.due_date && OPEN_STATUSES.concat('PRONTO').includes(o.status) ? <span className="block text-xs text-muted">prazo {formatDateBR(o.due_date)}</span> : null}
          </span>
        ),
      },
      {
        key: 'customer',
        header: 'Cliente',
        sortValue: (o) => o.customer_name ?? '',
        cell: (o) => (
          <span>
            {o.customer_name ?? <span className="text-muted">—</span>}
            <span className="block text-xs text-muted">{o.channel_name}</span>
          </span>
        ),
      },
      { key: 'items', header: 'Itens', cell: (o) => <span className="line-clamp-2 max-w-64 text-xs text-ink-soft">{o.lines_summary}</span> },
      { key: 'status', header: 'Situação', sortValue: (o) => o.status, cell: (o) => <OrderStatusBadge status={o.status} /> },
      { key: 'total', header: 'Total', align: 'right', sortValue: (o) => toNumber(o.total), cell: (o) => <Money value={o.total} className="font-medium" /> },
    ];
    if (tab === 'receber' || tab === 'abertos' || tab === 'prontos') {
      cols.push({
        key: 'open',
        header: 'A receber',
        align: 'right',
        sortValue: (o) => toNumber(o.open_amount),
        cell: (o) => (
          <span>
            <Money value={o.open_amount} className={cn(toNumber(o.overdue_amount) > 0 && 'text-danger')} />
            {o.next_due_date && toNumber(o.open_amount) > 0 ? (
              <span className={cn('block text-xs', toNumber(o.overdue_amount) > 0 ? 'font-medium text-danger' : 'text-muted')}>
                {toNumber(o.overdue_amount) > 0 ? 'vencido' : 'vence'} {formatDateBR(o.next_due_date)}
              </span>
            ) : null}
          </span>
        ),
      });
    }
    if (showCosts && (tab === 'concluidos' || tab === 'receber')) {
      cols.push({
        key: 'margin',
        header: 'Margem',
        align: 'right',
        sortValue: (o) => toNumber(o.contribution_margin),
        cell: (o) => (o.contribution_margin === null ? '—' : <Money value={o.contribution_margin} signed />),
      });
    }
    return cols;
  }, [tab, showCosts, tz]);

  const exportColumns: ExportColumn<SalesOrderRow>[] = [
    { header: 'Pedido', value: (o) => o.number },
    { header: 'Data do pedido', value: (o) => localDate(o.ordered_at, tz), kind: 'date' },
    { header: 'Entrega', value: (o) => localDate(o.delivered_at, tz), kind: 'date' },
    { header: 'Tipo', value: (o) => ORDER_KIND_LABELS[o.kind] },
    { header: 'Situação', value: (o) => ORDER_STATUS_LABELS[o.status] },
    { header: 'Cliente', value: (o) => o.customer_name ?? '' },
    { header: 'Canal', value: (o) => o.channel_name },
    { header: 'Itens', value: (o) => o.lines_summary ?? '' },
    { header: 'Total', value: (o) => o.total, kind: 'money' },
    { header: 'Recebido', value: (o) => o.received_amount, kind: 'money' },
    { header: 'A receber', value: (o) => o.open_amount, kind: 'money' },
    ...(showCosts
      ? ([
          { header: 'CMV', value: (o) => o.cogs_total, kind: 'money' },
          { header: 'Taxa do canal', value: (o) => o.channel_fee_total, kind: 'money' },
          { header: 'Taxa de pagamento', value: (o) => o.payment_fee_total, kind: 'money' },
          { header: 'Embalagem', value: (o) => o.packaging_cost_total, kind: 'money' },
          { header: 'Frete pago', value: (o) => o.shipping_cost, kind: 'money' },
          { header: 'Margem de contribuição', value: (o) => o.contribution_margin, kind: 'money' },
        ] as ExportColumn<SalesOrderRow>[])
      : []),
  ];

  const customer = customers.data?.find((c) => c.id === customerId);
  const totals = showCosts && rows.length > 0 ? (
    <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-sm">
      <span>
        Receita <Money value={revenue} className="font-semibold" />
      </span>
      <span>
        CMV <Money value={cogs} className="font-semibold" />
      </span>
      <span title="Soma da margem de contribuição dos pedidos entregues">
        Margem {delivered.length > 0 ? <Money value={margin} signed className="font-semibold" /> : '—'}
        {delivered.length > 0 && deliveredNet > 0 ? <span className="ml-1 text-muted">({formatPercent(toNumber(margin) / deliveredNet)})</span> : null}
      </span>
    </div>
  ) : null;

  return (
    <Page>
      <PageHeader
        title="Vendas"
        description="Pedidos, encomendas, entregas e recebimentos. A receita entra na entrega; o dinheiro, no recebimento."
        actions={
          <>
            {can('write') ? (
              <>
                <Button asChild variant="accent">
                  <Link to="/vendas/rapida">
                    <ShoppingBag /> Venda rápida
                  </Link>
                </Button>
                <Button asChild>
                  <Link to="/vendas/nova">
                    <ClipboardList /> Novo pedido
                  </Link>
                </Button>
              </>
            ) : null}
            <Button asChild variant="outline">
              <Link to="/clientes">
                <Users /> Clientes
              </Link>
            </Button>
            {can('write') ? (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais opções">
                    <MoreHorizontal />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem asChild>
                    <Link to="/vendas/historica">
                      <History /> Venda anterior ao sistema
                    </Link>
                  </MenuItem>
                </MenuContent>
              </Menu>
            ) : null}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setParam('aba', value === 'abertos' ? null : value)}>
        <TabsList className="mb-3 w-full sm:w-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="h-auto flex-col items-start gap-0 py-1.5 sm:flex-row sm:items-center sm:gap-1.5">
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                <span className={cn('num rounded-full px-1.5 text-xs', byTab[t.key].length > 0 ? 'bg-accent-soft text-accent-ink' : 'bg-line/60 text-muted')}>{byTab[t.key].length}</span>
              </span>
              {showCosts && orders.data ? <span className="num text-[0.7rem] font-normal text-muted">{formatBRL(tabValue(t.key))}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <PeriodPresets range={range} onChange={setRange} />
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Canal" value={channelId ?? ''} onChange={(e) => setParam('canal', e.target.value || null)} className="h-9 w-auto min-w-40">
            <option value="">Todos os canais</option>
            {(channels.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active ? '' : ' (inativo)'}
              </option>
            ))}
          </Select>
          {customerId ? (
            <Badge tone="accent" className="h-9 gap-1.5 px-3 text-sm">
              <UserRound className="size-3.5" /> {customer?.name ?? 'Cliente'}
              <button type="button" onClick={() => setParam('cliente', null)} aria-label="Remover filtro de cliente" className="rounded-full p-0.5 hover:bg-accent">
                <X className="size-3.5" />
              </button>
            </Badge>
          ) : (
            <Button variant="outline" size="sm" className="h-9" onClick={() => setCustomerPicker(true)}>
              <UserRound /> Cliente
            </Button>
          )}
        </div>
      </div>
      {!current.period ? <p className="-mt-2 mb-3 text-xs text-muted">Pedidos em andamento aparecem sempre, de qualquer data; o período vale para concluídos e cancelados.</p> : null}

      {orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : !orders.data ? (
        <LoadingBlock />
      ) : (orders.data ?? []).length === 0 ? (
        <EmptyState
          icon={<ShoppingBag />}
          title="Nenhuma venda ainda"
          description="Registre a primeira venda pela venda rápida ou lance as vendas feitas antes de começar a usar o sistema."
          action={
            can('write') ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild variant="accent">
                  <Link to="/vendas/rapida">Venda rápida</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/vendas/historica">Venda anterior ao sistema</Link>
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable
            key={tab}
            rows={rows}
            columns={columns}
            getRowId={(o) => String(o.id)}
            rowHref={(o) => `/vendas/${o.id}`}
            searchText={(o) => `${o.number} ${o.customer_name ?? ''} ${o.channel_name} ${o.lines_summary ?? ''}`}
            searchPlaceholder="Pesquisar pedido, cliente ou produto…"
            initialSort={{ key: 'date', direction: tab === 'abertos' || tab === 'prontos' ? 'asc' : 'desc' }}
            toolbar={<ExportMenu rows={rows} columns={exportColumns} fileName={`vendas-${tab}`} />}
            emptyTitle={current.empty}
            emptyDescription={current.period ? 'Mude o período ou os filtros para ver outras vendas.' : undefined}
            rowClassName={(o) => (toNumber(o.overdue_amount) > 0 ? 'bg-danger-soft/30' : undefined)}
            mobileCard={(o) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{o.number}</span>
                  <OrderStatusBadge status={o.status} />
                </div>
                <p className="truncate text-sm">
                  {o.customer_name ?? 'Sem cliente'} <span className="text-muted">· {o.channel_name}</span>
                </p>
                <p className="truncate text-xs text-muted">{o.lines_summary}</p>
                <div className="flex items-end justify-between gap-2 pt-0.5">
                  <span className="text-xs text-muted">
                    {formatDateBR(refDate(o))}
                    {o.due_date && o.status !== 'ENTREGUE' && o.status !== 'CANCELADO' ? ` · prazo ${formatDateBR(o.due_date)}` : ''}
                    {o.kind === 'ENCOMENDA' ? ' · encomenda' : ''}
                  </span>
                  <span className="text-right">
                    <Money value={o.total} className="block text-sm font-semibold" />
                    {toNumber(o.open_amount) > 0 && o.status !== 'CANCELADO' ? (
                      <span className={cn('text-xs', toNumber(o.overdue_amount) > 0 ? 'font-medium text-danger' : 'text-muted')}>a receber {formatBRL(o.open_amount)}</span>
                    ) : null}
                  </span>
                </div>
              </div>
            )}
            footer={
              totals ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-2.5">
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">
                        {formatNumber(rows.length)} pedido(s) nesta aba
                      </span>
                      {totals}
                    </span>
                  </td>
                </tr>
              ) : undefined
            }
          />
          {totals ? <div className="mt-3 rounded-[var(--radius-card)] border border-line bg-panel px-3 py-2.5 md:hidden">{totals}</div> : null}
        </>
      )}

      <EntityPicker
        open={customerPicker}
        onOpenChange={setCustomerPicker}
        title="Filtrar por cliente"
        loading={!customers.data}
        options={(customers.data ?? []).map((c) => ({ id: String(c.id), label: c.name, description: [c.phone, c.instagram].filter(Boolean).join(' · ') || undefined, searchText: `${c.phone ?? ''} ${c.instagram ?? ''}` }))}
        selectedId={customerId ? String(customerId) : null}
        onSelect={(option) => setParam('cliente', option.id)}
      />
    </Page>
  );
}
