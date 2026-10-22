import type { ReactNode } from 'react';
import type { Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { FUNDING_LABELS, PAYER_LABELS } from '@/data/finance';
import { METHOD_LABELS, type PurchaseRow, STATUS_LABELS } from '@/data/purchasing';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { toNumber } from '@/lib/money';
import { PayerBadge, StatusBadge } from './purchase-bits';

/** Colunas da lista de compras (US-3.7), usadas também no fornecedor. */

function installmentsLabel(r: PurchaseRow) {
  if (r.status === 'RASCUNHO') return `${r.installments_count}x (rascunho)`;
  if (r.installments_total_count === 0) return '—';
  return `${r.installments_paid}/${r.installments_total_count} pagas`;
}

function nextDue(r: PurchaseRow, today: string) {
  if (!r.next_due_date) return <span className="text-muted">—</span>;
  const overdue = r.next_due_date < today;
  return <span className={cn('num', overdue && 'font-semibold text-danger')} title={overdue ? 'Parcela vencida' : undefined}>{formatDateBR(r.next_due_date)}</span>;
}

export function purchaseColumns({ showSupplier, today }: { showSupplier: boolean; today: string }): Column<PurchaseRow>[] {
  const cols: Column<PurchaseRow>[] = [
    {
      key: 'number',
      header: 'Compra',
      sortValue: (r) => r.number,
      cell: (r) => (
        <span className="block">
          <span className="inline-flex items-center gap-1.5">
            {r.number}
            {r.is_opening ? <Badge className="font-normal">anterior ao sistema</Badge> : null}
          </span>
          {r.lines_summary ? <span className="block max-w-64 truncate text-xs font-normal text-muted">{r.lines_summary}</span> : null}
        </span>
      ),
    },
    { key: 'date', header: 'Data', sortValue: (r) => `${r.purchased_at}-${String(r.id).padStart(8, '0')}`, cell: (r) => <span className="num">{formatDateBR(r.purchased_at)}</span> },
  ];
  if (showSupplier) cols.push({ key: 'supplier', header: 'Fornecedor', sortValue: (r) => r.supplier_name ?? '', cell: (r) => r.supplier_name ?? <span className="text-muted">—</span> });
  cols.push(
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: (r) => toNumber(r.total),
      cell: (r) => (
        <span className="block">
          <Money value={r.total} className={cn('font-medium', r.status === 'CANCELADA' && 'line-through opacity-70')} />
          {toNumber(r.interest_total) > 0 ? (
            <span className="block text-xs text-muted">
              juros <Money value={r.interest_total} />
            </span>
          ) : null}
        </span>
      ),
    },
    { key: 'status', header: 'Situação', sortValue: (r) => STATUS_LABELS[r.status], cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'payer',
      header: 'Pagador',
      sortValue: (r) => r.payer,
      cell: (r) => (
        <span className="block">
          <PayerBadge payer={r.payer} />
          <span className="block text-xs text-muted">{METHOD_LABELS[r.payment_method]}</span>
        </span>
      ),
    },
    { key: 'installments', header: 'Parcelas', align: 'center', sortValue: (r) => r.installments_total_count - r.installments_paid, cell: (r) => <span className="num text-sm">{installmentsLabel(r)}</span> },
    { key: 'next', header: 'Próx. vencimento', align: 'right', sortValue: (r) => r.next_due_date ?? '9999', cell: (r) => nextDue(r, today) },
  );
  return cols;
}

export function purchaseMobileCard(r: PurchaseRow, today: string, showSupplier = true): ReactNode {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            {r.number} <StatusBadge status={r.status} />
          </p>
          <p className="truncate text-xs text-muted">
            {[showSupplier ? (r.supplier_name ?? 'Sem fornecedor') : null, formatDateBR(r.purchased_at), METHOD_LABELS[r.payment_method]].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money value={r.total} className={cn('block text-sm font-semibold', r.status === 'CANCELADA' && 'line-through opacity-70')} />
          <span className="text-xs text-muted">{installmentsLabel(r)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{r.lines_summary ?? '—'}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {r.payer === 'DONO' ? <PayerBadge payer="DONO" /> : null}
          {r.next_due_date ? <span>próx. {nextDue(r, today)}</span> : null}
        </span>
      </div>
    </div>
  );
}

export const PURCHASE_EXPORT_COLUMNS: ExportColumn<PurchaseRow>[] = [
  { header: 'Número', value: (r) => r.number },
  { header: 'Data', value: (r) => r.purchased_at, kind: 'date' },
  { header: 'Fornecedor', value: (r) => r.supplier_name ?? '' },
  { header: 'Itens', value: (r) => r.lines_summary ?? '' },
  { header: 'Nota/pedido', value: (r) => r.invoice_ref ?? '' },
  { header: 'Situação', value: (r) => STATUS_LABELS[r.status] },
  { header: 'Forma de pagamento', value: (r) => METHOD_LABELS[r.payment_method] },
  { header: 'Conta/cartão', value: (r) => r.payment_account_name ?? '' },
  { header: 'Pagador', value: (r) => PAYER_LABELS[r.payer] },
  { header: 'Tratamento (dono)', value: (r) => (r.payer === 'DONO' && r.owner_funding_type ? FUNDING_LABELS[r.owner_funding_type] : '') },
  { header: 'Bens', value: (r) => r.goods_total, kind: 'money' },
  { header: 'Frete', value: (r) => r.freight_total, kind: 'money' },
  { header: 'Desconto', value: (r) => r.discount_total, kind: 'money' },
  { header: 'Valor à vista', value: (r) => r.cash_price_total, kind: 'money' },
  { header: 'Juros', value: (r) => r.interest_total, kind: 'money' },
  { header: 'Juros desconhecidos', value: (r) => r.interest_unknown, kind: 'boolean' },
  { header: 'Total', value: (r) => r.total, kind: 'money' },
  { header: 'Parcelas pagas', value: (r) => r.installments_paid, kind: 'number' },
  { header: 'Parcelas', value: (r) => r.installments_total_count, kind: 'number' },
  { header: 'Pago pelo dono', value: (r) => r.paid_by_owner, kind: 'money' },
  { header: 'Pago pela empresa', value: (r) => r.paid_by_company, kind: 'money' },
  { header: 'Em aberto', value: (r) => r.open_amount, kind: 'money' },
  { header: 'Próximo vencimento', value: (r) => r.next_due_date, kind: 'date' },
  { header: 'Anterior ao sistema', value: (r) => r.is_opening, kind: 'boolean' },
];
