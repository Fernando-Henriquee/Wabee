import { AlertTriangle, Check, ChevronUp, ClipboardList, Gift, Lock, Search, ShoppingBag, Store, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useAccounts } from '@/data/finance';
import { type QuickSaleInput, useBomDeliveryLines, useQuickSale, useSalesChannels, useSalesOrders } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatBRL, formatNumber, formatPercent, toNumber } from '@/lib/money';
import { normalizeName } from '@/lib/text';
import { useRequestId } from '@/lib/use-request-id';
import { defaultPackaging, estimateMargin, lineTotal, orderTotals, suggestedPaymentFee } from './cart';
import { PackagingEditor } from './packaging-editor';
import { BackLink, CustomerField, ProductThumb, Stepper, ValueRow } from './sales-bits';
import { type CustomerChoice, customerRef, dayStart, type FeiraState, loadFeira, NO_CUSTOMER, type OrderPrefill, saveFeira, useIsDesktop } from './sales-utils';
import { type CatalogProduct, effectivePackaging, packagingCost, type PackagingRow, useCatalog, useChannelPricing, usePackagingItems } from './use-catalog';

interface CartEntry {
  key: string;
  qty: number;
  /** Preço digitado (null = preço do canal). */
  price: string | null;
  isGift: boolean;
}

type AccountChoice = number | 'RECEBER';

/** Venda rápida (US-6.3): pronta entrega confirmada, entregue e recebida numa transação. */
export function QuickSalePage() {
  const { can } = useMember();
  if (!can('write') || !can('costs')) {
    return (
      <Page>
        <PageHeader title="Venda rápida" />
        <EmptyState title="Sem permissão" description="Só o perfil Dono registra vendas." />
      </Page>
    );
  }
  return <QuickSale />;
}

