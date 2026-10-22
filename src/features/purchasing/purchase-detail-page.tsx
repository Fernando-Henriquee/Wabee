import { ArrowLeft, Ban, CheckCheck, PackageCheck, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { DocumentHistory } from '@/components/shared/document-history';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { DecimalInput } from '@/components/ui/money-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { FUNDING_LABELS, useAccounts, useInstallments } from '@/data/finance';
import {
  isReceivable,
  METHOD_LABELS,
  type PurchaseLineRow,
  type PurchaseRow,
  useCancelPurchase,
  useConfirmPurchase,
  useDiscardPurchaseDraft,
  usePurchase,
  usePurchaseLines,
  usePurchaseRecord,
  useReceipts,
} from '@/data/purchasing';
import { useMember } from '@/features/member/member-context';
import { suggestFirstDueDate, sumMoney } from '@/lib/calc';
import { formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { Callout, NoPurchaseAccess, PayerBadge, StatusBadge } from './purchase-bits';
import { InstallmentsPanel, LinesPanel, ReceiptsPanel } from './purchase-detail-panels';
import { buildInstallments, type InstallmentPreview, scheduleDates } from './purchase-logic';
import { ReceiveDialog } from './receive-dialog';

type DialogKind = 'confirm' | 'confirm-receive' | 'receive' | 'cancel' | 'discard' | null;

function initialDialog(action: string | null): DialogKind {
  if (action === 'confirmar') return 'confirm';
  if (action === 'receber') return 'confirm-receive';
  return null;
}

export function PurchaseDetailPage() {
  const { id } = useParams();
  const purchaseId = Number(id);
  const { can } = useMember();
  const purchase = usePurchase(purchaseId);
  const lines = usePurchaseLines(purchaseId ? [purchaseId] : undefined);
  if (!can('costs')) return <NoPurchaseAccess title="Compra" />;
  const error = purchase.error ?? lines.error;
  if (error) return <Page><ErrorState error={error} onRetry={() => void purchase.refetch()} /></Page>;
  if (purchase.data === undefined || lines.data === undefined) return <Page><LoadingBlock /></Page>;
  if (purchase.data === null) {
    return (
      <Page>
        <EmptyState title="Compra não encontrada" description="Ela pode ter sido descartada ainda como rascunho." action={<Button asChild variant="outline"><Link to="/compras">Voltar às compras</Link></Button>} />
      </Page>
    );
  }
  return <PurchaseDetail purchase={purchase.data} lines={lines.data} />;
}

function PurchaseDetail({ purchase, lines }: { purchase: PurchaseRow; lines: PurchaseLineRow[] }) {
  const navigate = useNavigate();
  const { can, today, settings } = useMember();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialogState] = useState<DialogKind>(() => (purchase.status === 'RASCUNHO' && can('write') ? initialDialog(params.get('acao')) : null));
  const [paidCount, setPaidCount] = useState<number | null>(() => (params.get('pagas') !== null ? Math.trunc(toNumber(params.get('pagas'))) : null));
  const [tab, setTab] = useState('lines');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const draft = purchase.status === 'RASCUNHO';
  const record = usePurchaseRecord(draft ? purchase.id : undefined);
  const accounts = useAccounts();
  const installments = useInstallments({ sourceType: 'purchase', sourceId: purchase.id }, !draft);
  const refunds = useInstallments({ sourceType: 'purchase_refund', sourceId: purchase.id }, purchase.status === 'CANCELADA');
  const receipts = useReceipts(purchase.id);
  const [confirmId, renewConfirm] = useRequestId();
  const [cancelId, renewCancel] = useRequestId();
  const confirm = useConfirmPurchase(renewConfirm);
  const cancel = useCancelPurchase(renewCancel);
  const discard = useDiscardPurchaseDraft(() => navigate('/compras', { replace: true }));

  const setDialog = (next: DialogKind) => {
    setDialogState(next);
    if (next === null && params.has('acao')) {
      const updated = new URLSearchParams(params);
      updated.delete('acao');
      updated.delete('pagas');
      setParams(updated, { replace: true });
    }
  };

  // Rascunho: prévia das parcelas com as mesmas regras do banco (vencimento sugerido pelo cartão).
  const preview = useMemo<InstallmentPreview[] | null>(() => {
    if (!draft || !record.data || !accounts.data) return null;
    const r = record.data;
    if (r.custom_installments && r.custom_installments.length > 0) return r.custom_installments.map((c) => ({ due_date: c.due_date, amount: String(c.amount), edited: true, adjusted: false }));
    const account = accounts.data.find((a) => a.id === r.payment_account_id);
    const card = account?.kind === 'CARTAO_CREDITO' ? account : null;
    const first = r.first_due_date ?? suggestFirstDueDate(r.purchased_at, card?.card_closing_day ?? null, card?.card_due_day ?? null);
    return buildInstallments(scheduleDates(r.payment_method, r.purchased_at, first, r.installments_count), purchase.total, {}).rows;
  }, [draft, record.data, accounts.data, purchase.total]);

  const suggestedPaid = preview ? preview.filter((p) => p.due_date < today()).length : 0;
  const effectivePaid = paidCount ?? suggestedPaid;
  const receivableLines = lines.filter((l) => isReceivable(l));
  const hasPending = receivableLines.some((l) => toNumber(l.qty_pending) > 0);
  const activeReceipts = (receipts.data ?? []).filter((r) => !r.reversed_at);
  const paidTotal = sumMoney([purchase.paid_by_owner, purchase.paid_by_company]);
  const writable = can('write');

  const cancelPurchase = async (reason: string) => {
    setCancelError(null);
    try {
      await cancel.mutateAsync({ requestId: cancelId, purchaseId: purchase.id, reason });
    } catch (e) {
      setCancelError(describeError(e));
      if ((e as { hint?: string }).hint === 'estornar_recebimentos') setTab('receipts');
    }
  };

  const confirmDescription = (() => {
    const n = preview?.length ?? purchase.installments_count;
    const parts = [`Cria a conta a pagar de ${formatBRL(purchase.total)}`];
    if (['PIX', 'DINHEIRO', 'DEBITO'].includes(purchase.payment_method)) parts.push(`já paga em ${formatDateBR(purchase.purchased_at)}${purchase.payment_account_name ? ` pela conta ${purchase.payment_account_name}` : ''}`);
    else parts.push(`em ${n} parcela(s)${preview?.[0] ? `, a 1ª vencendo em ${formatDateBR(preview[0].due_date)}` : ''}`);
    return `${parts.join(', ')}. Despesas e ferramentas da compra entram no resultado na data da compra. O estoque só muda ao receber.`;
  })();

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/compras" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Compras
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-2.5">
            {purchase.number} <StatusBadge status={purchase.status} className="font-sans text-sm" />
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {purchase.supplier_id ? (
              <Link to={`/fornecedores/${purchase.supplier_id}`} className="font-medium text-ink-soft underline decoration-accent decoration-2 underline-offset-2">
                {purchase.supplier_name}
              </Link>
            ) : (
              <span>Sem fornecedor</span>
            )}
            <span>· {formatDateBR(purchase.purchased_at)}</span>
            {purchase.invoice_ref ? <span>· nota/pedido {purchase.invoice_ref}</span> : null}
            <span>
              · {METHOD_LABELS[purchase.payment_method]}
              {purchase.payment_account_name ? ` (${purchase.payment_account_name})` : ''}
            </span>
            <PayerBadge payer={purchase.payer} funding={purchase.owner_funding_type} />
            {purchase.is_opening ? <Badge>anterior ao sistema</Badge> : null}
            {purchase.manually_allocated ? <Badge>rateio manual</Badge> : null}
          </span>
        }
        actions={
          writable ? (
            draft ? (
              <>
                <Button variant="danger-outline" onClick={() => setDialog('discard')}>
                  <Trash2 /> Descartar
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/compras/${purchase.id}/editar`}>
                    <Pencil /> Editar
                  </Link>
                </Button>
                {receivableLines.length > 0 ? (
                  <Button variant="accent" onClick={() => setDialog('confirm-receive')}>
                    <PackageCheck /> Confirmar e receber
                  </Button>
                ) : null}
                <Button onClick={() => setDialog('confirm')}>
                  <CheckCheck /> Confirmar
                </Button>
              </>
            ) : purchase.status !== 'CANCELADA' ? (
              <>
                <Button variant="danger-outline" onClick={() => setDialog('cancel')}>
                  <Ban /> Cancelar compra
                </Button>
                {hasPending ? (
                  <Button onClick={() => setDialog('receive')}>
                    <PackageCheck /> Receber
                  </Button>
                ) : null}
              </>
            ) : undefined
          ) : undefined
        }
      />

      {purchase.status === 'CANCELADA' ? (
        <Callout tone="danger" title={`Cancelada em ${formatDateTimeBR(purchase.canceled_at, settings.timezone)}`} className="mb-4">
          {purchase.cancel_reason}
        </Callout>
      ) : null}
      {cancelError ? (
        <Callout
          tone="danger"
          title="Não foi possível cancelar"
          className="mb-4"
          action={
            activeReceipts.length > 0 ? (
              <Button size="sm" className="h-10 sm:h-8" variant="danger-outline" onClick={() => setTab('receipts')}>
                Ver recebimentos
              </Button>
            ) : undefined
          }
        >
          {cancelError} {activeReceipts.length > 0 ? 'Estorne cada recebimento abaixo e tente de novo.' : null}
        </Callout>
      ) : null}
      {draft ? (
        <Callout tone="info" className="mb-4">
          Rascunho: nada foi lançado no estoque nem no financeiro. Confirme para criar a conta a pagar; receba para dar entrada no estoque.
        </Callout>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={toNumber(purchase.interest_total) > 0 ? 'Total parcelado' : 'Total'}
          value={purchase.total}
          hint={
            purchase.interest_unknown
              ? 'Sem valor à vista: juros embutidos no custo'
              : toNumber(purchase.interest_total) > 0
                ? `À vista ${formatBRL(purchase.cash_price_total)} · juros ${formatBRL(purchase.interest_total)}`
                : toNumber(purchase.freight_total) > 0
                  ? `Inclui frete de ${formatBRL(purchase.freight_total)}`
                  : undefined
          }
        />
        <Stat label="Pago pela empresa" value={purchase.paid_by_company} hint="Saiu do caixa da empresa" />
        <Stat
          label="Pago pelo dono"
          value={purchase.paid_by_owner}
          tone={toNumber(purchase.paid_by_owner) > 0 ? 'positive' : 'default'}
          hint={purchase.payer === 'DONO' && purchase.owner_funding_type ? `Vira ${FUNDING_LABELS[purchase.owner_funding_type].toLowerCase()}` : 'Conta ou cartão pessoal'}
        />
        <Stat
          label="Em aberto"
          value={purchase.open_amount}
          tone={toNumber(purchase.open_amount) > 0 ? 'warning' : 'default'}
          hint={purchase.next_due_date ? `Próx. vencimento ${formatDateBR(purchase.next_due_date)}` : draft ? 'Parcelas criadas ao confirmar' : undefined}
        />
        <Stat
          label="Parcelas pagas"
          value={purchase.installments_paid}
          format={() => (draft ? `0/${preview?.length ?? purchase.installments_count}` : `${purchase.installments_paid}/${purchase.installments_total_count}`)}
          hint={draft ? 'Rascunho' : `${formatBRL(paidTotal)} pagos`}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="lines">Itens ({lines.length})</TabsTrigger>
          <TabsTrigger value="installments">Parcelas{draft ? '' : ` (${purchase.installments_total_count})`}</TabsTrigger>
          <TabsTrigger value="receipts">Recebimentos{receipts.data ? ` (${receipts.data.length})` : ''}</TabsTrigger>
          {can('audit') ? <TabsTrigger value="history">Histórico</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="lines">
          <LinesPanel purchase={purchase} lines={lines} />
          {purchase.notes ? <p className="mt-3 whitespace-pre-line rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">{purchase.notes}</p> : null}
        </TabsContent>
        <TabsContent value="installments">
          <InstallmentsPanel purchase={purchase} installments={installments.data} error={installments.error} preview={preview} refunds={refunds.data} />
        </TabsContent>
        <TabsContent value="receipts">
          <ReceiptsPanel receipts={receipts.data} lines={lines} error={receipts.error} />
        </TabsContent>
        <TabsContent value="history">
          <DocumentHistory
            mainModel="purchase"
            refs={[
              { model: 'purchase', ids: [purchase.id] },
              { model: 'payable', ids: [purchase.payable_id] },
              { model: 'receipt', ids: (receipts.data ?? []).map((r) => r.id) },
              { model: 'installment', ids: (installments.data ?? []).map((i) => i.id) },
            ]}
          />
        </TabsContent>
      </Tabs>

      {dialog === 'receive' || dialog === 'confirm-receive' ? (
        <ReceiveDialog
          key={dialog}
          purchase={purchase}
          lines={lines}
          mode={dialog === 'confirm-receive' ? 'confirm' : 'receive'}
          onOpenChange={(open) => !open && setDialog(null)}
          paidCount={effectivePaid}
          installmentsCount={preview?.length ?? purchase.installments_count}
          onPaidCountChange={purchase.is_opening ? setPaidCount : undefined}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === 'confirm'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Confirmar a compra ${purchase.number}?`}
        description={confirmDescription}
        confirmLabel="Confirmar compra"
        tone="primary"
        confirmDisabled={purchase.is_opening && (effectivePaid < 0 || effectivePaid > (preview?.length ?? purchase.installments_count))}
        onConfirm={() => confirm.mutateAsync({ requestId: confirmId, purchaseId: purchase.id, paidCount: purchase.is_opening ? effectivePaid : 0 })}
      >
        {purchase.is_opening ? (
          <Field label="Quantas parcelas já foram pagas" hint={`De ${preview?.length ?? purchase.installments_count}. Ficam baixadas na data de cada vencimento${purchase.payer === 'DONO' ? ' como pagas pelo dono' : ''}. Sugestão: ${suggestedPaid} (vencidas até hoje).`}>
            <DecimalInput decimals={0} value={String(effectivePaid)} onValueChange={(v) => setPaidCount(Math.trunc(toNumber(v)))} />
          </Field>
        ) : undefined}
      </ConfirmDialog>
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Cancelar a compra ${purchase.number}?`}
        description={
          activeReceipts.length > 0
            ? `Esta compra tem ${activeReceipts.length} recebimento(s) ativo(s): estorne-os antes (aba Recebimentos), senão o cancelamento será recusado.`
            : toNumber(paidTotal) > 0
              ? `As parcelas em aberto serão canceladas. Os ${formatBRL(paidTotal)} já pagos viram uma conta a receber (reembolso do fornecedor).`
              : 'As parcelas em aberto serão canceladas e as despesas da compra saem do resultado.'
        }
        confirmLabel="Cancelar compra"
        onConfirm={cancelPurchase}
      />
      <ConfirmDialog
        open={dialog === 'discard'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Descartar este rascunho?"
        description="Ele não gerou nada no estoque nem no financeiro. O número fica registrado como descartado."
        confirmLabel="Descartar"
        onConfirm={() => discard.mutateAsync(purchase.id)}
      />
    </Page>
  );
}
