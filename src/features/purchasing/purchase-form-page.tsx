import Big from 'big.js';
import { ArrowLeft, ChevronsUpDown, PackageCheck, Plus, Save, Store } from 'lucide-react';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { EntityPicker, type PickerOption } from '@/components/shared/entity-picker';
import { ColorDot } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Textarea } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type FinancialCategory, FUNDING_LABELS, type PaymentAccount, type Payer, useAccounts, useCategories } from '@/data/finance';
import { type ItemKind, type ItemRow, KIND_LABELS, useItems, useSuppliers } from '@/data/inventory';
import {
  EXPENSE_NATURES,
  type LineKind,
  METHOD_LABELS,
  type PurchaseDraftInput,
  type PurchaseLineRow,
  type PurchaseRecord,
  usePurchaseLines,
  usePurchaseRecord,
  useSavePurchaseDraft,
} from '@/data/purchasing';
import { type AppSettings, useMember } from '@/features/member/member-context';
import { previewPurchaseLines, suggestFirstDueDate, sumMoney } from '@/lib/calc';
import { addDays, formatDateBR, isValidISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, toNumber } from '@/lib/money';
import { Callout, NoPurchaseAccess, PayerBadge } from './purchase-bits';
import { PurchaseLineEditor } from './purchase-line-editor';
import {
  accountsFor,
  buildInstallments,
  editedFromCustom,
  fitLinesToTotal,
  hasInstallments,
  isCardMethod,
  isCashMethod,
  type LineDraft,
  lineFromRow,
  lineQty,
  lineUnitPrice,
  newLine,
  scheduleDates,
} from './purchase-logic';
import { type PaymentState, PurchasePayment } from './purchase-payment';
import { QuickItemDialog } from './quick-item-dialog';

interface FormState extends PaymentState {
  supplierId: number | null;
  newSupplierName: string;
  purchasedAt: string;
  invoiceRef: string;
  notes: string;
  freight: string | null;
  discount: string | null;
  lines: LineDraft[];
  isOpening: boolean;
  manuallyAllocated: boolean;
  /** Compra anterior ao sistema: parcelas já pagas (usado ao confirmar). null = sugestão. */
  paidCount: string | null;
}

function emptyForm(settings: AppSettings, today: string, supplierId: number | null): FormState {
  return {
    supplierId,
    newSupplierName: '',
    purchasedAt: today,
    invoiceRef: '',
    notes: '',
    freight: null,
    discount: null,
    lines: [newLine('n0')],
    isOpening: false,
    manuallyAllocated: false,
    paidCount: null,
    method: 'PIX',
    accountId: null,
    payer: 'EMPRESA',
    funding: settings.default_owner_funding_type,
    countText: '1',
    firstDue: null,
    installmentsTotal: null,
    interestUnknown: false,
    edited: {},
  };
}

function formFromDraft(record: PurchaseRecord, lines: PurchaseLineRow[], settings: AppSettings): FormState {
  const total = record.installments_total ?? record.cash_price_total;
  return {
    supplierId: record.supplier_id,
    newSupplierName: '',
    purchasedAt: record.purchased_at,
    invoiceRef: record.invoice_ref ?? '',
    notes: record.notes ?? '',
    freight: toNumber(record.freight_total) > 0 ? String(record.freight_total) : null,
    discount: toNumber(record.discount_total) > 0 ? String(record.discount_total) : null,
    lines: lines.length > 0 ? lines.map((l) => lineFromRow(l, l.nominal_spool_g)) : [newLine('n0')],
    isOpening: record.is_opening,
    manuallyAllocated: record.manually_allocated,
    paidCount: null,
    method: record.payment_method,
    accountId: record.payment_account_id,
    payer: record.payer,
    funding: record.owner_funding_type ?? settings.default_owner_funding_type,
    countText: String(record.installments_count),
    firstDue: record.first_due_date,
    installmentsTotal: record.installments_total === null ? null : String(record.installments_total),
    interestUnknown: record.interest_unknown,
    edited: editedFromCustom(record.custom_installments, total),
  };
}

