import { CheckCircle2, ExternalLink, Printer, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { useEquipmentOptions } from '@/data/products';
import {
  DELIVERY_METHOD_LABELS,
  type DeliveryMethod,
  type DeliveryResult,
  type OrderPrintJob,
  type SalesOrderLineRow,
  type SalesOrderRow,
  useBomDeliveryLines,
  useCancelOrder,
  useDeliverOrder,
  useProduceOrder,
  useReleaseReservation,
  useReserveLine,
} from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { describeError } from '@/lib/errors';
import { formatBRL, formatNumber, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { defaultPackaging } from './cart';
import { PackagingEditor } from './packaging-editor';
import { Segmented, ValueRow } from './sales-bits';
import { dateToTimestamp } from './sales-utils';
import { effectivePackaging, type PackagingRow, productKey, useCatalog, usePackagingItems } from './use-catalog';

interface OrderDialogProps {
  order: SalesOrderRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const METHODS = Object.keys(DELIVERY_METHOD_LABELS) as DeliveryMethod[];

/**
 * Entrega (US-6.6): data, forma de envio, rastreio, frete pago, embalagens e entrega
 * parcial por linha. Na entrega o estoque sai e receita, CMV e taxas entram no resultado.
 */
export function DeliverDialog({
  order,
  lines,
  firstDelivery,
  open,
  onOpenChange,
  onReceive,
}: OrderDialogProps & { lines: SalesOrderLineRow[]; firstDelivery: boolean; onReceive?: () => void }) {
  const { today, settings } = useMember();
  const [requestId, renew] = useRequestId();
  const catalog = useCatalog();
  const packagingItems = usePackagingItems();
  const pending = lines.filter((l) => l.item_id && toNumber(l.qty) - toNumber(l.qty_delivered) > 0);
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<DeliveryMethod>(order.channel_kind === 'MARKETPLACE' ? 'MARKETPLACE' : 'RETIRADA');
  const [tracking, setTracking] = useState('');
  const [shippingCost, setShippingCost] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<number, string | null>>(() => Object.fromEntries(pending.map((l) => [l.id, String(toNumber(l.qty) - toNumber(l.qty_delivered))])));
  const [pack, setPack] = useState<PackagingRow[] | null>(null);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bomOf = (l: SalesOrderLineRow) => (l.variant_id ? (catalog.byKey.get(productKey({ variantId: l.variant_id }))?.bomId ?? null) : null);
  const bomIds = pending.map(bomOf).filter((id): id is number => Boolean(id));
  const bomLines = useBomDeliveryLines(bomIds);
  const packagingReady = !catalog.loading && (bomIds.length === 0 || bomLines.data !== undefined);
  const defaults = defaultPackaging(
    pending.map((l) => ({ bomId: bomOf(l), qty: qtys[l.id] })),
    bomLines.data,
    settings.default_order_packaging_item_id,
    firstDelivery,
  );
  const packRows = effectivePackaging(defaults, pack);

  const deliver = useDeliverOrder((r) => {
    renew();
    setResult(r);
  });

  const toDeliver = pending.map((l) => ({ line: l, qty: toNumber(qtys[l.id]) })).filter((x) => x.qty > 0);
  const partial = toDeliver.length < pending.length || toDeliver.some((x) => x.qty < toNumber(x.line.qty) - toNumber(x.line.qty_delivered));
  const short = toDeliver.filter((x) => x.qty > toNumber(x.line.qty_reserved) + Math.max(toNumber(x.line.item_free_qty), 0));

  const submit = () => {
    setError(null);
    if (toDeliver.length === 0) return setError('Informe a quantidade a entregar.');
    const over = toDeliver.find((x) => x.qty > toNumber(x.line.qty) - toNumber(x.line.qty_delivered));
    if (over) return setError(`A quantidade de ${over.line.description} passa do pendente.`);
    deliver.mutate(
      {
        requestId,
        orderId: order.id,
        delivery: {
          delivered_at: dateToTimestamp(date, today()),
          method,
          tracking_code: tracking.trim() || null,
          shipping_cost: shippingCost,
          packaging: packagingReady ? packRows.filter((r) => toNumber(r.qty) > 0).map((r) => ({ item_id: r.itemId, qty: r.qty! })) : undefined,
          lines: toDeliver.map((x) => ({ line_id: x.line.id, qty: String(x.qty) })),
        },
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  if (result) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title={result.status === 'ENTREGUE' ? 'Pedido entregue' : 'Entrega parcial registrada'}
          description="O estoque saiu; receita, CMV e taxas entraram no resultado na data da entrega."
          footer={
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              {onReceive && toNumber(order.open_amount) > 0 ? (
                <Button
                  onClick={() => {
                    onOpenChange(false);
                    onReceive();
                  }}
                >
                  Receber agora
                </Button>
              ) : null}
            </>
          }
        >
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-medium text-success">
              <CheckCircle2 className="size-5" /> Entrega registrada
            </p>
            <div className="rounded-lg bg-subtle px-3 py-2">
              <ValueRow label="Receita da entrega (produtos − descontos)" value={formatBRL(result.revenue)} />
              <ValueRow label="CMV (custo das peças)" value={`−${formatBRL(result.cogs)}`} muted />
              <ValueRow label="Taxa do canal" value={`−${formatBRL(result.channel_fee)}`} muted />
              <ValueRow label="Embalagem" value={`−${formatBRL(result.packaging)}`} muted />
              {toNumber(shippingCost) > 0 ? <ValueRow label="Frete pago" value={`−${formatBRL(shippingCost)}`} muted /> : null}
            </div>
            <p className="text-xs text-muted">
              A margem de contribuição completa (com CMV por camada, taxa de pagamento e impostos) aparece no pedido. O dinheiro só entra no caixa quando a parcela é recebida.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Entregar pedido ${order.number}`}
        description="As peças reservadas saem primeiro; o que faltar sai do saldo livre."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={deliver.isPending} disabled={toDeliver.length === 0}>
              <Truck /> {partial ? 'Registrar entrega parcial' : 'Registrar entrega'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Data da entrega" required>
              <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Como foi entregue">
              <Select value={method} onChange={(e) => setMethod(e.target.value as DeliveryMethod)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {DELIVERY_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            {method === 'CORREIOS' || method === 'MARKETPLACE' ? (
              <Field label="Código de rastreio">
                <Input value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={60} />
              </Field>
            ) : null}
            <Field label="Frete pago pela Wabee" hint="Despesa de venda (entra na margem). O frete cobrado do cliente já está no pedido.">
              <MoneyInput value={shippingCost} onValueChange={setShippingCost} />
            </Field>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold">O que está sendo entregue</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {pending.map((l) => {
                const left = toNumber(l.qty) - toNumber(l.qty_delivered);
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {l.description}
                        {l.is_gift ? <span className="ml-1 text-xs text-accent-ink">(brinde)</span> : null}
                      </p>
                      <p className="text-xs text-muted">
                        Pendente {formatNumber(left)} · reservado {formatNumber(l.qty_reserved)} · livre {formatNumber(Math.max(toNumber(l.item_free_qty), 0))}
                      </p>
                    </div>
                    <DecimalInput
                      decimals={3}
                      aria-label={`Quantidade a entregar de ${l.description}`}
                      className="h-10 w-24"
                      value={qtys[l.id] ?? null}
                      onValueChange={(v) => setQtys((q) => ({ ...q, [l.id]: v }))}
                    />
                  </li>
                );
              })}
            </ul>
            {partial ? <p className="mt-2 text-xs text-muted">Entrega parcial: o restante continua pendente no pedido.</p> : null}
            {short.length > 0 ? (
              <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                Sem estoque suficiente para {short.map((x) => x.line.description).join(', ')} (reservado + livre). Produza antes ou entregue menos.
              </p>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Embalagens usadas</h3>
            <PackagingEditor defaults={defaults} value={pack} onChange={setPack} items={packagingItems.items} showCosts />
            <p className="mt-1 text-xs text-muted">Embalagem é despesa de venda, baixada do estoque na entrega.</p>
          </section>
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cancelamento (US-6.8): motivo, destino do sinal recebido e impressões planejadas. */
export function CancelOrderDialog({ order, open, onOpenChange, plannedJobs }: OrderDialogProps & { plannedJobs: OrderPrintJob[] }) {
  const [requestId, renew] = useRequestId();
  const received = toNumber(order.received_amount);
  const [deposit, setDeposit] = useState<'REFUND' | 'CREDIT'>('REFUND');
  const [cancelJobs, setCancelJobs] = useState(true);
  const cancel = useCancelOrder(() => renew());
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Cancelar o pedido ${order.number}?`}
      description="As reservas voltam ao saldo livre e as parcelas em aberto são canceladas. O pedido continua no histórico como cancelado."
      confirmLabel="Cancelar pedido"
      reasonLabel="Motivo do cancelamento"
      onConfirm={(reason) => cancel.mutateAsync({ requestId, orderId: order.id, reason, depositAction: order.customer_id ? deposit : 'REFUND', cancelPrintJobs: cancelJobs })}
    >
      {received > 0 ? (
        <div className="space-y-2 rounded-lg bg-subtle p-3">
          <p className="text-sm font-medium">O cliente já pagou {formatBRL(received)}. O que fazer com esse valor?</p>
          {order.customer_id ? (
            <Segmented
              label="Destino do sinal"
              value={deposit}
              onChange={setDeposit}
              options={[
                { value: 'REFUND', label: 'Devolver' },
                { value: 'CREDIT', label: 'Crédito do cliente' },
              ]}
              className="w-full"
            />
          ) : null}
          <p className="text-xs text-muted">
            {deposit === 'REFUND'
              ? 'Devolver: cria uma conta a pagar de devolução ao cliente, para baixar quando o dinheiro sair.'
              : 'Fica como crédito no cadastro do cliente, para abater em uma próxima compra.'}
            {order.customer_id ? '' : ' (Sem cliente no pedido, o valor só pode ser devolvido.)'}
          </p>
        </div>
      ) : null}
      {plannedJobs.length > 0 ? (
        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <Checkbox className="mt-0.5" checked={cancelJobs} onChange={(e) => setCancelJobs(e.target.checked)} />
          <span>
            Cancelar também {plannedJobs.length === 1 ? 'a impressão planejada' : `as ${plannedJobs.length} impressões planejadas`} para este pedido ({plannedJobs.map((j) => j.code).join(', ')})
          </span>
        </label>
      ) : null}
    </ReasonDialog>
  );
}

/** Produzir encomenda (US-5.7): planeja uma impressão com o que falta do pedido. */
export function ProduceOrderDialog({ order, lines, open, onOpenChange }: OrderDialogProps & { lines: SalesOrderLineRow[] }) {
  const [requestId, renew] = useRequestId();
  const equipment = useEquipmentOptions();
  const printers = (equipment.data ?? []).filter((e) => e.kind === 'PRINTER' && e.status === 'ATIVO');
  const [equipmentId, setEquipmentId] = useState('');
  const [planned, setPlanned] = useState<{ id: number; code: string } | null>(null);
  const produce = useProduceOrder((r) => {
    renew();
    setPlanned({ id: r.print_job_id, code: r.code });
  });
  const missing = lines.filter((l) => l.variant_id && toNumber(l.qty_pending) > 0);
  const chosen = equipmentId || (printers.length === 1 ? String(printers[0]!.id) : '');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={planned ? `Impressão ${planned.code} planejada` : 'Produzir encomenda'}
        description={planned ? 'Quando as peças forem liberadas, elas são reservadas automaticamente para este pedido.' : 'Planeja uma impressão com o que falta (o que não está reservado nem entregue).'}
        footer={
          planned ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button asChild>
                <Link to={`/producao/impressoes/${planned.id}`}>
                  <ExternalLink /> Abrir a impressão
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link to={`/producao/impressoes/nova?pedido=${order.id}`}>Planejar com detalhes</Link>
              </Button>
              <Button loading={produce.isPending} disabled={!chosen || missing.length === 0} onClick={() => produce.mutate({ requestId, orderId: order.id, equipmentId: Number(chosen) })}>
                <Printer /> Planejar impressão
              </Button>
            </>
          )
        }
      >
        {planned ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-5" /> O pedido passou para “Em produção”.
          </p>
        ) : (
          <div className="space-y-4">
            <ul className="divide-y divide-line rounded-xl border border-line text-sm">
              {missing.length === 0 ? <li className="px-3 py-2.5 text-muted">Nada a produzir: tudo está reservado ou entregue.</li> : null}
              {missing.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 truncate">{l.description}</span>
                  <span className="num shrink-0 font-semibold">{formatNumber(Math.ceil(toNumber(l.qty_pending)))} un</span>
                </li>
              ))}
            </ul>
            <Field label="Impressora" required hint={printers.length === 0 && equipment.data ? 'Nenhuma impressora ativa cadastrada.' : undefined}>
              <Select value={chosen} onChange={(e) => setEquipmentId(e.target.value)}>
                <option value="">Escolha…</option>
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Reservar ou liberar peças de uma linha (US-6.5). */
export function ReservationDialog({ line, mode, onOpenChange }: { line: SalesOrderLineRow; mode: 'reserve' | 'release'; onOpenChange: (open: boolean) => void }) {
  const free = Math.max(toNumber(line.item_free_qty), 0);
  const max = mode === 'reserve' ? Math.min(toNumber(line.qty_pending), free) : toNumber(line.qty_reserved);
  const [qty, setQty] = useState<string | null>(String(max));
  const close = () => onOpenChange(false);
  const reserve = useReserveLine(close);
  const release = useReleaseReservation(close);
  const busy = reserve.isPending || release.isPending;
  const value = toNumber(qty);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={mode === 'reserve' ? 'Reservar peças' : 'Liberar reserva'}
        description={line.description ?? undefined}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button
              loading={busy}
              disabled={value <= 0 || value > max}
              onClick={() => (mode === 'reserve' ? reserve.mutate({ lineId: line.id, qty }) : release.mutate({ lineId: line.id, qty }))}
            >
              {mode === 'reserve' ? 'Reservar' : 'Liberar'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Quantidade" hint={mode === 'reserve' ? `Até ${formatNumber(max)} (pendente ${formatNumber(line.qty_pending)}, livre ${formatNumber(free)})` : `Reservado: ${formatNumber(max)}`}>
            <DecimalInput decimals={3} value={qty} onValueChange={setQty} />
          </Field>
          <p className="text-xs text-muted">
            {mode === 'reserve'
              ? 'Peças reservadas ficam separadas para este pedido: saem do saldo livre (não aparecem na venda rápida nem para outros pedidos), mas continuam no estoque até a entrega.'
              : 'As peças voltam ao saldo livre e podem ser vendidas para outro cliente.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
