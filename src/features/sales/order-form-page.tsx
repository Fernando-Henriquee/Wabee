import { CalendarClock, Gift, Info as InfoIcon, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { EntityPicker, type PickerOption } from '@/components/shared/entity-picker';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput, MoneyInput, PercentInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  type OrderInput,
  type OrderKind,
  type PaymentTermInput,
  type SalesOrderLineRow,
  type SalesOrderRow,
  useBomDeliveryLines,
  useConfirmOrder,
  useCreateOrder,
  useOrderLines,
  useOrderPaymentTerms,
  useSalesChannels,
  useSalesOrder,
  useUpdateOrderDraft,
} from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addDays, formatDateBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, formatNumber, formatPercent, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { channelFeeAmount, defaultPackaging, estimateMargin, lineTotal, previewInstallments } from './cart';
import { BackLink, CustomerField, ProductThumb, Segmented, ValueRow } from './sales-bits';
import { type CustomerChoice, customerRef, dateToTimestamp, localDate, NO_CUSTOMER, type OrderPrefill } from './sales-utils';
import { productKey, useCatalog, useChannelPricing, usePackagingItems } from './use-catalog';

interface FormLine {
  uid: string;
  variantId: number | null;
  itemId: number | null;
  customDescription: string | null;
  qty: string | null;
  /** null = preço do canal (acompanha a troca de canal). */
  price: string | null;
  discount: string | null;
  isGift: boolean;
}

interface TermRow {
  uid: string;
  label: string;
  mode: 'pct' | 'amount';
  pct: string | null;
  amount: string | null;
  dueDate: string;
}

interface FormState {
  kind: OrderKind;
  channelId: number | null;
  customer: CustomerChoice;
  orderedAt: string;
  dueDate: string;
  lines: FormLine[];
  orderDiscount: string | null;
  shipping: string | null;
  terms: TermRow[];
  notes: string;
}

const uid = () => crypto.randomUUID();

function termsFrom(list: PaymentTermInput[] | null | undefined): TermRow[] {
  return (list ?? []).map((t) => ({
    uid: uid(),
    label: t.label ?? '',
    mode: t.amount !== null && t.amount !== undefined && t.amount !== '' ? 'amount' : 'pct',
    pct: t.pct === null || t.pct === undefined ? null : String(t.pct),
    amount: t.amount === null || t.amount === undefined ? null : String(t.amount),
    dueDate: t.due_date ?? '',
  }));
}

function stateFromOrder(order: SalesOrderRow, lines: SalesOrderLineRow[], terms: PaymentTermInput[] | null, timeZone: string): FormState {
  return {
    kind: order.kind,
    channelId: order.channel_id,
    customer: order.customer_id ? { kind: 'existing', id: order.customer_id, name: order.customer_name ?? 'Cliente' } : NO_CUSTOMER,
    orderedAt: localDate(order.ordered_at, timeZone) ?? '',
    dueDate: order.due_date ?? '',
    lines: lines.map((l) => ({
      uid: uid(),
      variantId: l.variant_id,
      itemId: l.item_id,
      customDescription: l.item_id ? null : l.custom_description,
      qty: String(l.qty),
      price: l.is_gift ? null : String(l.unit_price),
      discount: toNumber(l.discount) > 0 ? String(l.discount) : null,
      isGift: l.is_gift,
    })),
    orderDiscount: toNumber(order.order_discount) > 0 ? String(order.order_discount) : null,
    shipping: toNumber(order.shipping_charged) > 0 ? String(order.shipping_charged) : null,
    terms: termsFrom(terms),
    notes: order.notes ?? '',
  };
}