export function PurchaseFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { can, settings, today } = useMember();
  const purchaseId = id ? Number(id) : undefined;
  const record = usePurchaseRecord(purchaseId);
  const lines = usePurchaseLines(purchaseId ? [purchaseId] : undefined);

  if (!can('costs')) return <NoPurchaseAccess title="Compra" />;
  if (!can('write')) {
    return (
      <Page>
        <PageHeader title="Compra" />
        <EmptyState title="Somente o dono registra compras" description="Seu perfil pode consultar as compras, mas não lançar ou alterar." />
      </Page>
    );
  }
  if (purchaseId) {
    const error = record.error ?? lines.error;
    if (error) return <Page><ErrorState error={error} onRetry={() => void record.refetch()} /></Page>;
    if (record.data === undefined || lines.data === undefined) return <Page><LoadingBlock /></Page>;
    if (record.data === null) {
      return (
        <Page>
          <EmptyState title="Compra não encontrada" action={<Button asChild variant="outline"><Link to="/compras">Voltar às compras</Link></Button>} />
        </Page>
      );
    }
    if (record.data.status !== 'RASCUNHO') {
      return (
        <Page>
          <EmptyState
            title={`A compra ${record.data.number} já foi confirmada`}
            description="Só rascunhos podem ser alterados. Para corrigir uma compra confirmada, cancele-a (com motivo) e lance de novo."
            action={<Button asChild variant="outline"><Link to={`/compras/${purchaseId}`}>Abrir a compra</Link></Button>}
          />
        </Page>
      );
    }
    return <PurchaseForm key={purchaseId} purchaseId={purchaseId} number={record.data.number} initial={formFromDraft(record.data, lines.data, settings)} />;
  }
  const supplierParam = Number(params.get('fornecedor'));
  return <PurchaseForm key="new" initial={emptyForm(settings, today(), Number.isInteger(supplierParam) && supplierParam > 0 ? supplierParam : null)} />;
}

function Section({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={actions} />
      <div className="p-4">{children}</div>
    </Card>
  );
}

