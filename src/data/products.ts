import { keepPreviousData } from '@tanstack/react-query';
import { from, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';

/** Produtos, variações, fichas técnicas e preços por canal (Módulo 4). */

export type ProductCategory = 'CHAVEIRO' | 'DECORACAO' | 'UTILIDADE' | 'BRINQUEDO' | 'PERSONALIZADO' | 'OUTRO';
export type ModelSource = 'PROPRIO' | 'TERCEIRO_LIVRE' | 'TERCEIRO_LICENCIADO';
export type BomStatus = 'RASCUNHO' | 'ATIVA' | 'ARQUIVADA';
export type BomLineKind = 'FILAMENT_MODEL' | 'FILAMENT_SUPPORT' | 'FILAMENT_PURGE' | 'COMPONENT' | 'PACKAGING' | 'CONSUMABLE';
export type ConsumedAt = 'PRODUCTION' | 'ASSEMBLY' | 'DELIVERY';

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  CHAVEIRO: 'Chaveiro',
  DECORACAO: 'Decoração',
  UTILIDADE: 'Utilidade',
  BRINQUEDO: 'Brinquedo',
  PERSONALIZADO: 'Personalizado',
  OUTRO: 'Outro',
};

export const MODEL_SOURCE_LABELS: Record<ModelSource, string> = {
  PROPRIO: 'Modelo próprio',
  TERCEIRO_LIVRE: 'De terceiro, licença livre',
  TERCEIRO_LICENCIADO: 'De terceiro, licenciado',
};

export const BOM_STATUS_LABELS: Record<BomStatus, string> = { RASCUNHO: 'Rascunho', ATIVA: 'Ativa', ARQUIVADA: 'Arquivada' };

export const LINE_KIND_LABELS: Record<BomLineKind, string> = {
  FILAMENT_MODEL: 'Filamento (peça)',
  FILAMENT_SUPPORT: 'Filamento (suporte)',
  FILAMENT_PURGE: 'Filamento (purga)',
  COMPONENT: 'Componente',
  PACKAGING: 'Embalagem',
  CONSUMABLE: 'Consumível',
};

export const CONSUMED_AT_LABELS: Record<ConsumedAt, string> = { PRODUCTION: 'Na impressão', ASSEMBLY: 'Na montagem', DELIVERY: 'Na entrega' };

export interface Product {
  id: number;
  name: string;
  slug: string;
  category: ProductCategory;
  description: string | null;
  photo_path: string | null;
  model_source: ModelSource;
  license_notes: string | null;
  license_allows_commercial: boolean | null;
  is_custom: boolean;
  active: boolean;
}

export interface VariantRow {
  id: number;
  product_id: number;
  product_name: string;
  category: ProductCategory;
  slug: string;
  photo_path: string | null;
  model_source: ModelSource;
  license_notes: string | null;
  license_allows_commercial: boolean | null;
  is_custom: boolean;
  product_active: boolean;
  sku: string;
  name: string;
  full_name: string;
  item_id: number;
  is_hidden: boolean;
  active: boolean;
  active_bom_id: number | null;
  active_bom_version: number | null;
  units_per_plate: number | null;
  est_print_minutes_per_plate: number | null;
  est_post_process_minutes_per_unit: number | null;
  draft_bom_id: number | null;
  qty_on_hand: number;
  qty_reserved: number;
  qty_available: number;
  qty_in_finishing: number;
  reference_price: number | null;
  avg_cost_total: number | null;
  value_total: number | null;
}

export interface BomVersion {
  id: number;
  variant_id: number;
  version: number;
  status: BomStatus;
  units_per_plate: number;
  est_print_minutes_per_plate: number;
  est_post_process_minutes_per_unit: number;
  default_equipment_id: number | null;
  default_equipment_name: string | null;
  notes: string | null;
  activated_at: string | null;
  created_at: string;
  machine_minutes_per_unit: number;
  grams_per_unit: number | null;
}

export interface BomLine {
  id: number;
  bom_version_id: number;
  item_id: number;
  sku: string;
  item_name: string;
  item_kind: string;
  unit: string;
  color_hex: string | null;
  line_kind: BomLineKind;
  qty_per_unit: number;
  waste_pct: number;
  consumed_at: ConsumedAt;
  sort_order: number;
  avg_cost_total: number | null;
}

export interface BomLineInput {
  item_id: number;
  line_kind: BomLineKind;
  qty_per_unit: string;
  waste_pct: string;
  consumed_at: ConsumedAt;
}

