import { AlertTriangle, Ban, CheckCircle2, ClipboardCopy, Gift, Lock, MessageCircle, MoreHorizontal, Pencil, Printer, RotateCcw, Truck, Unlock, Wallet } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { DocumentHistory } from '@/components/shared/document-history';
import { Money } from '@/components/shared/money';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type InstallmentRow, useInstallments, useReverseInstallmentPayment } from '@/data/finance';
import {
  DELIVERY_METHOD_LABELS,
  type SalesOrderLineRow,
  type SalesOrderRow,
  useChannelFees,
  useConfirmOrder,
  useOrderDeliveries,
  useOrderLines,
  useOrderPrintJobs,
  useSalesOrder,
} from '@/data/sales';
import { ReceiveInstallmentDialog } from '@/features/finance/installment-dialogs';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { formatBRL, formatNumber, formatPercent, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { currentFee, estimateMargin, orderSummaryText } from './cart';
import { CancelOrderDialog, DeliverDialog, ProduceOrderDialog, ReservationDialog } from './order-dialogs';
import { BackLink, OrderKindBadge, OrderStatusBadge, ValueRow } from './sales-bits';
import { localDate, whatsappLink } from './sales-utils';
import { productKey, useCatalog, usePackagingItems } from './use-catalog';

const PRINT_STATUS: Record<string, string> = { PLANEJADA: 'Planejada', IMPRIMINDO: 'Imprimindo', CONCLUIDA: 'Concluída', FALHOU: 'Falhou', CANCELADA: 'Cancelada', ESTORNADA: 'Estornada' };

export function OrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const order = useSalesOrder(orderId);
  if (order.isError) return <Page><ErrorState error={order.error} onRetry={() => void order.refetch()} /></Page>;
  if (order.data === undefined) return <Page><LoadingBlock /></Page>;
  if (order.data === null) {
    return (
      <Page>
        <EmptyState
          title="Pedido não encontrado"
          description="Ele pode ter sido digitado errado ou você não tem acesso."
          action={
            <Button asChild>
              <Link to="/vendas">Voltar para vendas</Link>
            </Button>
          }
        />
      </Page>
    );
  }
  return <OrderDetail order={order.data} />;
}

type DialogState =
  | { kind: 'deliver' }
  | { kind: 'cancel' }
  | { kind: 'produce' }
  | { kind: 'reserve' | 'release'; line: SalesOrderLineRow }
  | { kind: 'receive'; installment: InstallmentRow }
  | { kind: 'reverse'; installment: InstallmentRow }
  | null;