function SummaryRow({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 text-sm ${strong ? 'font-semibold text-ink' : muted ? 'text-muted' : 'text-ink-soft'}`}>
      <dt>{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}

function categoryGroupsOf(categories: FinancialCategory[] | undefined) {
  const list = categories ?? [];
  return list
    .filter((c) => c.parent_id === null && EXPENSE_NATURES.includes(c.nature))
    .map((parent) => ({ parent, children: list.filter((c) => c.parent_id === parent.id && c.active) }))
    .filter((g) => g.children.length > 0);
}

function PurchaseForm({ purchaseId, number, initial }: { purchaseId?: number; number?: string; initial: FormState }) {
  const navigate = useNavigate();
  const { can, settings, today } = useMember();
  const showCosts = can('costs');
  const items = useItems({ includeInactive: true });
  const suppliers = useSuppliers(true);
  const accounts = useAccounts();
  const categories = useCategories();
  const [form, setForm] = useState<FormState>(initial);
  const [picking, setPicking] = useState<'supplier' | { lineKey: string } | null>(null);
  const [creatingItem, setCreatingItem] = useState<{ lineKey: string; name: string; kind?: ItemKind } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [action, setAction] = useState<'detail' | 'confirm' | 'receive'>('detail');
  const keySeq = useRef(1);
  const save = useSavePurchaseDraft();

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const setLine = (key: string, patch: Partial<LineDraft>) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const addLine = (kind: LineKind) => setForm((f) => ({ ...f, lines: [...f.lines, newLine(`n${keySeq.current++}`, kind)] }));

  const itemsById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const accountList: PaymentAccount[] = useMemo(() => accounts.data ?? [], [accounts.data]);
  const categoryGroups = useMemo(() => categoryGroupsOf(categories.data), [categories.data]);
  const supplier = (suppliers.data ?? []).find((s) => s.id === form.supplierId) ?? null;

  // ---- Prévia (RN-02, RN-03): o banco recalcula tudo ao salvar e ao confirmar. ----
  const isFilament = (l: LineDraft) => l.kind === 'ITEM' && itemsById.get(l.itemId ?? -1)?.kind === 'FILAMENT';
  const previews = previewPurchaseLines(
    form.lines.map((l) => ({ qty: lineQty(l, isFilament(l)) ?? '0', unitPrice: lineUnitPrice(l, isFilament(l)) ?? '0' })),
    form.freight ?? '0',
    form.discount ?? '0',
  );
  const goods = sumMoney(previews.map((p) => p.lineTotal));
  const cashTotal = new Big(goods).plus(form.freight ?? 0).minus(form.discount ?? 0).toFixed(2);
  const multi = hasInstallments(form.method);
  const installmentsTotal = multi && form.installmentsTotal !== null ? new Big(form.installmentsTotal).toFixed(2) : cashTotal;
  const interest = new Big(installmentsTotal).minus(cashTotal).toFixed(2);
  const count = multi ? Math.trunc(toNumber(form.countText)) : 1;
  const countValid = !multi || (count >= 1 && count <= 48);
  const account = accountList.find((a) => a.id === form.accountId) ?? null;
  const accountFits = !account || accountsFor(form.method, [account]).length > 0;
  const card = account?.kind === 'CARTAO_CREDITO' ? account : null;
  const suggestedDue = suggestFirstDueDate(isValidISODate(form.purchasedAt) ? form.purchasedAt : today(), card?.card_closing_day ?? null, card?.card_due_day ?? null);
  const firstDue = form.firstDue && isValidISODate(form.firstDue) ? form.firstDue : suggestedDue;
  const dates = scheduleDates(form.method, isValidISODate(form.purchasedAt) ? form.purchasedAt : today(), firstDue, countValid ? count : 1);
  const installments = buildInstallments(dates, toNumber(installmentsTotal) >= 0 ? installmentsTotal : '0', multi ? form.edited : {});
  const payer: Payer = account ? account.owner : form.payer;
  const goLive = settings.go_live_date;
  const suggestedPaid = installments.rows.filter((r) => r.due_date < today()).length;
  const paidCount = form.paidCount === null ? suggestedPaid : Math.trunc(toNumber(form.paidCount));
  const receivable = form.lines.some((l) => l.kind === 'EQUIPMENT' || (l.kind === 'ITEM' && (itemsById.get(l.itemId ?? -1)?.is_stock_tracked ?? true)));

  // ---- Validação: o que impede salvar o rascunho e o que impede confirmar. ----
  const saveErrors: string[] = [];
  if (!isValidISODate(form.purchasedAt)) saveErrors.push('Informe a data da compra.');
  form.lines.forEach((l, i) => {
    const n = `Linha ${i + 1}`;
    if (l.kind === 'ITEM' && !l.itemId) saveErrors.push(`${n}: escolha o item.`);
    if (l.kind === 'EXPENSE' && !l.categoryId) saveErrors.push(`${n}: escolha a categoria da despesa.`);
    if (l.kind === 'EXPENSE' && !l.description.trim()) saveErrors.push(`${n}: descreva a despesa.`);
    if (l.kind === 'EQUIPMENT' && !l.description.trim()) saveErrors.push(`${n}: descreva o equipamento.`);
    if (toNumber(lineQty(l, isFilament(l))) <= 0) saveErrors.push(`${n}: informe a quantidade.`);
    if (l.price === null) saveErrors.push(`${n}: informe o preço.`);
  });
  if (new Big(form.discount ?? 0).gt(new Big(goods).plus(form.freight ?? 0))) saveErrors.push('O desconto é maior que o valor da compra.');
  if (!countValid) saveErrors.push('O número de parcelas vai de 1 a 48.');
  if (form.lines.length > 0 && installments.error) saveErrors.push(installments.error);

  const confirmIssues: string[] = [];
  if (form.lines.length === 0) confirmIssues.push('Adicione ao menos uma linha.');
  if (multi && toNumber(interest) < 0) confirmIssues.push('O total parcelado é menor que o valor à vista.');
  if (multi && form.interestUnknown && toNumber(interest) !== 0) confirmIssues.push('Sem o valor à vista, a soma das linhas precisa igualar o total parcelado.');
  if (form.isOpening && goLive && form.purchasedAt >= goLive) confirmIssues.push(`Compra anterior ao sistema precisa ter data antes de ${formatDateBR(goLive)}.`);
  if (isCashMethod(form.method) && payer === 'EMPRESA' && !account) confirmIssues.push('Escolha de qual conta da empresa saiu o pagamento.');
  if (isCardMethod(form.method) && payer === 'EMPRESA' && !account) confirmIssues.push('Escolha o cartão usado na compra.');
  if (!accountFits) confirmIssues.push(`A conta escolhida não serve para ${METHOD_LABELS[form.method].toLowerCase()}.`);
  if (form.isOpening && (paidCount < 0 || paidCount > installments.rows.length)) confirmIssues.push('O número de parcelas já pagas passa do total de parcelas.');
  const blockers = [...saveErrors, ...confirmIssues];

  const fitLines = () => {
    const diff = new Big(installmentsTotal).minus(cashTotal);
    setForm((f) => ({ ...f, lines: fitLinesToTotal(f.lines, previews.map((p) => p.lineTotal), diff.toFixed(2)), manuallyAllocated: true }));
  };

  const payload = (): PurchaseDraftInput => ({
    id: purchaseId,
    supplier_id: form.supplierId,
    new_supplier_name: form.supplierId ? null : form.newSupplierName.trim() || null,
    purchased_at: form.purchasedAt,
    invoice_ref: form.invoiceRef.trim() || null,
    freight_total: form.freight ?? '0',
    discount_total: form.discount ?? '0',
    payment_method: form.method,
    payment_account_id: accountFits ? (account?.id ?? null) : null,
    payer,
    owner_funding_type: payer === 'DONO' ? form.funding : null,
    installments_count: multi ? count : 1,
    first_due_date: isCashMethod(form.method) ? null : form.firstDue,
    installments_total: multi ? form.installmentsTotal : null,
    interest_unknown: multi && form.interestUnknown,
    custom_installments: multi && installments.custom ? installments.rows.map((r) => ({ due_date: r.due_date, amount: r.amount })) : null,
    is_opening: form.isOpening,
    manually_allocated: form.isOpening && form.manuallyAllocated,
    notes: form.notes.trim() || null,
    lines: form.lines.map((l) => ({
      line_kind: l.kind,
      item_id: l.kind === 'ITEM' ? l.itemId : null,
      expense_category_id: l.kind === 'EXPENSE' ? l.categoryId : null,
      description: l.kind === 'ITEM' ? null : l.description.trim(),
      qty: lineQty(l, isFilament(l)) ?? '0',
      unit_price: lineUnitPrice(l, isFilament(l)) ?? '0',
    })),
  });

  const submit = (next: 'detail' | 'confirm' | 'receive') => {
    setAttempted(true);
    setAction(next);
    setSaveError(null);
    if (saveErrors.length > 0 || (next !== 'detail' && confirmIssues.length > 0)) return;
    save.mutate(payload(), {
      onSuccess: (result) => {
        const query = next === 'confirm' ? '?acao=confirmar' : next === 'receive' ? '?acao=receber' : '';
        const paid = form.isOpening && next !== 'detail' ? `${query ? '&' : '?'}pagas=${paidCount}` : '';
        navigate(`/compras/${result.purchase_id}${query}${paid}`, { replace: true });
      },
      onError: (e) => setSaveError(describeError(e)),
    });
  };

  const itemOptions: PickerOption[] = useMemo(
    () =>
      (items.data ?? [])
        .filter((i: ItemRow) => i.kind !== 'FINISHED_GOOD' && i.active)
        .map((i) => ({
          id: String(i.id),
          label: i.name,
          searchText: `${i.sku} ${i.color_name ?? ''} ${i.brand ?? ''} ${KIND_LABELS[i.kind]}`,
          description: (
            <span className="inline-flex items-center gap-1.5">
              {i.kind === 'FILAMENT' ? <ColorDot hex={i.color_hex} /> : null}
              {KIND_LABELS[i.kind]} · {i.sku}
            </span>
          ),
        })),
    [items.data],
  );
  const supplierOptions: PickerOption[] = useMemo(
    () => (suppliers.data ?? []).filter((s) => s.active).map((s) => ({ id: String(s.id), label: s.name, searchText: `${s.contact ?? ''} ${s.url ?? ''}` })),
    [suppliers.data],
  );

  /** Escolhe o item da linha; filamento passa a ser informado em carretéis do tamanho nominal. */
  const pickItem = (lineKey: string, itemId: number, info?: { kind: ItemKind; nominal: number | null }) => {
    const item = itemsById.get(itemId);
    const kind = item?.kind ?? info?.kind;
    const nominal = item?.nominal_spool_g ?? info?.nominal ?? 1000;
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => {
        if (l.key !== lineKey) return l;
        if (kind !== 'FILAMENT') return { ...l, itemId, qtyMode: 'units' };
        const wasFilament = l.itemId !== null && itemsById.get(l.itemId)?.kind === 'FILAMENT';
        return wasFilament ? { ...l, itemId } : { ...l, itemId, qtyMode: 'spools', spoolCount: l.spoolCount ?? '1', spoolSize: String(nominal) };
      }),
    }));
  };

  const title = purchaseId ? `Editar rascunho ${number ?? ''}` : 'Nova compra';
  const pickingLine = picking && picking !== 'supplier' ? form.lines.find((l) => l.key === picking.lineKey) : undefined;

  return (
    <Page>
      <PageHeader
        back={
          <Link to={purchaseId ? `/compras/${purchaseId}` : '/compras'} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {purchaseId ? 'Voltar à compra' : 'Compras'}
          </Link>
        }
        title={title}
        description="O rascunho não mexe no estoque nem no financeiro: isso acontece ao confirmar (contas a pagar) e ao receber (estoque)."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          <Section title="Compra">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-ink-soft" id="supplier-label">
                  Fornecedor
                </span>
                <button
                  type="button"
                  onClick={() => setPicking('supplier')}
                  aria-labelledby="supplier-label"
                  className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-panel px-3 text-left text-sm hover:bg-subtle focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
                >
                  <Store className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className={`min-w-0 flex-1 truncate ${supplier || form.newSupplierName ? 'text-ink' : 'text-muted'}`}>
                    {supplier ? supplier.name : form.newSupplierName ? `${form.newSupplierName} (novo)` : 'Escolher ou digitar um novo…'}
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
                </button>
                {form.newSupplierName && !form.supplierId ? <p className="text-xs text-muted">Será cadastrado ao salvar a compra.</p> : null}
              </div>
              <Field label="Data da compra" required>
                <Input type="date" value={form.purchasedAt} max={form.isOpening && goLive ? addDays(goLive, -1) : undefined} onChange={(e) => set({ purchasedAt: e.target.value, edited: {} })} />
              </Field>
              <Field label="Nota fiscal ou nº do pedido">
                <Input value={form.invoiceRef} onChange={(e) => set({ invoiceRef: e.target.value })} maxLength={60} />
              </Field>
              <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-3 sm:col-span-2">
                <label className="inline-flex min-h-10 items-start gap-2 text-sm font-medium text-ink">
                  <Checkbox className="mt-0.5" checked={form.isOpening} onChange={(e) => set({ isOpening: e.target.checked })} />
                  <span>
                    Compra anterior ao sistema
                    <span className="block text-xs font-normal text-muted">
                      Feita antes de {goLive ? formatDateBR(goLive) : 'começar a usar o Wabee'} e ainda sendo paga (ex.: impressora no cartão em 18x).
                    </span>
                  </span>
                </label>
                {form.isOpening ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Quantas parcelas já paguei" hint={`Baixadas na data de cada vencimento. Sugestão: ${suggestedPaid} (vencidas até hoje).`}>
                      <DecimalInput decimals={0} value={form.paidCount ?? String(suggestedPaid)} onValueChange={(v) => set({ paidCount: v })} />
                    </Field>
                    <label className="inline-flex min-h-10 items-center gap-2 self-center text-sm text-ink-soft">
                      <Checkbox checked={form.manuallyAllocated} onChange={(e) => set({ manuallyAllocated: e.target.checked })} /> Valores rateados manualmente entre os itens
                    </label>
                    <p className="text-xs text-muted sm:col-span-2">
                      No recebimento, informe o que <strong>resta hoje</strong> de cada item (ex.: gramas que sobram em cada carretel), não o que foi comprado. O que já foi usado antes do
                      sistema não entra no estoque.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </Section>

          <Section
            title="Itens"
            description="Frete e desconto são rateados pelo valor de cada linha e entram no custo de aquisição (RN-02)."
          >
            <ol className="space-y-3">
              {form.lines.map((line, index) => (
                <PurchaseLineEditor
                  key={line.key}
                  line={line}
                  index={index}
                  item={line.itemId ? itemsById.get(line.itemId) : undefined}
                  preview={previews[index]}
                  categoryGroups={categoryGroups}
                  showCosts={showCosts}
                  canRemove={form.lines.length > 1}
                  onChange={(patch) => setLine(line.key, patch)}
                  onRemove={() => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.key !== line.key) }))}
                  onPickItem={() => setPicking({ lineKey: line.key })}
                  onNewItem={() => setCreatingItem({ lineKey: line.key, name: '' })}
                />
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => addLine('ITEM')}>
                <Plus /> Item
              </Button>
              <Button type="button" variant="outline" onClick={() => addLine('EQUIPMENT')}>
                <Plus /> Equipamento
              </Button>
              <Button type="button" variant="outline" onClick={() => addLine('EXPENSE')}>
                <Plus /> Despesa
              </Button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:max-w-md">
              <Field label="Frete">
                <MoneyInput value={form.freight} onValueChange={(v) => set({ freight: v })} />
              </Field>
              <Field label="Desconto">
                <MoneyInput value={form.discount} onValueChange={(v) => set({ discount: v })} />
              </Field>
            </div>
          </Section>

          <Section title="Pagamento" description="Conta ou cartão do dono deixa o pagador como dono: vira aporte, empréstimo ou reembolso (US-3.4).">
            <PurchasePayment
              state={form}
              onChange={(patch) => set(patch)}
              accounts={accountList}
              purchasedAt={form.purchasedAt}
              cashTotal={cashTotal}
              installmentsTotal={installmentsTotal}
              interest={interest}
              suggestedDue={suggestedDue}
              installments={installments}
              unknownDiff={interest}
              onFitLines={fitLines}
            />
          </Section>

          <Section title="Observações">
            <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} className="min-h-16" aria-label="Observações" />
          </Section>
        </div>

        <aside className="lg:sticky lg:top-4">
          <Card>
            <CardHeader title="Resumo" />
            <div className="space-y-3 p-4">
              <dl>
                <SummaryRow label="Itens" value={<Money value={goods} />} />
                {toNumber(form.freight) > 0 ? <SummaryRow label="Frete" value={<>+ <Money value={form.freight} /></>} /> : null}
                {toNumber(form.discount) > 0 ? <SummaryRow label="Desconto" value={<>− <Money value={form.discount} /></>} /> : null}
                <SummaryRow label="Valor à vista" value={<Money value={cashTotal} />} strong />
                {multi && toNumber(interest) !== 0 && !form.interestUnknown ? <SummaryRow label="Juros" value={<Money value={interest} />} /> : null}
                {multi ? <SummaryRow label="Total parcelado" value={<Money value={installmentsTotal} />} strong /> : null}
                <SummaryRow
                  label={METHOD_LABELS[form.method]}
                  value={
                    isCashMethod(form.method)
                      ? 'paga na compra'
                      : installments.rows.length > 1
                        ? `${installments.rows.length}× de ${formatBRL(installments.rows[0]?.amount)}`
                        : `vence ${formatDateBR(installments.rows[0]?.due_date)}`
                  }
                  muted
                />
              </dl>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                Pagador <PayerBadge payer={payer} funding={payer === 'DONO' ? form.funding : null} />
              </div>
              {payer === 'DONO' ? <p className="text-xs text-muted">Pago pelo dono vira {FUNDING_LABELS[form.funding].toLowerCase()} a cada parcela paga; não sai do caixa da empresa.</p> : null}
              {attempted && blockers.length > 0 ? (
                <Callout tone="danger" title="Falta resolver">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </Callout>
              ) : !attempted && confirmIssues.length > 0 && form.lines.some((l) => l.price !== null) ? (
                <Callout tone="warning" title="Para confirmar">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {confirmIssues.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
              {saveError ? <Callout tone="danger">{saveError}</Callout> : null}
              <div className="flex flex-col gap-2">
                <Button type="button" onClick={() => submit('confirm')} loading={save.isPending && action === 'confirm'} disabled={save.isPending}>
                  Salvar e confirmar…
                </Button>
                {receivable ? (
                  <Button type="button" variant="accent" onClick={() => submit('receive')} loading={save.isPending && action === 'receive'} disabled={save.isPending}>
                    <PackageCheck /> Salvar, confirmar e receber…
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => submit('detail')} loading={save.isPending && action === 'detail'} disabled={save.isPending}>
                  <Save /> Salvar rascunho
                </Button>
              </div>
              <p className="text-xs text-muted">Confirmar cria a conta a pagar e as parcelas; receber dá entrada no estoque. Você revisa antes de cada passo.</p>
            </div>
          </Card>
        </aside>
      </div>

      <EntityPicker
        open={picking === 'supplier'}
        onOpenChange={(open) => !open && setPicking(null)}
        title="Fornecedor"
        options={supplierOptions}
        selectedId={form.supplierId ? String(form.supplierId) : null}
        onSelect={(o) => set({ supplierId: Number(o.id), newSupplierName: '' })}
        onCreate={(text) => set({ supplierId: null, newSupplierName: text })}
        createLabel={(text) => `Usar novo fornecedor “${text}”`}
        loading={!suppliers.data}
        emptyText="Nenhum fornecedor. Digite o nome para cadastrar."
      />
      <EntityPicker
        open={pickingLine !== undefined}
        onOpenChange={(open) => !open && setPicking(null)}
        title="Item da compra"
        options={itemOptions}
        selectedId={pickingLine?.itemId ? String(pickingLine.itemId) : null}
        onSelect={(o) => pickingLine && pickItem(pickingLine.key, Number(o.id))}
        onCreate={(text) => pickingLine && setCreatingItem({ lineKey: pickingLine.key, name: text })}
        createLabel={(text) => `Cadastrar item “${text}”`}
        loading={!items.data}
        emptyText="Nenhum item encontrado. Digite o nome para cadastrar."
      />
      {creatingItem ? (
        <QuickItemDialog
          open
          onOpenChange={(open) => !open && setCreatingItem(null)}
          initialName={creatingItem.name}
          initialKind={creatingItem.kind}
          onSaved={(itemId, info) => pickItem(creatingItem.lineKey, itemId, info)}
        />
      ) : null}
    </Page>
  );
}
