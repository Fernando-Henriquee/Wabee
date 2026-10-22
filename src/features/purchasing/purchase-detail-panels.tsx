import { HandCoins, RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ColorDot } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type InstallmentRow, PAYER_LABELS, useReverseInstallmentPayment } from '@/data/finance';
import { KIND_LABELS } from '@/data/inventory';
import { isReceivable, type PurchaseLineRow, type PurchaseRow, type ReceiptLineRow, type ReceiptRow, useReverseReceipt } from '@/data/purchasing';
import { PayInstallmentDialog } from '@/features/finance/installment-dialogs';
import { useMember } from '@/features/member/member-context';
import { sumMoney } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { formatQty, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { PurchaseQty } from './purchase-bits';
import type { InstallmentPreview } from './purchase-logic';

function lineName(l: PurchaseLineRow) {
  return (
    <span className="inline-flex items-start gap-2">
      {l.item_kind === 'FILAMENT' ? <ColorDot hex={l.color_hex} className="mt-1" /> : null}
      <span>
        {l.item_id ? (
          <Link to={`/estoque/itens/${l.item_id}`} className="font-medium text-ink underline-offset-4 hover:underline hover:decoration-accent hover:decoration-2">
            {l.item_name ?? l.description}
          </Link>
        ) : (
          <span className="font-medium">{l.description}</span>
        )}
        <span className="block text-xs text-muted">
          {l.line_kind === 'EQUIPMENT' ? 'Equipamento' : l.line_kind === 'EXPENSE' ? `Despesa · ${l.expense_category_code} ${l.expense_category_name}` : `${l.item_kind ? KIND_LABELS[l.item_kind] : ''} · ${l.sku}`}
        </span>
      </span>
    </span>
  );
}

/** Preço/custo por kg no filamento (o banco guarda por grama). */
function perUnit(l: PurchaseLineRow, value: number) {
  if (l.item_kind === 'FILAMENT') {
    return (
      <>
        <Money value={value * 1000} />
        <span className="text-xs text-muted">/kg</span>
      </>
    );
  }
  return <Money value={value} cost />;
}

function receivedCell(l: PurchaseLineRow, status: PurchaseRow['status']) {
  if (!isReceivable(l)) return <span className="text-xs text-muted">despesa na compra</span>;
  if (status === 'RASCUNHO') return <span className="text-xs text-muted">—</span>;
  const pending = toNumber(l.qty_pending);
  if (pending <= 0) return <Badge tone="success">recebido</Badge>;
  if (toNumber(l.qty_received) > 0) return <Badge tone="warning">faltam {formatQty(pending, l.unit ?? 'UN')}</Badge>;
  return <Badge tone="info">a receber</Badge>;
}

export function LinesPanel({ purchase, lines }: { purchase: PurchaseRow; lines: PurchaseLineRow[] }) {
  const { can } = useMember();
  const showCosts = can('costs');
  const columns: Column<PurchaseLineRow>[] = [
    { key: 'item', header: 'Item', cell: lineName },
    { key: 'qty', header: 'Qtd.', align: 'right', cell: (l) => <PurchaseQty qty={l.qty} unit={l.unit ?? 'UN'} filament={l.item_kind === 'FILAMENT'} /> },
  ];
  if (showCosts) {
    columns.push(
      { key: 'price', header: 'Preço', align: 'right', cell: (l) => perUnit(l, toNumber(l.unit_price)) },
      { key: 'total', header: 'Total', align: 'right', cell: (l) => <Money value={l.line_total} /> },
      {
        key: 'alloc',
        header: 'Frete / desc.',
        align: 'right',
        cell: (l) => (
          <span className="text-xs text-muted">
            {toNumber(l.freight_alloc) > 0 ? (
              <>
                +<Money value={l.freight_alloc} />
              </>
            ) : null}
            {toNumber(l.discount_alloc) > 0 ? (
              <>
                {' '}−<Money value={l.discount_alloc} />
              </>
            ) : null}
            {toNumber(l.freight_alloc) === 0 && toNumber(l.discount_alloc) === 0 ? '—' : null}
          </span>
        ),
      },
      { key: 'landed', header: 'Custo de aquisição', align: 'right', cell: (l) => (l.line_kind === 'EXPENSE' ? <Money value={l.landed_total} /> : <span className="font-semibold">{perUnit(l, toNumber(l.landed_unit_cost))}</span>) },
    );
  }
  columns.push({ key: 'received', header: 'Recebimento', align: 'right', cell: (l) => receivedCell(l, purchase.status) });

  return (
    <DataTable
      rows={lines}
      columns={columns}
      getRowId={(l) => String(l.id)}
      emptyTitle="Compra sem linhas"
      emptyDescription="Edite o rascunho para adicionar itens."
      mobileCard={(l) => (
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-sm">{lineName(l)}</div>
            <div className="shrink-0 text-right text-sm">
              <PurchaseQty qty={l.qty} unit={l.unit ?? 'UN'} filament={l.item_kind === 'FILAMENT'} className="block font-medium" />
              {showCosts ? <Money value={l.line_total} className="text-xs text-muted" /> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            {showCosts ? (
              <span>
                Custo de aquisição <span className="font-semibold text-ink">{l.line_kind === 'EXPENSE' ? <Money value={l.landed_total} /> : perUnit(l, toNumber(l.landed_unit_cost))}</span>
                {toNumber(l.freight_alloc) > 0 ? <> · frete <Money value={l.freight_alloc} /></> : null}
              </span>
            ) : (
              <span />
            )}
            {receivedCell(l, purchase.status)}
          </div>
        </div>
      )}
      footer={
        showCosts ? (
          <>
            <tr>
              <td className="px-3 py-2 text-sm" colSpan={3}>
                Itens
              </td>
              <td className="px-3 py-2 text-right text-sm">
                <Money value={purchase.goods_total} />
              </td>
              <td className="px-3 py-2 text-right text-xs text-muted">
                {toNumber(purchase.freight_total) > 0 ? <>frete +<Money value={purchase.freight_total} /></> : null}
                {toNumber(purchase.discount_total) > 0 ? <> desc. −<Money value={purchase.discount_total} /></> : null}
              </td>
              <td className="px-3 py-2 text-right text-sm font-semibold">
                <Money value={purchase.cash_price_total} />
              </td>
              <td className="px-3 py-2 text-right text-xs text-muted">à vista</td>
            </tr>
          </>
        ) : undefined
      }
    />
  );
}

function installmentStatus(i: InstallmentRow) {
  if (i.status === 'PAGA') return <Badge tone="success">paga {formatDateBR(i.paid_on)}</Badge>;
  if (i.status === 'CANCELADA') return <Badge>cancelada</Badge>;
  if (i.is_overdue) return <Badge tone="danger">vencida</Badge>;
  return <Badge tone="info">em aberto</Badge>;
}

interface InstallmentsPanelProps {
  purchase: PurchaseRow;
  installments: InstallmentRow[] | undefined;
  error: unknown;
  /** Rascunho: prévia das parcelas (criadas ao confirmar). */
  preview: InstallmentPreview[] | null;
  refunds: InstallmentRow[] | undefined;
}

export function InstallmentsPanel({ purchase, installments, error, preview, refunds }: InstallmentsPanelProps) {
  const { can } = useMember();
  const [paying, setPaying] = useState<InstallmentRow | null>(null);
  const [reversing, setReversing] = useState<InstallmentRow | null>(null);
  const reverse = useReverseInstallmentPayment(() => setReversing(null));

  if (purchase.status === 'RASCUNHO') {
    if (!preview) return <LoadingBlock rows={2} />;
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">Prévia: as parcelas são criadas ao confirmar a compra.</p>
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
          {preview.map((row, i) => (
            <li key={i} className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm">
              <span className="w-12 text-xs text-muted">
                {i + 1}/{preview.length}
              </span>
              <span className="num">vence {formatDateBR(row.due_date)}</span>
              <Money value={row.amount} className="ml-auto font-medium" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (error) return <ErrorState error={error} />;
  if (!installments) return <LoadingBlock rows={3} />;
  const active = installments.filter((i) => i.status !== 'CANCELADA');
  return (
    <div className="space-y-3">
      {installments.length === 0 ? (
        <EmptyState title="Sem parcelas" description="Esta compra não gerou conta a pagar." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
          {installments.map((i) => (
            <li key={i.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm', i.status === 'CANCELADA' && 'opacity-60')}>
              <span className="w-12 shrink-0 text-xs text-muted">
                {i.number}/{i.of_total}
              </span>
              <span className="min-w-0 flex-1">
                <span className="num font-medium">vence {formatDateBR(i.due_date)}</span> {installmentStatus(i)}
                <span className="block text-xs text-muted">
                  {i.status === 'PAGA'
                    ? `por ${PAYER_LABELS[i.payer].toLowerCase()}${i.account_name ? ` · ${i.account_name}` : ''}`
                    : `pagador previsto: ${PAYER_LABELS[i.payer].toLowerCase()}`}
                  {toNumber(i.interest) > 0 ? (
                    <>
                      {' '}· juros <Money value={i.interest} />
                    </>
                  ) : null}
                </span>
              </span>
              <span className="text-right">
                <Money value={i.status === 'PAGA' ? (i.paid_amount ?? i.amount) : i.amount} className="font-semibold" />
              </span>
              {can('write') && i.status === 'ABERTA' ? (
                <Button size="sm" variant="outline" onClick={() => setPaying(i)}>
                  <HandCoins /> Pagar
                </Button>
              ) : can('write') && i.status === 'PAGA' ? (
                <Button size="sm" variant="ghost" onClick={() => setReversing(i)}>
                  <Undo2 /> Estornar baixa
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {active.length > 0 ? (
        <p className="text-right text-xs text-muted">
          Total <Money value={sumMoney(active.map((i) => i.amount))} /> · pago <Money value={sumMoney(active.filter((i) => i.status === 'PAGA').map((i) => i.paid_amount ?? i.amount))} />
        </p>
      ) : null}
      {refunds && refunds.length > 0 ? (
        <div className="rounded-[var(--radius-card)] border border-info/30 bg-info-soft p-3 text-sm text-info">
          <p className="font-semibold">Reembolso a receber do fornecedor</p>
          <ul className="mt-1 space-y-0.5">
            {refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {r.title_number} · vence {formatDateBR(r.due_date)} · {r.status === 'PAGA' ? `recebido ${formatDateBR(r.paid_on)}` : 'em aberto'}
                </span>
                <Money value={r.amount} className="font-semibold" />
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">O que já tinha sido pago virou conta a receber; dê baixa em Financeiro → Contas a receber quando o dinheiro voltar.</p>
        </div>
      ) : null}
      <PayInstallmentDialog key={paying?.id ?? 'none'} installment={paying} onOpenChange={(open) => !open && setPaying(null)} />
      <ReasonDialog
        open={reversing !== null}
        onOpenChange={(open) => !open && setReversing(null)}
        title="Estornar a baixa desta parcela?"
        description={reversing ? `A parcela ${reversing.number}/${reversing.of_total} volta a ficar em aberto e o pagamento é revertido (caixa ou movimento do dono).` : ''}
        confirmLabel="Estornar baixa"
        onConfirm={(reason) => reverse.mutateAsync({ installmentId: reversing!.id, reason })}
      />
    </div>
  );
}

type ReceiptWithLines = ReceiptRow & { lines: ReceiptLineRow[] };

export function ReceiptsPanel({ receipts, lines, error }: { receipts: ReceiptWithLines[] | undefined; lines: PurchaseLineRow[]; error: unknown }) {
  const { can, settings } = useMember();
  const [requestId, renew] = useRequestId();
  const [reversing, setReversing] = useState<ReceiptWithLines | null>(null);
  const reverse = useReverseReceipt(() => {
    renew();
    setReversing(null);
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));
  if (error) return <ErrorState error={error} />;
  if (!receipts) return <LoadingBlock rows={2} />;
  if (receipts.length === 0) return <EmptyState title="Nenhum recebimento" description="Ao receber a mercadoria, os carretéis viram lotes e os itens entram no estoque pelo custo de aquisição." />;
  return (
    <>
      <ul className="space-y-3">
        {receipts.map((r) => (
          <li key={r.id} className={cn('rounded-[var(--radius-card)] border border-line bg-panel p-3', r.reversed_at && 'opacity-70')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Recebimento #{r.id}</span>
              <span className="text-xs text-muted">{formatDateTimeBR(r.received_at, settings.timezone)}</span>
              {r.reversed_at ? <Badge tone="danger">estornado {formatDateBR(r.reversed_at.slice(0, 10))}</Badge> : <Badge tone="success">ativo</Badge>}
              {can('write') && !r.reversed_at ? (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setReversing(r)}>
                  <RotateCcw /> Estornar recebimento
                </Button>
              ) : null}
            </div>
            {r.reverse_reason ? <p className="mt-1 text-xs text-muted">Motivo: {r.reverse_reason}</p> : null}
            <ul className="mt-2 divide-y divide-line/70 text-sm">
              {r.lines.map((rl) => {
                const line = lineById.get(rl.purchase_line_id);
                return (
                  <li key={rl.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1.5">
                        {line?.item_kind === 'FILAMENT' ? <ColorDot hex={line.color_hex} /> : null}
                        {line?.item_name ?? line?.description ?? `Linha ${rl.purchase_line_id}`}
                      </span>
                      {rl.lot_codes.length > 0 ? (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {rl.lot_codes.map((code) =>
                            line?.item_id ? (
                              <Link key={code} to={`/estoque/itens/${line.item_id}`} className="rounded-md bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink-soft hover:bg-accent-soft">
                                {code}
                              </Link>
                            ) : (
                              <span key={code} className="rounded-md bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink-soft">
                                {code}
                              </span>
                            ),
                          )}
                        </span>
                      ) : null}
                      {rl.equipment_ids.length > 0 ? <span className="block text-xs text-muted">{rl.equipment_ids.length} equipamento(s) cadastrado(s) no imobilizado</span> : null}
                    </span>
                    <span className="num text-right font-medium">
                      {line?.line_kind === 'EQUIPMENT' ? `${toNumber(rl.qty)} un` : formatQty(rl.stock_qty, line?.unit ?? 'UN')}
                      {rl.spool_count ? <span className="block text-xs font-normal text-muted">{rl.spool_count} carretel(is)</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <ReasonDialog
        open={reversing !== null}
        onOpenChange={(open) => !open && setReversing(null)}
        title="Estornar este recebimento?"
        description="As entradas no estoque são revertidas (carretéis já usados bloqueiam o estorno) e os equipamentos criados são baixados. A compra volta a ficar a receber."
        confirmLabel="Estornar recebimento"
        onConfirm={(reason) => reverse.mutateAsync({ requestId, receiptId: reversing!.id, reason })}
      />
    </>
  );
}