function QuickSale() {
  const { settings, today } = useMember();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const catalog = useCatalog();
  const channels = useSalesChannels();
  const accounts = useAccounts();
  const packagingItems = usePackagingItems();
  const [requestId, renew] = useRequestId();

  const [feira, setFeira] = useState<FeiraState>(() => loadFeira() ?? { on: false, channelId: null, accountId: null });
  const [channelId, setChannelId] = useState<number | null>(() => (feira.on && feira.channelId) || settings.default_channel_id);
  const [account, setAccount] = useState<AccountChoice | null>(() => (feira.on && feira.accountId) || null);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [customer, setCustomer] = useState<CustomerChoice>(NO_CUSTOMER);
  const [orderDiscount, setOrderDiscount] = useState<string | null>(null);
  const [shipping, setShipping] = useState<string | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const [pack, setPack] = useState<PackagingRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [convertReason, setConvertReason] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<{ id: number; number: string; total: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingTotal = useRef('0');

  const on = today();
  const activeChannels = channels.data ?? [];
  const channel = activeChannels.find((c) => c.id === channelId) ?? activeChannels.find((c) => c.id === settings.default_channel_id) ?? activeChannels[0];
  const companyAccounts = (accounts.data ?? []).filter((a) => a.owner === 'EMPRESA' && a.kind !== 'CARTAO_CREDITO');
  const accountValue: AccountChoice =
    account === 'RECEBER' ? 'RECEBER' : (companyAccounts.find((a) => a.id === account)?.id ?? companyAccounts[0]?.id ?? 'RECEBER');
  const accountName = accountValue === 'RECEBER' ? 'Fica a receber' : companyAccounts.find((a) => a.id === accountValue)?.name;
  const pricing = useChannelPricing(channel?.id, on);
  const taxPct = settings.tax_regime === 'SIMPLES' ? settings.sales_tax_pct : 0;

  const todaySales = useSalesOrders({ orderedFrom: dayStart(on), channelId: channel?.id }, feira.on && Boolean(channel));
  const todayDone = (todaySales.data ?? []).filter((o) => o.status !== 'CANCELADO');
  const todayTotal = todayDone.reduce((sum, o) => sum + toNumber(o.total), 0);

  const lines = cart
    .map((entry) => {
      const product = catalog.byKey.get(entry.key);
      if (!product) return null;
      const basePrice = pricing.price(product);
      const unitPrice = entry.isGift ? 0 : entry.price !== null ? toNumber(entry.price) : basePrice;
      return { entry, product, basePrice, unitPrice, short: entry.qty > product.free };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const bomLines = useBomDeliveryLines(lines.map((l) => l.product.bomId).filter((id): id is number => Boolean(id)));
  const bomIds = lines.some((l) => l.product.bomId);
  const packagingReady = !bomIds || bomLines.data !== undefined;
  const packDefaults = defaultPackaging(
    lines.map((l) => ({ bomId: l.product.bomId, qty: l.entry.qty })),
    bomLines.data,
    settings.default_order_packaging_item_id,
    true,
  );
  const packRows = effectivePackaging(packDefaults, pack);
  const packCost = packagingCost(packRows, packagingItems.items);

  const cartLines = lines.map((l) => ({ qty: l.entry.qty, unitPrice: l.unitPrice ?? 0, isGift: l.entry.isGift, unitCost: l.product.unitCost }));
  const suggestedFee = suggestedPaymentFee(orderTotals(cartLines, orderDiscount, shipping).total, pricing.fee?.payment_fee_pct);
  const feeValue = accountValue === 'RECEBER' ? '0' : (fee ?? suggestedFee);
  const preview = estimateMargin({
    lines: cartLines,
    orderDiscount,
    shippingCharged: shipping,
    fee: pricing.fee,
    // A receber: a taxa de pagamento aparece só no recebimento; na prévia usamos a do canal.
    paymentFee: accountValue === 'RECEBER' ? null : feeValue,
    packagingCost: packCost,
    taxPct,
  });
  const units = lines.reduce((sum, l) => sum + l.entry.qty, 0);
  const shortLines = lines.filter((l) => l.short);

  const persistFeira = (next: Partial<FeiraState>) => {
    const merged = { ...feira, ...next };
    setFeira(merged);
    saveFeira(merged);
  };

  const chooseChannel = (id: number) => {
    setChannelId(id);
    setFee(null);
    if (feira.on) persistFeira({ channelId: id });
  };

  const chooseAccount = (value: AccountChoice) => {
    setAccount(value);
    setFee(null);
    if (feira.on) persistFeira({ accountId: value === 'RECEBER' ? null : value });
  };

  const toggleFeira = () => {
    const turningOn = !feira.on;
    let nextChannel = channel?.id ?? null;
    if (turningOn && channel?.kind !== 'FEIRA') {
      const fair = activeChannels.find((c) => c.kind === 'FEIRA');
      if (fair) {
        nextChannel = fair.id;
        setChannelId(fair.id);
      }
    }
    const next: FeiraState = { on: turningOn, channelId: nextChannel, accountId: typeof accountValue === 'number' ? accountValue : null };
    setFeira(next);
    saveFeira(next);
    toast.success(turningOn ? 'Modo feira ligado: canal e conta ficam fixos entre as vendas.' : 'Modo feira desligado.');
  };

  const setQty = (key: string, qty: number) => {
    setError(null);
    setCart((list) => {
      if (qty <= 0) return list.filter((e) => e.key !== key);
      if (list.some((e) => e.key === key)) return list.map((e) => (e.key === key ? { ...e, qty } : e));
      return [...list, { key, qty, price: null, isGift: false }];
    });
  };
  const qtyOf = (key: string) => cart.find((e) => e.key === key)?.qty ?? 0;
  const updateEntry = (key: string, patch: Partial<CartEntry>) => setCart((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const resetCart = () => {
    setCart([]);
    setCustomer(NO_CUSTOMER);
    setOrderDiscount(null);
    setShipping(null);
    setFee(null);
    setPack(null);
    setQuery('');
    setCartOpen(false);
    setError(null);
    if (!feira.on) setChannelId(settings.default_channel_id);
  };

  const save = useQuickSale((result) => {
    renew();
    setLastSale({ id: result.order_id, number: result.number, total: pendingTotal.current });
    toast.success(`Venda ${result.number} registrada: ${formatBRL(pendingTotal.current)}.`, {
      action: { label: 'Ver pedido', onClick: () => navigate(`/vendas/${result.order_id}`) },
    });
    resetCart();
  });

  const prefill = (reason?: string): OrderPrefill => ({
    kind: 'ENCOMENDA',
    channelId: channel?.id ?? null,
    customer,
    lines: lines.map((l) => ({
      variantId: l.product.variantId,
      itemId: l.product.variantId ? null : l.product.itemId,
      qty: String(l.entry.qty),
      unitPrice: l.entry.isGift || l.unitPrice === null ? null : String(l.unitPrice),
      isGift: l.entry.isGift,
    })),
    orderDiscount,
    shippingCharged: shipping,
    reason,
  });
  const toOrder = (reason?: string) => navigate('/vendas/nova', { state: { prefill: prefill(reason) } });

  const submit = () => {
    setError(null);
    if (lines.length === 0) return;
    if (!channel) return setError('Cadastre um canal de venda ativo em Configurações.');
    const noPrice = lines.find((l) => l.unitPrice === null);
    if (noPrice) {
      setError(`Informe o preço de ${noPrice.product.fullName}.`);
      if (!isDesktop) setCartOpen(true);
      return;
    }
    const sale: QuickSaleInput = {
      channel_id: channel.id,
      ...customerRef(customer),
      lines: lines.map((l) => ({
        variant_id: l.product.variantId,
        item_id: l.product.variantId ? null : l.product.itemId,
        qty: String(l.entry.qty),
        unit_price: l.entry.isGift ? null : String(l.unitPrice),
        is_gift: l.entry.isGift,
      })),
      order_discount: orderDiscount,
      shipping_charged: shipping,
      // Embalagens: a lista exibida (padrão das fichas + embalagem por pedido, ou a ajustada).
      packaging: packagingReady ? packRows.filter((r) => toNumber(r.qty) > 0).map((r) => ({ item_id: r.itemId, qty: r.qty! })) : undefined,
      payment: accountValue === 'RECEBER' ? null : { account_id: accountValue, fee: feeValue },
    };
    pendingTotal.current = preview.total;
    save.mutate(
      { requestId, sale },
      {
        onError: (e) => {
          const hint = (e as { hint?: string }).hint;
          if (hint === 'transformar_em_encomenda') {
            setCartOpen(false);
            setConvertReason(describeError(e));
          } else {
            setError(describeError(e));
            toast.error(describeError(e));
          }
        },
      },
    );
  };

  const products = useMemo(() => {
    const needle = normalizeName(query);
    const list = needle ? catalog.products.filter((p) => normalizeName(`${p.fullName} ${p.sku}`).includes(needle)) : catalog.products;
    return [...list].sort((a, b) => Number(b.free > 0) - Number(a.free > 0));
  }, [catalog.products, query]);

  const paymentChips = (
    <div role="radiogroup" aria-label="Pagamento" className="flex gap-1.5 overflow-x-auto">
      {companyAccounts.map((a) => (
        <button
          key={a.id}
          type="button"
          role="radio"
          aria-checked={accountValue === a.id}
          onClick={() => chooseAccount(a.id)}
          className={cn(
            'h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium',
            accountValue === a.id ? 'border-ink bg-ink text-brand-fg' : 'border-line-strong bg-panel text-ink-soft',
          )}
        >
          {a.name}
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={accountValue === 'RECEBER'}
        onClick={() => chooseAccount('RECEBER')}
        className={cn(
          'h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium',
          accountValue === 'RECEBER' ? 'border-ink bg-ink text-brand-fg' : 'border-dashed border-line-strong bg-panel text-ink-soft',
        )}
      >
        Fica a receber
      </button>
    </div>
  );

  const cartPanel = (
    <div className="space-y-5">
      <section aria-label="Itens da venda">
        {lines.length === 0 ? (
          <p className="rounded-lg bg-subtle px-3 py-4 text-center text-sm text-muted">Toque nos produtos para adicionar.</p>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li key={l.entry.key} className="py-2.5 first:pt-0">
                <div className="flex items-center gap-2.5">
                  <ProductThumb name={l.product.name} photoPath={l.product.photoPath} className="size-10 shrink-0 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.product.fullName}</p>
                    <p className={cn('text-xs', l.short ? 'font-medium text-danger' : 'text-muted')}>
                      {l.short ? `Só ${formatNumber(Math.max(l.product.free, 0))} livre(s)` : `${formatNumber(l.product.free)} livre(s)`}
                    </p>
                  </div>
                  <Stepper size="sm" value={l.entry.qty} onChange={(qty) => setQty(l.entry.key, qty)} label={l.product.fullName} />
                </div>
                <div className="mt-2 flex items-center gap-2 pl-12">
                  {l.entry.isGift ? (
                    <Badge tone="accent">
                      <Gift className="size-3" /> Brinde
                    </Badge>
                  ) : (
                    <MoneyInput
                      aria-label={`Preço de ${l.product.fullName}`}
                      className="h-9 w-28"
                      value={l.entry.price ?? (l.basePrice === null ? null : String(l.basePrice))}
                      onValueChange={(price) => updateEntry(l.entry.key, { price })}
                      placeholder="Preço"
                    />
                  )}
                  <Button
                    variant={l.entry.isGift ? 'outline' : 'ghost'}
                    size="sm"
                    aria-pressed={l.entry.isGift}
                    onClick={() => updateEntry(l.entry.key, { isGift: !l.entry.isGift })}
                    title="Brinde: sai do estoque com preço zero"
                  >
                    <Gift /> {l.entry.isGift ? 'Cobrar' : 'Brinde'}
                  </Button>
                  <Money value={lineTotal({ qty: l.entry.qty, unitPrice: l.unitPrice ?? 0, isGift: l.entry.isGift })} className="ml-auto text-sm font-semibold" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {lines.some((l) => l.entry.isGift) ? (
          <p className="mt-2 text-xs text-muted">Brinde sai do estoque com preço zero: o custo vai para Marketing, não para o CMV.</p>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-4">
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              Canal {feira.on ? <Lock className="size-3.5 text-muted" aria-label="fixo no modo feira" /> : null}
            </span>
          }
          hint={feira.on ? 'Fixo no modo feira.' : undefined}
        >
          <Select value={channel?.id ?? ''} onChange={(e) => chooseChannel(Number(e.target.value))}>
            {activeChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-soft">Cliente</span>
          <CustomerField value={customer} onChange={setCustomer} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-soft">Pagamento {feira.on ? <Lock className="inline size-3.5 text-muted" aria-label="fixo no modo feira" /> : null}</span>
          {paymentChips}
          {companyAccounts.length === 0 && accounts.data ? (
            <p className="text-xs text-muted">Sem conta da empresa cadastrada: a venda fica a receber. Cadastre em Financeiro → Contas.</p>
          ) : null}
        </div>
        {accountValue !== 'RECEBER' ? (
          <Field
            label="Taxa do pagamento (maquininha, Pix com tarifa)"
            hint={`Entra no caixa: ${formatBRL(toNumber(preview.total) - toNumber(feeValue))}${toNumber(pricing.fee?.payment_fee_pct) > 0 ? ` · sugestão ${formatPercent(pricing.fee?.payment_fee_pct, 2)} do canal` : ''}`}
          >
            <MoneyInput value={feeValue} onValueChange={setFee} />
          </Field>
        ) : (
          <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">A venda é entregue agora e o valor fica em contas a receber, para baixar quando o dinheiro entrar.</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desconto">
            <MoneyInput value={orderDiscount} onValueChange={setOrderDiscount} />
          </Field>
          <Field label="Frete cobrado">
            <MoneyInput value={shipping} onValueChange={setShipping} />
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-soft">Embalagem</span>
          <PackagingEditor defaults={packDefaults} value={pack} onChange={setPack} items={packagingItems.items} showCosts />
        </div>
      </div>

      <div className="rounded-lg bg-subtle px-3 py-2">
        <ValueRow label="Produtos" value={formatBRL(preview.subtotal)} />
        {toNumber(preview.discountTotal) > 0 ? <ValueRow label="Descontos" value={`−${formatBRL(preview.discountTotal)}`} /> : null}
        {toNumber(shipping) > 0 ? <ValueRow label="Frete cobrado" value={formatBRL(shipping)} /> : null}
        <ValueRow label="Total" value={formatBRL(preview.total)} strong />
        {lines.length > 0 ? (
          <ValueRow
            muted
            label="Margem estimada"
            hint="Preço − custo médio − taxas − embalagem − impostos (RN-13)"
            value={
              <>
                <Money value={preview.margin} estimated hint="Estimativa com o custo médio do estoque; o valor real sai na entrega." />
                {preview.marginPct !== null ? ` (${formatPercent(preview.marginPct)})` : ''}
              </>
            }
          />
        ) : null}
      </div>

      {shortLines.length > 0 ? (
        <div role="alert" className="space-y-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Sem saldo livre para {shortLines.map((l) => l.product.fullName).join(', ')}. Peças reservadas para encomendas não contam como livres.
          </p>
          <Button size="sm" variant="outline" onClick={() => toOrder()}>
            <ClipboardList /> Transformar em encomenda
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );

  const confirmLabel = accountValue === 'RECEBER' ? 'Confirmar (a receber)' : `Confirmar ${formatBRL(preview.total)}`;

  return (
    <Page className="pb-44 lg:pb-8">
      <PageHeader
        back={<BackLink to="/vendas">Vendas</BackLink>}
        title="Venda rápida"
        description="Pronta entrega: confirma, entrega e recebe de uma vez."
        actions={
          <>
            <Button variant={feira.on ? 'accent' : 'outline'} aria-pressed={feira.on} onClick={toggleFeira}>
              <Store /> {feira.on ? 'Modo feira ligado' : 'Modo feira'}
            </Button>
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link to="/vendas/nova">
                <ClipboardList /> Pedido ou encomenda
              </Link>
            </Button>
          </>
        }
      />

      {feira.on ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-card)] border border-accent/60 bg-accent-soft px-4 py-3 text-sm text-ink">
          <span className="inline-flex items-center gap-2 font-semibold">
            <Store className="size-4" /> {channel?.name ?? 'Feira'} · {accountName}
          </span>
          <span className="sm:ml-auto">
            Vendido hoje: <strong className="num">{formatBRL(todayTotal)}</strong> em {todayDone.length} venda(s)
          </span>
        </div>
      ) : null}
      {lastSale ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Check className="size-4 text-success" /> Última venda {lastSale.number} · {formatBRL(lastSale.total)}
          <Link to={`/vendas/${lastSale.id}`} className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
            ver pedido
          </Link>
        </p>
      ) : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6">
        <section aria-label="Produtos">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar produto ou SKU…" aria-label="Pesquisar produto" className="h-11 pl-9" />
          </div>
          {catalog.error ? (
            <ErrorState error={catalog.error} onRetry={catalog.refetch} />
          ) : catalog.loading ? (
            <LoadingBlock />
          ) : catalog.products.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag />}
              title="Nenhum produto à venda"
              description="Cadastre produtos e variações (ou marque componentes como vendáveis) para vender aqui."
              action={
                <Button asChild>
                  <Link to="/produtos">Ir para Produtos</Link>
                </Button>
              }
            />
          ) : products.length === 0 ? (
            <EmptyState title="Nenhum produto encontrado" description="Tente outro nome ou SKU." />
          ) : (
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => (
                <ProductTile key={p.key} product={p} price={pricing.price(p)} qty={qtyOf(p.key)} onChange={(qty) => setQty(p.key, qty)} />
              ))}
            </ul>
          )}
        </section>

        {isDesktop ? (
          <aside className="sticky top-6" aria-label="Carrinho">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base">Carrinho</h2>
                {lines.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={resetCart}>
                    <X /> Limpar
                  </Button>
                ) : null}
              </div>
              {cartPanel}
              <Button size="lg" className="mt-4 w-full" onClick={submit} loading={save.isPending} disabled={lines.length === 0}>
                <Check /> {confirmLabel}
              </Button>
            </Card>
          </aside>
        ) : null}
      </div>

      {!isDesktop ? (
        <>
          <div
            className="fixed inset-x-0 z-30 border-t border-line bg-panel/95 px-3 pb-8 pt-2.5 shadow-[0_-10px_24px_-14px_rgb(20_20_20/0.35)] backdrop-blur"
            style={{ bottom: 'calc(3.7rem + env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto max-w-lg space-y-2">
              {paymentChips}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCartOpen(true)}
                  className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line-strong bg-panel px-3 text-left active:bg-subtle"
                  aria-label="Abrir carrinho"
                >
                  <ShoppingBag className="size-5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted">{units > 0 ? `${formatNumber(units)} item(ns)` : 'Carrinho vazio'}</span>
                    <span className="num block truncate text-base font-bold">{formatBRL(preview.total)}</span>
                  </span>
                  <ChevronUp className="size-4 shrink-0 text-muted" />
                </button>
                <Button size="lg" className="h-12 flex-[1.2] rounded-xl" onClick={submit} loading={save.isPending} disabled={lines.length === 0}>
                  <Check /> {accountValue === 'RECEBER' ? 'Confirmar' : 'Receber'}
                </Button>
              </div>
              {error && !cartOpen ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
          <Dialog open={cartOpen} onOpenChange={setCartOpen}>
            <DialogContent
              title="Carrinho"
              description={channel ? `${channel.name} · ${accountName}` : undefined}
              footer={
                <>
                  {lines.length > 0 ? (
                    <Button variant="ghost" onClick={resetCart}>
                      Limpar
                    </Button>
                  ) : null}
                  <Button size="lg" className="flex-1" onClick={submit} loading={save.isPending} disabled={lines.length === 0}>
                    <Check /> {confirmLabel}
                  </Button>
                </>
              }
            >
              {cartPanel}
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      <ConfirmDialog
        open={convertReason !== null}
        onOpenChange={(open) => !open && setConvertReason(null)}
        title="Sem saldo livre suficiente"
        description={`${convertReason ?? ''} Nada foi gravado. Quer transformar o carrinho em encomenda? Você ajusta o prazo e a condição de pagamento e o pedido reserva o que houver em estoque.`}
        confirmLabel="Transformar em encomenda"
        tone="primary"
        onConfirm={() => toOrder(convertReason ?? undefined)}
      />
    </Page>
  );
}

function ProductTile({ product, price, qty, onChange }: { product: CatalogProduct; price: number | null; qty: number; onChange: (qty: number) => void }) {
  const out = product.free <= 0;
  return (
    <li
      className={cn(
        'relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-panel shadow-[var(--shadow-card)] transition-colors',
        qty > 0 ? 'border-ink ring-1 ring-ink' : 'border-line',
      )}
    >
      <button type="button" onClick={() => onChange(qty + 1)} className="flex flex-1 flex-col gap-2 p-2 text-left active:bg-subtle" aria-label={`Adicionar ${product.fullName}`}>
        <ProductThumb name={product.name} photoPath={product.photoPath} className={cn('aspect-[4/3] w-full text-2xl', out && 'opacity-50')} />
        <span className="min-w-0 px-0.5">
          <span className="line-clamp-2 text-sm font-semibold leading-tight text-ink">{product.name}</span>
          {product.variantName ? <span className="block truncate text-xs text-muted">{product.variantName}</span> : null}
        </span>
        <span className="mt-auto flex flex-wrap items-baseline justify-between gap-x-1 px-0.5">
          <span className={cn('num text-base font-bold', price === null && 'text-sm font-medium text-muted')}>{price === null ? 'sem preço' : formatBRL(price)}</span>
          <span className={cn('text-xs', out ? 'font-medium text-danger' : 'text-muted')}>{out ? 'sem saldo' : `${formatNumber(product.free)} livre(s)`}</span>
        </span>
      </button>
      {qty > 0 ? (
        <>
          <span className="pointer-events-none absolute right-3 top-3 grid h-7 min-w-7 place-items-center rounded-full bg-ink px-2 text-sm font-bold text-brand-fg shadow">{formatNumber(qty)}</span>
          <div className="border-t border-line p-1.5">
            <Stepper value={qty} onChange={onChange} label={product.fullName} className="flex w-full justify-between" />
          </div>
        </>
      ) : null}
    </li>
  );
}