function OrderDetail({ order }: { order: SalesOrderRow }) {
  const { can, settings, today } = useMember();
  const showCosts = can('costs');
  const write = can('write');
  const lines = useOrderLines([order.id]);
  const installments = useInstallments({ receivableId: order.receivable_id ?? undefined }, Boolean(order.receivable_id));
  const refunds = useInstallments({ sourceType: 'order_refund', sourceId: order.id }, order.status === 'CANCELADO');
  const deliveries = useOrderDeliveries(order.id);
  const jobs = useOrderPrintJobs(order.id);
  const fees = useChannelFees();
  const catalog = useCatalog();
  const packagingItems = usePackagingItems();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmRequestId, renewConfirm] = useRequestId();
  const close = () => setDialog(null);
  const fee = currentFee(fees.data, order.channel_id, today());

  const confirm = useConfirmOrder((r) => {
    renewConfirm();
    const missing = (r.missing ?? []).reduce((sum, m) => sum + toNumber(m.missing), 0);
    if (missing > 0) toast.info(`Faltam ${formatNumber(missing)} peça(s) sem saldo livre: use “Produzir” para planejar a impressão.`);
  });
  const reverse = useReverseInstallmentPayment(close);

  const rows = lines.data ?? [];
  const itemLines = rows.filter((l) => l.item_id);
  const pendingDelivery = itemLines.filter((l) => toNumber(l.qty) - toNumber(l.qty_delivered) > 0);
  const missing = itemLines.filter((l) => toNumber(l.qty_pending) > 0);
  const active = ['CONFIRMADO', 'EM_PRODUCAO', 'PRONTO'].includes(order.status);
  const deliveryList = deliveries.data?.deliveries ?? [];
  const plannedJobs = (jobs.data ?? []).filter((j) => j.status === 'PLANEJADA');
  const canCancel = write && !['ENTREGUE', 'CANCELADO'].includes(order.status) && deliveryList.length === 0 && deliveries.data !== undefined;
  const canDeliver = write && active && !order.is_historical && pendingDelivery.length > 0;
  const canProduce = (write || can('production')) && ['CONFIRMADO', 'EM_PRODUCAO'].includes(order.status) && missing.some((l) => l.variant_id);
  const tz = settings.timezone;
  const insts = installments.data ?? [];
  const openInsts = insts.filter((i) => i.status === 'ABERTA');

  const summaryText = () =>
    orderSummaryText({
      number: order.number,
      company: settings.company_name,
      customerName: order.customer_name,
      dueDate: order.status === 'ENTREGUE' ? null : order.due_date,
      lines: rows.map((l) => ({ description: l.description ?? 'Item', qty: l.qty, total: l.line_total, isGift: l.is_gift })),
      subtotal: order.items_subtotal,
      discountTotal: order.discount_total,
      shippingCharged: order.shipping_charged,
      total: order.total,
      installments: insts
        .filter((i) => i.status !== 'CANCELADA')
        .map((i) => ({ label: i.of_total > 1 ? `Parcela ${i.number}/${i.of_total}` : 'Pagamento', amount: i.amount, dueDate: i.due_date, paid: i.status === 'PAGA' })),
      notes: order.notes,
    });

  const copySummary = () => {
    const text = summaryText();
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success('Resumo do pedido copiado. É só colar no WhatsApp.'))
      .catch(() => toast.error('Não foi possível copiar automaticamente.'));
  };
  const wa = whatsappLink(order.customer_phone, undefined);

  const actions = (
    <>
      {write && order.status === 'RASCUNHO' ? (
        <>
          <Button asChild variant="outline">
            <Link to={`/vendas/${order.id}/editar`}>
              <Pencil /> Editar rascunho
            </Link>
          </Button>
          <Button onClick={() => confirm.mutate({ requestId: confirmRequestId, orderId: order.id })} loading={confirm.isPending}>
            <CheckCircle2 /> Confirmar pedido
          </Button>
        </>
      ) : null}
      {canProduce ? (
        <Button variant={order.status === 'PRONTO' ? 'outline' : 'primary'} onClick={() => setDialog({ kind: 'produce' })}>
          <Printer /> Produzir
        </Button>
      ) : null}
      {canDeliver ? (
        <Button variant={order.status === 'PRONTO' || !canProduce ? 'primary' : 'outline'} onClick={() => setDialog({ kind: 'deliver' })}>
          <Truck /> Entregar
        </Button>
      ) : null}
      {write && openInsts.length > 0 && order.status !== 'CANCELADO' ? (
        <Button variant="outline" onClick={() => setDialog({ kind: 'receive', installment: openInsts[0]! })}>
          <Wallet /> Receber
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Mais ações">
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={copySummary}>
            <ClipboardCopy /> Copiar resumo para WhatsApp
          </MenuItem>
          {wa ? (
            <MenuItem asChild>
              <a href={whatsappLink(order.customer_phone, summaryText()) ?? wa} target="_blank" rel="noreferrer">
                <MessageCircle /> Enviar no WhatsApp do cliente
              </a>
            </MenuItem>
          ) : null}
          {canCancel ? (
            <>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={() => setDialog({ kind: 'cancel' })}>
                <Ban /> Cancelar pedido
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </Menu>
    </>
  );

  const orderedOn = localDate(order.ordered_at, tz);
  const deliveredOn = localDate(order.delivered_at, tz);

  return (
    <Page>
      <PageHeader
        back={<BackLink to="/vendas">Vendas</BackLink>}
        title={`Pedido ${order.number}`}
        description={
          <span className="flex flex-col gap-1.5">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <OrderStatusBadge status={order.status} />
              <OrderKindBadge kind={order.kind} />
              {order.is_historical ? <Badge>anterior ao sistema</Badge> : null}
              {toNumber(order.overdue_amount) > 0 ? <Badge tone="danger">parcela vencida</Badge> : null}
            </span>
            <span>
              {order.customer_id ? (
                <Link to={`/clientes/${order.customer_id}`} className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
                  {order.customer_name}
                </Link>
              ) : (
                'Sem cliente'
              )}
              {' · '}
              {order.channel_name} · pedido em {formatDateBR(orderedOn)}
              {order.due_date && order.status !== 'ENTREGUE' ? ` · prazo ${formatDateBR(order.due_date)}` : ''}
              {deliveredOn ? ` · entregue em ${formatDateBR(deliveredOn)}` : ''}
            </span>
          </span>
        }
        actions={actions}
      />

      {order.status === 'CANCELADO' ? (
        <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Pedido cancelado{order.cancel_reason ? `: ${order.cancel_reason}` : ''}.</p>
      ) : null}
      {order.status === 'RASCUNHO' ? (
        <p className="mb-4 rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">Rascunho: ainda não reserva estoque nem cria conta a receber. Confirme quando o cliente fechar o pedido.</p>
      ) : null}
      {['CONFIRMADO', 'EM_PRODUCAO'].includes(order.status) && missing.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Faltam {missing.map((l) => `${formatNumber(l.qty_pending)} ${l.description}`).join(', ')} — sem saldo livre para reservar.
            {order.status === 'EM_PRODUCAO' ? ' Já há impressão planejada; as peças liberadas são reservadas automaticamente.' : ''}
          </span>
          {canProduce && order.status === 'CONFIRMADO' ? (
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'produce' })}>
              <Printer /> Produzir
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total do pedido" value={order.total} hint={`${formatNumber(order.units)} peça(s)`} />
        <Stat label="Recebido" value={order.received_amount} tone={toNumber(order.received_amount) > 0 ? 'positive' : 'default'} />
        <Stat
          label="A receber"
          value={order.open_amount}
          tone={toNumber(order.overdue_amount) > 0 ? 'negative' : toNumber(order.open_amount) > 0 ? 'warning' : 'default'}
          hint={toNumber(order.overdue_amount) > 0 ? `${formatBRL(order.overdue_amount)} vencido` : order.next_due_date ? `Próximo vencimento ${formatDateBR(order.next_due_date)}` : undefined}
        />
        {showCosts ? <MarginStat order={order} lines={rows} catalogCost={(l) => (l.variant_id || l.item_id ? (catalog.byKey.get(productKey({ variantId: l.variant_id, itemId: l.item_id }))?.unitCost ?? null) : null)} fee={fee} /> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Itens"
              description={active ? 'Reservado = separado para este pedido: sai do saldo livre (não aparece na venda rápida nem para outros pedidos), mas continua no estoque até a entrega.' : undefined}
            />
            {lines.isError ? (
              <div className="p-4">
                <ErrorState error={lines.error} />
              </div>
            ) : !lines.data ? (
              <div className="p-4">
                <LoadingBlock rows={2} />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((l) => (
                  <LineRow
                    key={l.id}
                    line={l}
                    active={active}
                    showStock={order.status !== 'RASCUNHO' && order.status !== 'CANCELADO' && !order.is_historical}
                    canWrite={write}
                    onReserve={() => setDialog({ kind: 'reserve', line: l })}
                    onRelease={() => setDialog({ kind: 'release', line: l })}
                  />
                ))}
              </ul>
            )}
            {rows.some((l) => l.is_gift) ? (
              <p className="flex items-start gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
                <Gift className="mt-0.5 size-3.5 shrink-0" /> Brinde: sai do estoque com preço zero; o custo vai para Marketing, não para o CMV.
              </p>
            ) : null}
            <div className="border-t border-line px-4 py-3">
              <ValueRow label="Produtos" value={formatBRL(order.items_subtotal)} />
              {toNumber(order.discount_total) > 0 ? <ValueRow label="Descontos" value={`−${formatBRL(order.discount_total)}`} /> : null}
              {toNumber(order.shipping_charged) > 0 ? <ValueRow label="Frete cobrado" value={formatBRL(order.shipping_charged)} /> : null}
              <ValueRow label="Total" value={formatBRL(order.total)} strong />
              {order.notes ? <p className="mt-2 whitespace-pre-line rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">{order.notes}</p> : null}
            </div>
          </Card>

          {deliveryList.length > 0 ? (
            <Card>
              <CardHeader title="Entregas" description="Na entrega o estoque sai e a receita, o CMV e as taxas entram no resultado." />
              <ul className="divide-y divide-line">
                {deliveryList.map((d) => {
                  const dLines = (deliveries.data?.lines ?? []).filter((x) => x.delivery_id === d.id);
                  const dPack = (deliveries.data?.packaging ?? []).filter((x) => x.delivery_id === d.id);
                  return (
                    <li key={d.id} className="space-y-1.5 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {formatDateTimeBR(d.delivered_at, tz)} · {DELIVERY_METHOD_LABELS[d.method]}
                        </span>
                        {d.tracking_code ? <Badge>rastreio {d.tracking_code}</Badge> : null}
                      </div>
                      <p className="text-xs text-muted">
                        {dLines.map((x) => `${formatNumber(x.qty)}× ${rows.find((l) => l.id === x.order_line_id)?.description ?? 'item'}`).join(', ')}
                        {dPack.length > 0 ? ` · embalagem: ${dPack.map((p) => `${formatNumber(p.qty)}× ${packagingItems.items.get(p.item_id)?.name ?? 'embalagem'}`).join(', ')}` : ' · sem embalagem'}
                      </p>
                      {showCosts ? (
                        <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-soft">
                          <span>Receita <Money value={d.revenue} /></span>
                          <span>CMV <Money value={d.cogs_total} /></span>
                          <span>Taxa do canal <Money value={d.channel_fee} /></span>
                          <span>Embalagem <Money value={d.packaging_cost} /></span>
                          {toNumber(d.shipping_cost) > 0 ? <span>Frete pago <Money value={d.shipping_cost} /></span> : null}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          {(jobs.data ?? []).length > 0 ? (
            <Card>
              <CardHeader title="Impressões da encomenda" description="Peças liberadas destas impressões são reservadas automaticamente para o pedido." />
              <ul className="divide-y divide-line">
                {jobs.data!.map((j) => (
                  <li key={j.id}>
                    <Link to={`/producao/impressoes/${j.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-subtle">
                      <Printer className="size-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{j.code}</span>
                        <span className="block truncate text-xs text-muted">{j.outputs_summary}</span>
                      </span>
                      <Badge tone={j.status === 'CONCLUIDA' ? 'success' : j.status === 'IMPRIMINDO' ? 'accent' : j.status === 'PLANEJADA' ? 'info' : 'neutral'}>{PRINT_STATUS[j.status] ?? j.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Recebimentos" description="O dinheiro entra no caixa na baixa de cada parcela." />
            <div className="px-4 pt-3">
              <ValueRow label="Vendido" value={formatBRL(order.total)} />
              <ValueRow label="Recebido" value={<span className="text-success">{formatBRL(order.received_amount)}</span>} />
              <ValueRow label="A receber" value={formatBRL(order.open_amount)} strong />
              {order.channel_kind === 'MARKETPLACE' ? <p className="pb-1 text-xs text-muted">Marketplace: o repasse esperado já vem sem a taxa do canal.</p> : null}
            </div>
            {!order.receivable_id ? (
              <p className="px-4 py-3 text-sm text-muted">{order.status === 'RASCUNHO' ? 'As parcelas são criadas ao confirmar o pedido.' : 'Sem valores a receber.'}</p>
            ) : installments.isError ? (
              <div className="p-4">
                <ErrorState error={installments.error} />
              </div>
            ) : !installments.data ? (
              <div className="p-4">
                <LoadingBlock rows={2} />
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-line border-t border-line">
                {insts.map((i) => (
                  <InstallmentItem
                    key={i.id}
                    installment={i}
                    canWrite={write && order.status !== 'CANCELADO'}
                    historical={order.is_historical}
                    onReceive={() => setDialog({ kind: 'receive', installment: i })}
                    onReverse={() => setDialog({ kind: 'reverse', installment: i })}
                  />
                ))}
              </ul>
            )}
            {(refunds.data ?? []).length > 0 ? (
              <div className="border-t border-line px-4 py-3 text-sm">
                <p className="font-medium">Devolução do sinal</p>
                {refunds.data!.map((r) => (
                  <p key={r.id} className="flex justify-between gap-2 text-xs text-muted">
                    <span>
                      {r.status === 'PAGA' ? `Devolvido em ${formatDateBR(r.paid_on)}` : `A pagar · vence ${formatDateBR(r.due_date)}`} (Financeiro → Contas a pagar)
                    </span>
                    <Money value={r.amount} />
                  </p>
                ))}
              </div>
            ) : null}
          </Card>

          {showCosts ? <MarginCard order={order} /> : null}
        </div>
      </div>

      {dialog?.kind === 'deliver' && lines.data ? (
        <DeliverDialog
          order={order}
          lines={lines.data}
          firstDelivery={deliveryList.length === 0}
          open
          onOpenChange={(o) => !o && close()}
          onReceive={() => {
            const next = (installments.data ?? []).find((i) => i.status === 'ABERTA');
            if (next) setDialog({ kind: 'receive', installment: next });
          }}
        />
      ) : null}
      {dialog?.kind === 'cancel' ? <CancelOrderDialog order={order} plannedJobs={plannedJobs} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === 'produce' && lines.data ? <ProduceOrderDialog order={order} lines={lines.data} open onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === 'reserve' || dialog?.kind === 'release' ? <ReservationDialog key={`${dialog.kind}${dialog.line.id}`} line={dialog.line} mode={dialog.kind} onOpenChange={(o) => !o && close()} /> : null}
      {dialog?.kind === 'receive' ? (
        <ReceiveInstallmentDialog key={dialog.installment.id} installment={dialog.installment} onOpenChange={(o) => !o && close()} suggestedFeePct={fee ? toNumber(fee.payment_fee_pct) : null} />
      ) : null}
      <ReasonDialog
        open={dialog?.kind === 'reverse'}
        onOpenChange={(o) => !o && close()}
        title="Estornar o recebimento?"
        description={
          dialog?.kind === 'reverse'
            ? `A parcela ${dialog.installment.number} de ${dialog.installment.of_total} (${formatBRL(dialog.installment.paid_amount)}) volta a ficar em aberto e o lançamento no caixa é estornado. Nada é apagado.`
            : ''
        }
        confirmLabel="Estornar baixa"
        onConfirm={(reason) => (dialog?.kind === 'reverse' ? reverse.mutateAsync({ installmentId: dialog.installment.id, reason }) : Promise.resolve())}
      />
      <div className="mt-6">
        <DocumentHistory
          mainModel="sales_order"
          refs={[
            { model: 'sales_order', ids: [order.id] },
            { model: 'installment', ids: (installments.data ?? []).map((i) => i.id) },
          ]}
        />
      </div>
    </Page>
  );
}

function LineRow({
  line,
  active,
  showStock,
  canWrite,
  onReserve,
  onRelease,
}: {
  line: SalesOrderLineRow;
  active: boolean;
  showStock: boolean;
  canWrite: boolean;
  onReserve: () => void;
  onRelease: () => void;
}) {
  const free = Math.max(toNumber(line.item_free_qty), 0);
  const pending = toNumber(line.qty_pending);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-tight">
            {line.description}
            {line.is_gift ? (
              <Badge tone="accent" className="ml-1.5">
                <Gift className="size-3" /> brinde
              </Badge>
            ) : null}
          </p>
          <p className="text-xs text-muted">
            {line.sku ? `${line.sku} · ` : ''}
            {formatNumber(line.qty)} × {formatBRL(line.unit_price)}
            {toNumber(line.discount) > 0 ? ` − desconto ${formatBRL(line.discount)}` : ''}
          </p>
        </div>
        <Money value={line.line_total} className="shrink-0 font-semibold" />
      </div>
      {showStock && line.item_id ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex flex-wrap gap-1">
            {active ? (
              <Badge tone={toNumber(line.qty_reserved) > 0 ? 'info' : 'neutral'}>
                <Lock className="size-3" /> {formatNumber(line.qty_reserved)} reservada(s)
              </Badge>
            ) : null}
            <Badge tone={toNumber(line.qty_delivered) > 0 ? 'success' : 'neutral'}>{formatNumber(line.qty_delivered)} entregue(s)</Badge>
            {pending > 0 ? <Badge tone="warning">{formatNumber(pending)} pendente(s)</Badge> : null}
            {active ? <Badge>{formatNumber(free)} livre(s) no estoque</Badge> : null}
          </span>
          {canWrite && active ? (
            <span className="ml-auto inline-flex gap-1">
              {pending > 0 ? (
                <Button size="sm" variant="outline" onClick={onReserve} disabled={free <= 0} title={free <= 0 ? 'Sem saldo livre' : undefined}>
                  <Lock /> Reservar
                </Button>
              ) : null}
              {toNumber(line.qty_reserved) > 0 ? (
                <Button size="sm" variant="ghost" onClick={onRelease}>
                  <Unlock /> Liberar
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function InstallmentItem({
  installment: i,
  canWrite,
  historical,
  onReceive,
  onReverse,
}: {
  installment: InstallmentRow;
  canWrite: boolean;
  historical: boolean;
  onReceive: () => void;
  onReverse: () => void;
}) {
  const status =
    i.status === 'PAGA' ? <Badge tone="success">recebida</Badge> : i.status === 'CANCELADA' ? <Badge>cancelada</Badge> : i.is_overdue ? <Badge tone="danger">vencida</Badge> : <Badge tone="warning">em aberto</Badge>;
  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm', i.status === 'CANCELADA' && 'opacity-60')}>
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          {i.of_total > 1 ? `Parcela ${i.number}/${i.of_total}` : 'Parcela única'} {status}
        </span>
        <span className="block text-xs text-muted">
          {i.status === 'PAGA'
            ? `Recebida em ${formatDateBR(i.paid_on)}${i.account_name ? ` · ${i.account_name}` : historical ? ' · antes do sistema' : ''}${toNumber(i.fee_amount) > 0 ? ` · taxa ${formatBRL(i.fee_amount)}` : ''}`
            : `Vence ${formatDateBR(i.due_date)}`}
        </span>
      </span>
      <Money value={i.status === 'PAGA' ? i.paid_amount : i.amount} className="font-semibold" />
      {canWrite && i.status === 'ABERTA' ? (
        <Button size="sm" onClick={onReceive}>
          Receber
        </Button>
      ) : null}
      {canWrite && i.status === 'PAGA' && i.account_id ? (
        <Button size="sm" variant="ghost" onClick={onReverse} title="Estornar baixa">
          <RotateCcw /> Estornar
        </Button>
      ) : null}
    </li>
  );
}

function MarginStat({
  order,
  lines,
  catalogCost,
  fee,
}: {
  order: SalesOrderRow;
  lines: SalesOrderLineRow[];
  catalogCost: (line: SalesOrderLineRow) => number | null;
  fee: ReturnType<typeof currentFee>;
}) {
  const net = toNumber(order.items_subtotal) - toNumber(order.discount_total);
  if (order.contribution_margin !== null) {
    return (
      <Stat
        label="Margem de contribuição"
        value={order.contribution_margin}
        signed
        hint={net > 0 ? `${formatPercent(toNumber(order.contribution_margin) / net)} da receita líquida` : undefined}
      />
    );
  }
  if (order.status === 'CANCELADO' || lines.length === 0) return <Stat label="Margem de contribuição" value={null} format={() => '—'} />;
  const preview = estimateMargin({
    lines: lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price, discount: l.discount, isGift: l.is_gift, unitCost: catalogCost(l) })),
    orderDiscount: order.order_discount,
    shippingCharged: order.shipping_charged,
    fee,
    paymentFee: null,
  });
  return (
    <Stat
      label="Margem estimada"
      value={preview.margin}
      estimated
      estimatedHint="Com o custo médio de hoje e as taxas do canal; o valor real sai na entrega."
      hint={preview.marginPct !== null ? `${formatPercent(preview.marginPct)} · calculada na entrega` : 'Calculada na entrega'}
    />
  );
}

/** Margem de contribuição (RN-13), só com valores reconhecidos na entrega. */
function MarginCard({ order }: { order: SalesOrderRow }) {
  if (order.contribution_margin === null) {
    return (
      <Card className="p-4">
        <h2 className="text-base">Margem de contribuição</h2>
        <p className="mt-1 text-sm text-muted">
          {order.status === 'CANCELADO'
            ? 'Pedido cancelado: não gerou receita.'
            : 'Receita e CMV são reconhecidos na entrega; a margem aparece aqui quando o pedido for entregue por completo. O dinheiro entra no recebimento.'}
        </p>
      </Card>
    );
  }
  const net = toNumber(order.items_subtotal) - toNumber(order.discount_total);
  const layers: Array<[string, number]> = [
    ['material', order.cogs_material],
    ['energia', order.cogs_energy],
    ['depreciação', order.cogs_depreciation],
    ['operacional', order.cogs_operational],
    ['trabalho', order.cogs_labor],
  ];
  const minus = (v: number) => `−${formatBRL(v)}`;
  const row = (label: ReactNode, value: number, hint?: string) => (toNumber(value) !== 0 ? <ValueRow label={label} value={minus(value)} muted hint={hint} /> : null);
  return (
    <Card className="p-4">
      <h2 className="text-base">Margem de contribuição</h2>
      <p className="mb-2 text-xs text-muted">MC = receita líquida − CMV − taxas do canal − taxa de pagamento − embalagem − frete pago − impostos.</p>
      <ValueRow label="Vendido" value={formatBRL(order.total)} hint={toNumber(order.shipping_charged) > 0 ? `inclui frete cobrado ${formatBRL(order.shipping_charged)}` : undefined} />
      <ValueRow label="CMV" value={minus(order.cogs_total)} muted hint={order.is_historical ? 'Custo informado na venda anterior ao sistema' : undefined} />
      <div className="mb-1 ml-3 border-l border-line pl-3">
        {layers
          .filter(([, v]) => toNumber(v) !== 0)
          .map(([label, v]) => (
            <ValueRow key={label} label={<span className="text-xs">{label}</span>} value={<span className="text-xs">{minus(v)}</span>} muted />
          ))}
      </div>
      {row('Taxa do canal', order.channel_fee_total)}
      {row('Taxa de pagamento', order.payment_fee_total)}
      {row('Embalagem', order.packaging_cost_total)}
      {row('Frete pago', order.shipping_cost)}
      {row('Impostos', order.tax_total)}
      {row('Brindes', order.gift_cost_total, 'Despesa de Marketing')}
      <div className="mt-1 border-t border-line pt-1">
        <ValueRow
          strong
          label="Margem de contribuição"
          value={
            <span className={cn(toNumber(order.contribution_margin) < 0 ? 'text-danger' : 'text-success')}>
              {formatBRL(order.contribution_margin)}
              {net > 0 ? <span className="ml-1 text-sm font-normal text-muted">({formatPercent(toNumber(order.contribution_margin) / net)})</span> : null}
            </span>
          }
        />
      </div>
      <p className="mt-2 text-xs text-muted">Receita e CMV entram no resultado na data da entrega; o dinheiro entra no caixa no recebimento.</p>
    </Card>
  );
}