export interface BomInput {
  id?: number | null;
  variant_id: number;
  units_per_plate: number;
  est_print_minutes_per_plate: number;
  est_post_process_minutes_per_unit: number;
  default_equipment_id: number | null;
  notes: string | null;
  lines: BomLineInput[];
}

/** Custo estimado de uma unidade pela ficha (US-4.4), por camada. */
export interface CostEstimate {
  material: number;
  energy: number;
  depreciation: number;
  operational: number;
  labor: number;
  packaging: number;
  total_production: number;
  machine_minutes: number;
  grams: number;
  rate_mode: 'SPLIT' | 'COMBINED' | 'MISSING';
  labor_valued: boolean;
  estimated: boolean;
  equipment_id: number | null;
  lines: Array<{ item_id: number; qty: number; unit_cost: number; cost: number; estimated: boolean }>;
}

export interface ChannelPricing {
  channel_id: number;
  channel_name: string;
  channel_kind: string;
  price: number | null;
  fees: number | null;
  tax: number | null;
  packaging: number;
  unit_cost: number | null;
  contribution_margin: number | null;
  contribution_margin_pct: number | null;
  margin_per_machine_hour: number | null;
  suggested_price: number | null;
  fee_pct: number;
  fee_fixed: number;
  payment_fee_pct: number;
}

export interface VariantPricing {
  unit_cost: number | null;
  estimate: CostEstimate | null;
  machine_hours_per_unit: number | null;
  margin_target_pct: number;
  channels: ChannelPricing[];
}

export interface ChannelPrice {
  id: number;
  variant_id: number;
  channel_id: number;
  price: number;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
}

export interface EquipmentOption {
  id: number;
  name: string;
  kind: string;
  status: string;
}

export function useProducts(includeInactive = false) {
  return useAppQuery(['products', includeInactive], async () => {
    let query = from('products').select('*').order('name');
    if (!includeInactive) query = query.eq('active', true);
    return unwrap<Product[]>(query);
  });
}