function stateFromPrefill(prefill: OrderPrefill | undefined, defaultChannelId: number | null, today: string): FormState {
  return {
    kind: prefill?.kind ?? 'ENCOMENDA',
    channelId: prefill?.channelId ?? defaultChannelId,
    customer: prefill?.customer ?? NO_CUSTOMER,
    orderedAt: today,
    dueDate: '',
    lines: (prefill?.lines ?? []).map((l) => ({
      uid: uid(),
      variantId: l.variantId ?? null,
      itemId: l.itemId ?? null,
      customDescription: null,
      qty: l.qty,
      price: l.unitPrice,
      discount: null,
      isGift: l.isGift,
    })),
    orderDiscount: prefill?.orderDiscount ?? null,
    shipping: prefill?.shippingCharged ?? null,
    terms: [],
    notes: '',
  };
}

/** Pedido e encomenda (US-6.4): rascunho editável ou confirmado, com prévia de custo e margem. */
export function OrderFormPage() {
  const { id } = useParams();
  const orderId = id ? Number(id) : undefined;
  const { can, settings, today } = useMember();
  const location = useLocation();
  const order = useSalesOrder(orderId);
  const lines = useOrderLines(orderId ? [orderId] : [], Boolean(orderId));
  const terms = useOrderPaymentTerms(orderId);
  const prefill = (location.state as { prefill?: OrderPrefill } | null)?.prefill;

  if (!can('write')) {
    return (
      <Page>
        <PageHeader title="Novo pedido" />
        <EmptyState title="Sem permissão" description="Só o perfil Dono registra pedidos." />
      </Page>
    );
  }
  if (orderId) {
    const error = order.error ?? lines.error ?? terms.error;
    if (error) return <Page><ErrorState error={error} /></Page>;
    if (order.data === undefined || !lines.data || terms.data === undefined) return <Page><LoadingBlock /></Page>;
    if (!order.data) return <Page><EmptyState title="Pedido não encontrado" action={<Button asChild><Link to="/vendas">Voltar para vendas</Link></Button>} /></Page>;
    if (order.data.status !== 'RASCUNHO') {
      return (
        <Page>
          <EmptyState
            title="Só rascunhos podem ser alterados"
            description={`O pedido ${order.data.number} já foi confirmado. Para mudar itens ou valores, cancele e lance de novo.`}
            action={
              <Button asChild>
                <Link to={`/vendas/${orderId}`}>Abrir o pedido</Link>
              </Button>
            }
          />
        </Page>
      );
    }
    return <OrderForm key={orderId} orderId={orderId} number={order.data.number} initial={stateFromOrder(order.data, lines.data, terms.data, settings.timezone)} />;
  }
  return <OrderForm key="new" initial={stateFromPrefill(prefill, settings.default_channel_id, today())} reason={prefill?.reason} />;
}

function Section({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={actions} />
      <div className="p-4">{children}</div>
    </Card>
  );
}

const PRESETS: Array<{ key: string; label: string; terms: (today: string) => Omit<TermRow, 'uid'>[] }> = [
  { key: 'avista', label: 'À vista', terms: () => [] },
  {
    key: 'sinal50',
    label: '50% sinal + 50% na entrega',
    terms: (today) => [
      { label: 'Sinal', mode: 'pct', pct: '0.5', amount: null, dueDate: today },
      { label: 'Na entrega', mode: 'pct', pct: null, amount: null, dueDate: '' },
    ],
  },
  {
    key: 'sinalfixo',
    label: 'Sinal em R$ + restante',
    terms: (today) => [
      { label: 'Sinal', mode: 'amount', pct: null, amount: null, dueDate: today },
      { label: 'Restante na entrega', mode: 'pct', pct: null, amount: null, dueDate: '' },
    ],
  },
  {
    key: '2x',
    label: '2× (hoje e 30 dias)',
    terms: (today) => [
      { label: '1ª parcela', mode: 'pct', pct: '0.5', amount: null, dueDate: today },
      { label: '2ª parcela', mode: 'pct', pct: null, amount: null, dueDate: addDays(today, 30) },
    ],
  },
];

