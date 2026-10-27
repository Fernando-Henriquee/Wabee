import { useMemo } from 'react';
import { type ItemRow, useItems } from '@/data/inventory';
import { useVariants } from '@/data/products';
import { useAllChannelPrices, useChannelFees } from '@/data/sales';
import { currentFee, priceFor } from './cart';

/** Produto à venda: variação de produto pronto ou componente vendável avulso. */
export interface CatalogProduct {
  key: string;
  variantId: number | null;
  itemId: number;
  name: string;
  variantName: string | null;
  fullName: string;
  sku: string;
  photoPath: string | null;
  free: number;
  onHand: number;
  bomId: number | null;
  unitCost: number | null;
  referencePrice: number | null;
  /** Item pontual de encomenda (variação oculta): fora das listas de escolha, mas reconhecido nas linhas. */
  hidden: boolean;
}

export function productKey(line: { variantId?: number | null; itemId?: number | null }): string {
  return line.variantId ? `v${line.variantId}` : `i${line.itemId}`;
}

export function useCatalog() {
  // Inclui as ocultas para mostrar nome e custo de itens pontuais já lançados em pedidos.
  const variants = useVariants({ includeHidden: true });
  const components = useItems({ kind: 'COMPONENT' });
  const all = useMemo<CatalogProduct[]>(() => {
    const list: CatalogProduct[] = (variants.data ?? []).filter((v) => v.active && v.product_active).map((v) => ({
      key: `v${v.id}`,
      variantId: v.id,
      itemId: v.item_id,
      name: v.product_name,
      variantName: v.name,
      // Item pontual: o nome da variação ("pontual") não acrescenta nada.
      fullName: v.is_hidden ? v.product_name : v.full_name,
      sku: v.sku,
      photoPath: v.photo_path,
      free: Number(v.qty_available ?? 0),
      onHand: Number(v.qty_on_hand ?? 0),
      bomId: v.active_bom_id,
      // Custo médio zero sem nunca ter tido estoque não é custo: conta como "sem custo" na prévia.
      unitCost: v.avg_cost_total === null || (Number(v.avg_cost_total) === 0 && Number(v.qty_on_hand ?? 0) <= 0) ? null : Number(v.avg_cost_total),
      referencePrice: v.reference_price === null ? null : Number(v.reference_price),
      hidden: v.is_hidden,
    }));
    for (const c of (components.data ?? []).filter((i: ItemRow) => i.is_sellable)) {
      list.push({
        key: `i${c.id}`,
        variantId: null,
        itemId: c.id,
        name: c.name,
        variantName: null,
        fullName: c.name,
        sku: c.sku,
        photoPath: null,
        free: Number(c.qty_available ?? 0),
        onHand: Number(c.qty_on_hand ?? 0),
        bomId: null,
        unitCost: c.avg_cost_total === null ? null : Number(c.avg_cost_total),
        referencePrice: null,
        hidden: false,
      });
    }
    return list;
  }, [variants.data, components.data]);
  const products = useMemo(() => all.filter((p) => !p.hidden), [all]);
  const byKey = useMemo(() => new Map(all.map((p) => [p.key, p])), [all]);
  return {
    products,
    byKey,
    loading: !variants.data || !components.data,
    error: variants.error ?? components.error,
    refetch: () => {
      void variants.refetch();
      void components.refetch();
    },
  };
}

/** Taxas e preços do canal vigentes na data. */
export function useChannelPricing(channelId: number | null | undefined, on: string) {
  const fees = useChannelFees();
  const prices = useAllChannelPrices();
  const fee = currentFee(fees.data, channelId, on);
  return {
    fee,
    ready: Boolean(fees.data && prices.data),
    price: (product: CatalogProduct | undefined): number | null => {
      if (!product) return null;
      if (!product.variantId) return product.referencePrice;
      return priceFor({ id: product.variantId, reference_price: product.referencePrice }, prices.data, channelId, on);
    },
  };
}

export interface PackagingItem {
  id: number;
  name: string;
  avgCost: number | null;
  free: number;
}

export function usePackagingItems() {
  const items = useItems({ kind: 'PACKAGING' });
  const map = useMemo(
    () =>
      new Map<number, PackagingItem>(
        (items.data ?? []).map((i) => [i.id, { id: i.id, name: i.name, avgCost: i.avg_cost_total === null ? null : Number(i.avg_cost_total), free: Number(i.qty_available ?? 0) }]),
      ),
    [items.data],
  );
  return { items: map, loading: !items.data };
}

export interface PackagingRow {
  itemId: number;
  qty: string | null;
}

/** Lista efetiva: a editada ou a padrão (fichas + embalagem por pedido). */
export function effectivePackaging(defaults: Map<number, string>, value: PackagingRow[] | null): PackagingRow[] {
  return value ?? [...defaults].map(([itemId, qty]) => ({ itemId, qty }));
}

export function packagingCost(rows: PackagingRow[], items: Map<number, PackagingItem>): number {
  return rows.reduce((sum, r) => sum + Number(r.qty ?? 0) * Number(items.get(r.itemId)?.avgCost ?? 0), 0);
}