export function useProduct(id: number | undefined) {
  return useAppQuery(
    ['products', 'detail', id],
    async () => {
      const rows = await unwrap<Product[]>(from('products').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

/** Variações (com saldo, ficha ativa e custo médio). Sem filtro, traz todas as visíveis. */
export function useVariants(options: { productId?: number; includeHidden?: boolean } = {}) {
  return useAppQuery(['variants', options.productId ?? 'all', options.includeHidden ?? false], async () => {
    let query = from('v_product_variants').select('*').order('product_name').order('name');
    if (options.productId) query = query.eq('product_id', options.productId);
    else if (!options.includeHidden) query = query.eq('is_hidden', false);
    return unwrap<VariantRow[]>(query);
  });
}

export function useBomVersions(variantId: number | undefined) {
  return useAppQuery(
    ['bom-versions', variantId],
    () => unwrap<BomVersion[]>(from('v_bom_versions').select('*').eq('variant_id', variantId!).order('version', { ascending: false })),
    { enabled: Boolean(variantId) },
  );
}

export function useBomVersion(bomId: number | undefined) {
  return useAppQuery(
    ['bom-versions', 'detail', bomId],
    async () => {
      const rows = await unwrap<BomVersion[]>(from('v_bom_versions').select('*').eq('id', bomId!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(bomId) },
  );
}

export function useBomLines(bomId: number | null | undefined) {
  return useAppQuery(
    ['bom-lines', bomId],
    () => unwrap<BomLine[]>(from('v_bom_lines').select('*').eq('bom_version_id', bomId!).order('sort_order')),
    { enabled: Boolean(bomId) },
  );
}

export function useBomEstimate(bomId: number | null | undefined, enabled = true) {
  return useAppQuery(['bom-estimate', bomId], () => rpc<CostEstimate>('estimate_bom_cost', { p_bom_id: bomId }), { enabled: Boolean(bomId) && enabled });
}

/** Recalcula o custo sem salvar (a tela da ficha chama a cada alteração, com atraso curto). */
export function usePreviewBomCost(bom: Omit<BomInput, 'variant_id' | 'id'> | null, enabled = true) {
  return useAppQuery(['bom-preview', bom], () => rpc<CostEstimate>('preview_bom_cost', { p_bom: bom }), {
    enabled: Boolean(bom) && enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useVariantPricing(variantId: number | undefined, enabled = true) {
  return useAppQuery(['variant-pricing', variantId], () => rpc<VariantPricing>('variant_pricing', { p_variant_id: variantId }), {
    enabled: Boolean(variantId) && enabled,
  });
}

export function useChannelPrices(variantId: number | undefined, enabled = true) {
  return useAppQuery(
    ['channel-prices', variantId],
    () => unwrap<ChannelPrice[]>(from('channel_prices').select('*').eq('variant_id', variantId!).order('valid_from', { ascending: false })),
    { enabled: Boolean(variantId) && enabled },
  );
}

/** Impressoras e outros equipamentos para a máquina padrão da ficha. */
export function useEquipmentOptions() {
  return useAppQuery(['equipment-options'], () => unwrap<EquipmentOption[]>(from('v_equipment').select('id,name,kind,status').order('name')));
}

export interface ProductInput {
  id?: number;
  name: string;
  category: ProductCategory;
  description?: string | null;
  model_source: ModelSource;
  license_notes?: string | null;
  license_allows_commercial?: boolean | null;
  active?: boolean;
  variants: Array<{ id?: number; name: string; sku?: string | null; reference_price?: string | null; active?: boolean }>;
}

export function useSaveProduct(onSaved?: (id: number) => void) {
  return useWrite<ProductInput, number>({
    mutationFn: (product) => rpc<number>('save_product', { p_product: product }),
    success: (_id, p) => (p.id ? 'Produto atualizado.' : 'Produto cadastrado: cada variação já tem seu item de estoque.'),
    onSuccess: (id) => onSaved?.(id),
  });
}

export function useSaveBomDraft(onSaved?: (id: number) => void) {
  return useWrite<BomInput, number>({
    mutationFn: (bom) => rpc<number>('save_bom_draft', { p_bom: bom }),
    success: 'Rascunho da ficha salvo.',
    onSuccess: (id) => onSaved?.(id),
  });
}

/** Salva o rascunho e ativa (a versão ativa anterior vai para o histórico). */
export function useActivateBom(onDone?: (id: number) => void) {
  return useWrite<BomInput, number>({
    mutationFn: async (bom) => {
      const id = await rpc<number>('save_bom_draft', { p_bom: bom });
      await rpc('activate_bom', { p_bom_id: id });
      return id;
    },
    success: 'Ficha ativada: as próximas impressões e estimativas usam esta versão.',
    onSuccess: (id) => onDone?.(id),
  });
}

export function useCopyBom(onDone?: (id: number) => void) {
  return useWrite<{ bomId: number; targetVariantId?: number | null; swaps?: Record<string, number> }, number>({
    mutationFn: (v) => rpc<number>('copy_bom', { p_bom_id: v.bomId, p_target_variant_id: v.targetVariantId ?? null, p_swaps: v.swaps ?? {} }),
    success: 'Nova versão criada em rascunho.',
    onSuccess: (id) => onDone?.(id),
  });
}

export function useDiscardBomDraft(onDone?: () => void) {
  return useWrite<number>({
    mutationFn: (bomId) => rpc('discard_bom_draft', { p_bom_id: bomId }),
    success: 'Rascunho descartado.',
    onSuccess: () => onDone?.(),
  });
}

export function useSetChannelPrice(onDone?: () => void) {
  return useWrite<{ variantId: number; channelId: number; price: string; validFrom?: string | null }, number>({
    mutationFn: (v) => rpc<number>('set_channel_price', { p_variant_id: v.variantId, p_channel_id: v.channelId, p_price: v.price, p_valid_from: v.validFrom ?? null }),
    success: 'Preço do canal atualizado.',
    onSuccess: () => onDone?.(),
  });
}

/** Linha padrão da ficha a partir do tipo do item (mesma regra do banco). */
export function defaultLineFor(kind: string): { line_kind: BomLineKind; consumed_at: ConsumedAt } {
  switch (kind) {
    case 'FILAMENT':
      return { line_kind: 'FILAMENT_MODEL', consumed_at: 'PRODUCTION' };
    case 'COMPONENT':
      return { line_kind: 'COMPONENT', consumed_at: 'ASSEMBLY' };
    case 'PACKAGING':
      return { line_kind: 'PACKAGING', consumed_at: 'DELIVERY' };
    default:
      return { line_kind: 'CONSUMABLE', consumed_at: 'ASSEMBLY' };
  }
}