function OrderForm({ orderId, number, initial, reason }: { orderId?: number; number?: string; initial: FormState; reason?: string }) {
  const { settings, today, can } = useMember();
  const showCosts = can('costs');
  const navigate = useNavigate();
  const editing = Boolean(orderId);
  const catalog = useCatalog();
  const channels = useSalesChannels();
  const packagingItems = usePackagingItems();
  const [form, setForm] = useState<FormState>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, renew] = useRequestId();
  const [confirmRequestId, renewConfirm] = useRequestId();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const channel = channels.data?.find((c) => c.id === form.channelId);
  const pricing = useChannelPricing(form.channelId, form.orderedAt || today());
  const taxPct = settings.tax_regime === 'SIMPLES' ? settings.sales_tax_pct : 0;

  const lines = form.lines.map((line) => {
    const product = line.variantId || line.itemId ? catalog.byKey.get(productKey(line)) : undefined;
    const basePrice = pricing.price(product);
    const price = line.isGift ? 0 : line.price !== null ? toNumber(line.price) : basePrice;
    return { line, product, basePrice, price, name: product?.fullName ?? line.customDescription ?? 'Produto' };
  });

  const bomLines = useBomDeliveryLines(lines.map((l) => l.product?.bomId).filter((v): v is number => Boolean(v)));
  const packDefaults = defaultPackaging(
    lines.map((l) => ({ bomId: l.product?.bomId, qty: l.line.qty })),
    bomLines.data,
    settings.default_order_packaging_item_id,
    true,
  );
  const packCost = [...packDefaults].reduce((sum, [itemId, qty]) => sum + toNumber(qty) * toNumber(packagingItems.items.get(itemId)?.avgCost), 0);

  const preview = estimateMargin({
    lines: lines.map((l) => ({ qty: l.line.qty, unitPrice: l.price ?? 0, discount: l.line.isGift ? 0 : l.line.discount, isGift: l.line.isGift, unitCost: l.product?.unitCost ?? null })),
    orderDiscount: form.orderDiscount,
    shippingCharged: form.shipping,
    fee: pricing.fee,
    paymentFee: null,
    packagingCost: packCost,
    taxPct,
  });
  const marketplace = channel?.kind === 'MARKETPLACE';
  const expected = marketplace ? toNumber(preview.total) - toNumber(channelFeeAmount(pricing.fee, preview.net, preview.units)) : toNumber(preview.total);
  const baseDue = form.dueDate || form.orderedAt || today();
  const defaultDue = marketplace && channel ? addDays(baseDue, channel.payout_days) : baseDue;
  const termInputs: PaymentTermInput[] = form.terms.map((t, i) => ({
    label: t.label.trim() || `Parcela ${i + 1}`,
    pct: t.mode === 'pct' && i < form.terms.length - 1 ? t.pct : null,
    amount: t.mode === 'amount' && i < form.terms.length - 1 ? t.amount : null,
    due_date: t.dueDate || null,
  }));
  const installments = previewInstallments(expected, termInputs, defaultDue);

  const options = useMemo<PickerOption[]>(
    () =>
      catalog.products.map((p) => {
        const price = pricing.price(p);
        return {
          id: p.key,
          label: p.fullName,
          description: `${p.sku} · ${formatNumber(p.free)} livre(s)${price !== null ? ` · ${formatBRL(price)}` : ' · sem preço'}`,
          searchText: p.sku,
        };
      }),
    [catalog.products, pricing],
  );

  const addProduct = (key: string) => {
    const product = catalog.byKey.get(key);
    if (!product) return;
    setForm((f) => {
      const existing = f.lines.find((l) => !l.isGift && productKey(l) === key && (l.variantId || l.itemId));
      if (existing) return { ...f, lines: f.lines.map((l) => (l.uid === existing.uid ? { ...l, qty: String(toNumber(l.qty) + 1) } : l)) };
      return { ...f, lines: [...f.lines, { uid: uid(), variantId: product.variantId, itemId: product.variantId ? null : product.itemId, customDescription: null, qty: '1', price: null, discount: null, isGift: false }] };
    });
  };
  const updateLine = (lineUid: string, patch: Partial<FormLine>) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.uid === lineUid ? { ...l, ...patch } : l)) }));
  const updateTerm = (termUid: string, patch: Partial<TermRow>) => setForm((f) => ({ ...f, terms: f.terms.map((t) => (t.uid === termUid ? { ...t, ...patch } : t)) }));

  const create = useCreateOrder((r) => {
    renew();
    navigate(`/vendas/${r.order_id}`, { replace: true });
  });
  const update = useUpdateOrderDraft();
  const confirm = useConfirmOrder((r) => {
    renewConfirm();
    navigate(`/vendas/${r.order_id}`, { replace: true });
  });
  const busy = create.isPending || update.isPending || confirm.isPending;

  const validate = (): string | null => {
    if (!form.channelId) return 'Escolha o canal de venda.';
    if (form.lines.length === 0) return 'Adicione ao menos um produto.';
    for (const l of lines) {
      if (toNumber(l.line.qty) <= 0) return `Informe a quantidade de ${l.name}.`;
      if (!l.line.isGift && l.price === null) return `Informe o preço de ${l.name}.`;
      if (!l.line.isGift && toNumber(l.line.discount) > toNumber(l.line.qty) * toNumber(l.price)) return `O desconto de ${l.name} passa do valor da linha.`;
    }
    if (toNumber(preview.total) < 0) return 'Os descontos superam o valor do pedido.';
    if (installments.invalid) return 'A condição de pagamento passa do total do pedido.';
    if (form.terms.some((t, i) => i < form.terms.length - 1 && (t.mode === 'pct' ? t.pct === null : t.amount === null))) return 'Preencha o valor ou o percentual de cada parcela (a última recebe o restante).';
    return null;
  };

  const payload = (confirmNow: boolean): OrderInput => ({
    kind: form.kind,
    channel_id: form.channelId!,
    ...customerRef(form.customer),
    ordered_at: editing ? undefined : dateToTimestamp(form.orderedAt || today(), today()),
    due_date: form.dueDate || null,
    lines: lines.map((l) => ({
      variant_id: l.line.variantId,
      item_id: l.line.variantId ? null : l.line.itemId,
      custom_description: l.line.customDescription,
      qty: l.line.qty!,
      unit_price: l.line.isGift ? null : String(l.price),
      discount: l.line.isGift ? null : l.line.discount,
      is_gift: l.line.isGift,
    })),
    order_discount: form.orderDiscount,
    shipping_charged: form.shipping,
    payment_terms: termInputs.length > 0 ? termInputs : null,
    notes: form.notes.trim() || null,
    confirm: confirmNow,
  });

  const submit = (confirmNow: boolean) => {
    setError(null);
    const problem = validate();
    if (problem) return setError(problem);
    const order = payload(confirmNow);
    const onError = (e: Error) => setError(describeError(e));
    if (!editing) {
      create.mutate({ requestId, order }, { onError });
      return;
    }
    const { confirm: _confirm, ordered_at: _orderedAt, ...changes } = order;
    update.mutate(
      { orderId: orderId!, order: changes },
      {
        onError,
        onSuccess: () => {
          if (confirmNow) confirm.mutate({ requestId: confirmRequestId, orderId: orderId! }, { onError });
          else navigate(`/vendas/${orderId}`, { replace: true });
        },
      },
    );
  };

  const hasGift = form.lines.some((l) => l.isGift);

  return (
    <Page>
      <PageHeader
        back={<BackLink to={editing ? `/vendas/${orderId}` : '/vendas'}>{editing ? `Pedido ${number}` : 'Vendas'}</BackLink>}
        title={editing ? `Editar rascunho ${number}` : 'Novo pedido'}
        description="Encomenda ou pronta entrega com prazo. Confirmar reserva o saldo livre e cria a conta a receber; a receita só entra na entrega."
      />
      {reason ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <InfoIcon className="mt-0.5 size-4 shrink-0" /> Veio da venda rápida: {reason} Ajuste o prazo e a condição de pagamento e confirme a encomenda.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <Section title="Pedido">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Tipo" className="sm:col-span-2">
                <Segmented
                  label="Tipo do pedido"
                  value={form.kind}
                  onChange={(kind) => set('kind', kind)}
                  options={[
                    { value: 'ENCOMENDA', label: 'Encomenda' },
                    { value: 'PRONTA_ENTREGA', label: 'Pronta entrega' },
                  ]}
                  className="w-full sm:w-auto"
                />
              </Field>
              <Field label="Canal" required>
                <Select value={form.channelId ?? ''} onChange={(e) => set('channelId', Number(e.target.value))}>
                  <option value="">Escolha…</option>
                  {(channels.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-soft">Cliente</span>
                <CustomerField value={form.customer} onChange={(c) => set('customer', c)} />
              </div>
              <Field label="Data do pedido" hint={editing ? 'A data do rascunho não muda.' : undefined}>
                <Input type="date" value={form.orderedAt} max={today()} disabled={editing} onChange={(e) => set('orderedAt', e.target.value)} />
              </Field>
              <Field label="Prazo de entrega" hint="Data combinada com o cliente.">
                <Input type="date" value={form.dueDate} min={form.orderedAt} onChange={(e) => set('dueDate', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section
            title="Itens"
            description="Preço padrão: o do canal (ou o de referência). Brinde sai com preço zero."
            actions={
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                <Plus /> Produto
              </Button>
            }
          >
            {form.lines.length === 0 ? (
              <EmptyState title="Nenhum produto" description="Adicione os produtos do pedido." action={<Button onClick={() => setPickerOpen(true)}><Plus /> Adicionar produto</Button>} />
            ) : (
              <ul className="space-y-3">
                {lines.map(({ line, product, basePrice, price, name }) => {
                  const qty = toNumber(line.qty);
                  const free = product?.free ?? 0;
                  return (
                    <li key={line.uid} className="rounded-xl border border-line p-3">
                      <div className="flex items-start gap-3">
                        <ProductThumb name={product?.name ?? name} photoPath={product?.photoPath} className="size-11 shrink-0 text-sm" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium leading-tight">
                            {name} {line.isGift ? <Badge tone="accent" className="ml-1"><Gift className="size-3" /> brinde</Badge> : null}
                          </p>
                          {product ? (
                            <p className={cn('text-xs', qty > free ? 'text-warning' : 'text-muted')}>
                              {product.sku} · {formatNumber(Math.max(free, 0))} livre(s)
                              {qty > free ? ` · ao confirmar reserva ${formatNumber(Math.max(free, 0))}, faltam ${formatNumber(qty - Math.max(free, 0))} (produzir)` : ' · reserva tudo ao confirmar'}
                            </p>
                          ) : null}
                        </div>
                        <Button variant="ghost" size="icon-sm" aria-label={`Remover ${name}`} onClick={() => set('lines', form.lines.filter((l) => l.uid !== line.uid))}>
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 items-end gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <Field label="Qtd.">
                          <DecimalInput decimals={3} value={line.qty} onValueChange={(v) => updateLine(line.uid, { qty: v })} />
                        </Field>
                        <Field label="Preço unit.">
                          {line.isGift ? (
                            <Input value="Brinde (R$ 0,00)" disabled />
                          ) : (
                            <MoneyInput value={line.price ?? (basePrice === null ? null : String(basePrice))} onValueChange={(v) => updateLine(line.uid, { price: v })} placeholder="Preço" />
                          )}
                        </Field>
                        <Field label="Desconto">
                          <MoneyInput value={line.isGift ? null : line.discount} disabled={line.isGift} onValueChange={(v) => updateLine(line.uid, { discount: v })} />
                        </Field>
                        <div className="flex h-10 items-center justify-between gap-3 sm:justify-end">
                          <label className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
                            <Checkbox checked={line.isGift} onChange={(e) => updateLine(line.uid, { isGift: e.target.checked })} /> Brinde
                          </label>
                          <Money value={lineTotal({ qty: line.qty, unitPrice: price ?? 0, discount: line.discount, isGift: line.isGift })} className="font-semibold" />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {hasGift ? (
              <p className="mt-3 flex items-start gap-2 text-xs text-muted">
                <Gift className="mt-0.5 size-3.5 shrink-0" /> Brinde no pedido (US-6.10): sai do estoque na entrega com preço zero e o custo vai para Marketing — não entra no CMV nem na taxa do canal.
              </p>
            ) : null}
          </Section>

          <Section title="Valores">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Desconto no pedido">
                <MoneyInput value={form.orderDiscount} onValueChange={(v) => set('orderDiscount', v)} />
              </Field>
              <Field label="Frete cobrado do cliente">
                <MoneyInput value={form.shipping} onValueChange={(v) => set('shipping', v)} />
              </Field>
              <Field label="Observações" className="col-span-2">
                <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} className="min-h-16" placeholder="Cores, personalização, endereço de entrega…" />
              </Field>
            </div>
          </Section>

          <Section
            title="Condição de pagamento"
            description={
              marketplace
                ? `Marketplace: uma parcela no repasse (${channel?.payout_days ?? 0} dias), já sem a taxa do canal.`
                : 'Parcelas a receber criadas ao confirmar. A última recebe o restante.'
            }
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button key={p.key} variant="outline" size="sm" onClick={() => set('terms', p.terms(today()).map((t) => ({ ...t, uid: uid() })))}>
                  {p.label}
                </Button>
              ))}
            </div>
            {form.terms.length === 0 ? (
              <p className="text-sm text-muted">
                Parcela única de <Money value={expected} /> com vencimento em {formatDateBR(defaultDue)} {form.dueDate ? '(prazo de entrega)' : '(data do pedido; informe o prazo para vencer na entrega)'}.
              </p>
            ) : (
              <ul className="space-y-2">
                {form.terms.map((t, i) => {
                  const last = i === form.terms.length - 1;
                  const row = installments.rows[i];
                  return (
                    <li key={t.uid} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-line p-2.5 sm:grid-cols-[minmax(0,1fr)_auto_8rem_9.5rem_auto]">
                      <Field label="Parcela" className="col-span-2 sm:col-span-1">
                        <Input value={t.label} onChange={(e) => updateTerm(t.uid, { label: e.target.value })} maxLength={40} />
                      </Field>
                      {last ? (
                        <div className="col-span-2 flex h-10 items-center text-sm text-muted sm:col-span-2">Restante</div>
                      ) : (
                        <>
                          <Segmented
                            label="Tipo do valor"
                            value={t.mode}
                            onChange={(mode) => updateTerm(t.uid, { mode })}
                            options={[
                              { value: 'pct', label: '%' },
                              { value: 'amount', label: 'R$' },
                            ]}
                          />
                          {t.mode === 'pct' ? (
                            <PercentInput aria-label="Percentual" value={t.pct} onValueChange={(v) => updateTerm(t.uid, { pct: v })} />
                          ) : (
                            <MoneyInput aria-label="Valor" value={t.amount} onValueChange={(v) => updateTerm(t.uid, { amount: v })} />
                          )}
                        </>
                      )}
                      <Field label="Vencimento" hint={t.dueDate ? undefined : 'Na entrega'}>
                        <Input type="date" value={t.dueDate} onChange={(e) => updateTerm(t.uid, { dueDate: e.target.value })} />
                      </Field>
                      <div className="flex h-10 items-center justify-end gap-1">
                        <Money value={row?.amount} className="font-semibold" />
                        <Button variant="ghost" size="icon-sm" aria-label="Remover parcela" onClick={() => set('terms', form.terms.filter((x) => x.uid !== t.uid))}>
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() =>
                set('terms', [
                  ...(form.terms.length === 0 ? [{ uid: uid(), label: 'Sinal', mode: 'pct' as const, pct: '0.5', amount: null, dueDate: today() }] : []),
                  { uid: uid(), label: form.terms.length === 0 ? 'Na entrega' : `Parcela ${form.terms.length + 1}`, mode: 'pct', pct: null, amount: null, dueDate: '' },
                ])
              }
            >
              <Plus /> Adicionar parcela
            </Button>
            {installments.invalid ? <p className="mt-2 text-sm font-medium text-danger">As parcelas passam do total do pedido.</p> : null}
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card className="p-4">
            <h2 className="mb-2 text-base">Resumo</h2>
            <ValueRow label="Produtos" value={formatBRL(preview.subtotal)} />
            {toNumber(preview.discountTotal) > 0 ? <ValueRow label="Descontos" value={`−${formatBRL(preview.discountTotal)}`} /> : null}
            {toNumber(form.shipping) > 0 ? <ValueRow label="Frete cobrado" value={formatBRL(form.shipping)} /> : null}
            <ValueRow label="Total do pedido" value={formatBRL(preview.total)} strong />
            {installments.rows.length > 0 && form.terms.length > 0 ? (
              <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs text-muted">
                {installments.rows.map((r, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="size-3" /> {r.label} · {formatDateBR(r.dueDate)}
                    </span>
                    <Money value={r.amount} />
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          {showCosts ? (
            <Card className="p-4">
              <h2 className="text-base">Prévia da margem</h2>
              <p className="mb-2 text-xs text-muted">Estimativa com o custo médio de hoje e as taxas do canal. O valor real é calculado na entrega.</p>
              <ValueRow label="Total do pedido" value={formatBRL(preview.total)} />
              <ValueRow label="CMV estimado" value={<Money value={-toNumber(preview.cogs)} estimated hint="Quantidade × custo médio do estoque" />} muted />
              {toNumber(preview.giftCost) > 0 ? <ValueRow label="Brindes (Marketing)" value={<Money value={-toNumber(preview.giftCost)} estimated />} muted /> : null}
              <ValueRow label="Taxa do canal" value={`−${formatBRL(preview.channelFee)}`} muted hint={pricing.fee && toNumber(pricing.fee.fee_pct) > 0 ? `${formatPercent(pricing.fee.fee_pct, 2)} + fixo` : undefined} />
              <ValueRow label="Taxa de pagamento" value={`−${formatBRL(preview.paymentFee)}`} muted hint={pricing.fee && toNumber(pricing.fee.payment_fee_pct) > 0 ? `${formatPercent(pricing.fee.payment_fee_pct, 2)} do canal` : undefined} />
              <ValueRow label="Embalagem" value={<Money value={-packCost} estimated hint="Embalagens das fichas + embalagem padrão por pedido" />} muted />
              {toNumber(preview.tax) > 0 ? <ValueRow label="Impostos" value={`−${formatBRL(preview.tax)}`} muted /> : null}
              <div className="mt-1 border-t border-line pt-1">
                <ValueRow
                  strong
                  label="Margem de contribuição"
                  value={
                    <span className={cn(toNumber(preview.margin) < 0 && 'text-danger')}>
                      <Money value={preview.margin} estimated hint="Estimativa (RN-13)" />
                      {preview.marginPct !== null ? <span className="ml-1 text-sm font-normal text-muted">({formatPercent(preview.marginPct)})</span> : null}
                    </span>
                  }
                />
              </div>
              {preview.missingCost && form.lines.length > 0 ? <p className="mt-1 text-xs text-warning">Algum produto ainda não tem custo médio (sem estoque produzido): o CMV está subestimado.</p> : null}
              <p className="mt-2 text-xs text-muted">Frete pago e taxa real do recebimento entram na entrega e na baixa.</p>
            </Card>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={() => submit(true)} loading={busy && (create.variables?.order.confirm || confirm.isPending)} disabled={busy}>
              {editing ? 'Salvar e confirmar' : 'Confirmar pedido'}
            </Button>
            <Button variant="outline" onClick={() => submit(false)} disabled={busy}>
              {editing ? 'Salvar rascunho' : 'Salvar como rascunho'}
            </Button>
            <p className="text-xs text-muted">Rascunho não reserva estoque nem cria conta a receber; dá para editar depois.</p>
          </div>
        </aside>
      </div>

      <EntityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Produto"
        loading={catalog.loading}
        options={options}
        onSelect={(option) => addProduct(option.id)}
        emptyText="Nenhum produto à venda encontrado."
      />
    </Page>
  );
}
