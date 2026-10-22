import { from, newRequestId, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';

/** Itens, carretéis e razão de estoque (Módulo 1). Leituras pelas views v_* (custos ocultos para Produção). */

export type ItemKind = 'FILAMENT' | 'COMPONENT' | 'PACKAGING' | 'CONSUMABLE' | 'TOOL' | 'FINISHED_GOOD';
export type ItemUnit = 'G' | 'UN' | 'ML' | 'M';
export type Material = 'PLA' | 'PLA_PLUS' | 'PETG' | 'ABS' | 'ASA' | 'TPU' | 'NYLON' | 'OUTRO';
export type MovementType =
  | 'OPENING'
  | 'PURCHASE_RECEIPT'
  | 'PRODUCTION_CONSUMPTION'
  | 'ASSEMBLY_CONSUMPTION'
  | 'PRODUCTION_OUTPUT'
  | 'SALE_ISSUE'
  | 'PACKAGING_ISSUE'
  | 'MAINTENANCE_CONSUMPTION'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'LOSS'
  | 'GIFT'
  | 'SAMPLE'
  | 'PERSONAL_USE'
  | 'RETURN_IN'
  | 'CONSUMABLE_USE'
  | 'REVERSAL';

export const KIND_LABELS: Record<ItemKind, string> = {
  FILAMENT: 'Filamento',
  COMPONENT: 'Componente',
  PACKAGING: 'Embalagem',
  CONSUMABLE: 'Consumível',
  TOOL: 'Ferramenta',
  FINISHED_GOOD: 'Produto pronto',
};

export const KIND_TABS: Array<{ kind: ItemKind; label: string }> = [
  { kind: 'FILAMENT', label: 'Filamentos' },
  { kind: 'COMPONENT', label: 'Componentes' },
  { kind: 'PACKAGING', label: 'Embalagens' },
  { kind: 'CONSUMABLE', label: 'Consumíveis' },
  { kind: 'TOOL', label: 'Ferramentas' },
  { kind: 'FINISHED_GOOD', label: 'Produtos prontos' },
];

export const MATERIAL_LABELS: Record<Material, string> = {
  PLA: 'PLA',
  PLA_PLUS: 'PLA+',
  PETG: 'PETG',
  ABS: 'ABS',
  ASA: 'ASA',
  TPU: 'TPU',
  NYLON: 'Nylon',
  OUTRO: 'Outro',
};

/** Densidade típica por material (seção 18.7), editável no cadastro. */
export const TYPICAL_DENSITY: Record<Material, number> = { PLA: 1.24, PLA_PLUS: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, NYLON: 1.14, OUTRO: 1.24 };

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  OPENING: 'Saldo inicial',
  PURCHASE_RECEIPT: 'Recebimento de compra',
  PRODUCTION_CONSUMPTION: 'Consumo na impressão',
  ASSEMBLY_CONSUMPTION: 'Consumo na montagem',
  PRODUCTION_OUTPUT: 'Entrada da produção',
  SALE_ISSUE: 'Saída por venda',
  PACKAGING_ISSUE: 'Embalagem de venda',
  MAINTENANCE_CONSUMPTION: 'Manutenção',
  ADJUSTMENT_IN: 'Ajuste (entrada)',
  ADJUSTMENT_OUT: 'Ajuste (saída)',
  LOSS: 'Perda',
  GIFT: 'Brinde',
  SAMPLE: 'Amostra',
  PERSONAL_USE: 'Uso pessoal',
  RETURN_IN: 'Devolução de cliente',
  CONSUMABLE_USE: 'Consumo',
  REVERSAL: 'Estorno',
};

export const LOT_STATUS_LABELS: Record<string, string> = { FECHADO: 'Fechado', ABERTO: 'Aberto', ESGOTADO: 'Esgotado', DESCARTADO: 'Descartado' };

export const TOOL_CONDITION_LABELS: Record<string, string> = { BOA: 'Boa', DESGASTADA: 'Desgastada', QUEBRADA: 'Quebrada', PERDIDA: 'Perdida' };

export interface ItemRow {
  id: number;
  sku: string;
  name: string;
  kind: ItemKind;
  unit: ItemUnit;
  is_stock_tracked: boolean;
  is_sellable: boolean;
  min_qty: number;
  reorder_qty: number;
  location: string | null;
  default_supplier_id: number | null;
  default_supplier_name: string | null;
  notes: string | null;
  active: boolean;
  material: Material | null;
  brand: string | null;
  color_name: string | null;
  color_hex: string | null;
  diameter_mm: number | null;
  density_g_cm3: number | null;
  nominal_spool_g: number | null;
  empty_spool_tare_g: number | null;
  needs_drying: boolean | null;
  tool_condition: string | null;
  tool_acquired_at: string | null;
  tool_acquisition_value: number | null;
  variant_id: number | null;
  product_id: number | null;
  product_name: string | null;
  variant_name: string | null;
  qty_on_hand: number;
  qty_reserved: number;
  qty_available: number;
  open_lots: number;
  closed_lots: number;
  open_lot_remaining: number | null;
  reference_cost: boolean;
  daily_consumption: number | null;
  coverage_days: number | null;
  below_minimum: boolean;
  last_movement_at: string | null;
  avg_cost_material: number | null;
  avg_cost_energy: number | null;
  avg_cost_depreciation: number | null;
  avg_cost_operational: number | null;
  avg_cost_labor: number | null;
  avg_cost_total: number | null;
  value_total: number | null;
  reference_price: number | null;
}

export interface LotRow {
  id: number;
  item_id: number;
  sku: string;
  item_name: string;
  color_hex: string | null;
  material: Material | null;
  lot_code: string;
  received_at: string;
  qty_initial: number;
  qty_remaining: number;
  remaining_pct: number | null;
  status: 'FECHADO' | 'ABERTO' | 'ESGOTADO' | 'DESCARTADO';
  opened_at: string | null;
  finished_at: string | null;
  reference_cost: boolean;
  source_type: string | null;
  unit_cost_in: number | null;
}

export interface MovementRow {
  id: number;
  item_id: number;
  sku: string;
  item_name: string;
  item_kind: ItemKind;
  unit: ItemUnit;
  lot_id: number | null;
  lot_code: string | null;
  occurred_at: string;
  type: MovementType;
  qty: number;
  qty_after: number;
  source_type: string | null;
  source_id: number | null;
  source_ref: string | null;
  source_doc_id: number | null;
  operation_id: string;
  reason: string | null;
  reverses_id: number | null;
  is_reversed: boolean;
  is_standalone: boolean;
  created_by_name: string | null;
  unit_cost_material: number | null;
  unit_cost_operational_group: number | null;
  unit_cost_labor: number | null;
  unit_cost_total: number | null;
  total_cost: number | null;
  avg_cost_after: number | null;
}

export interface Supplier {
  id: number;
  name: string;
  document: string | null;
  kind: 'LOJA_ONLINE' | 'MARKETPLACE' | 'LOJA_FISICA' | null;
  contact: string | null;
  url: string | null;
  notes: string | null;
  active: boolean;
}

/** Link para o documento de origem de uma movimentação. */
export function movementSourceHref(m: Pick<MovementRow, 'source_type' | 'source_doc_id'>): string | null {
  switch (m.source_type) {
    case 'purchase':
      return `/compras/${m.source_doc_id}`;
    case 'print_job':
    case 'print_job_output':
      return `/producao/impressoes/${m.source_doc_id}`;
    case 'delivery':
      return `/vendas/${m.source_doc_id}`;
    default:
      return null;
  }
}

export function useItems(options: { kind?: ItemKind; includeInactive?: boolean } = {}) {
  return useAppQuery(['items', options.kind ?? 'all', options.includeInactive ?? false], async () => {
    let query = from('v_items').select('*').order('name');
    if (options.kind) query = query.eq('kind', options.kind);
    if (!options.includeInactive) query = query.eq('active', true);
    return unwrap<ItemRow[]>(query);
  });
}

export function useItem(id: number | undefined) {
  return useAppQuery(
    ['items', 'detail', id],
    async () => {
      const rows = await unwrap<ItemRow[]>(from('v_items').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

export function useLots(itemId?: number, onlyActive = false) {
  return useAppQuery(['lots', itemId ?? 'all', onlyActive], async () => {
    let query = from('v_stock_lots').select('*').order('received_at', { ascending: false });
    if (itemId) query = query.eq('item_id', itemId);
    if (onlyActive) query = query.in('status', ['ABERTO', 'FECHADO']).gt('qty_remaining', 0);
    return unwrap<LotRow[]>(query);
  });
}

export function useMovements(itemId: number | undefined, range?: { from: string; to: string }) {
  return useAppQuery(
    ['movements', itemId, range?.from ?? null, range?.to ?? null],
    async () => {
      let query = from('v_stock_movements').select('*').eq('item_id', itemId!).order('occurred_at', { ascending: false }).order('id', { ascending: false });
      if (range) query = query.gte('occurred_at', `${range.from}T00:00:00-03:00`).lte('occurred_at', `${range.to}T23:59:59-03:00`);
      const rows = await unwrap<MovementRow[]>(query.limit(1000));
      // Saldo no início do período: o "saldo após" do último movimento anterior.
      let opening = 0;
      if (range) {
        const before = await unwrap<Array<{ qty_after: number }>>(
          from('v_stock_movements').select('qty_after').eq('item_id', itemId!).lt('occurred_at', `${range.from}T00:00:00-03:00`).order('id', { ascending: false }).limit(1),
        );
        opening = Number(before[0]?.qty_after ?? 0);
      }
      return { rows, opening };
    },
    { enabled: Boolean(itemId) },
  );
}

export function useSuppliers(includeInactive = false) {
  return useAppQuery(['suppliers', includeInactive], async () => {
    let query = from('suppliers').select('*').order('name');
    if (!includeInactive) query = query.eq('active', true);
    return unwrap<Supplier[]>(query);
  });
}

export function suggestSku(kind: ItemKind, name: string, material?: string | null, color?: string | null) {
  return rpc<string>('suggest_item_sku', { p_kind: kind, p_name: name, p_material: material ?? null, p_color: color ?? null });
}

export interface ItemInput {
  id?: number;
  kind: ItemKind;
  name: string;
  sku?: string;
  unit?: ItemUnit;
  is_stock_tracked?: boolean;
  is_sellable?: boolean;
  min_qty?: string | null;
  reorder_qty?: string | null;
  location?: string | null;
  default_supplier_id?: number | null;
  notes?: string | null;
  filament?: {
    material: Material;
    brand: string;
    color_name: string;
    color_hex: string;
    diameter_mm?: string | null;
    density_g_cm3?: string | null;
    nominal_spool_g?: string | null;
    empty_spool_tare_g?: string | null;
    needs_drying?: boolean;
  };
  tool?: { condition?: string; acquired_at?: string | null; acquisition_value?: string | null };
}

export function useSaveItem(onSaved?: (id: number) => void) {
  return useWrite<ItemInput, number>({
    mutationFn: (item) => rpc<number>('save_item', { p_item: item }),
    success: (_id, item) => (item.id ? 'Item atualizado.' : 'Item cadastrado.'),
    onSuccess: (id) => onSaved?.(id),
  });
}

export function useSetItemActive() {
  return useWrite<{ id: number; active: boolean }>({
    mutationFn: ({ id, active }) => rpc('set_item_active', { p_item_id: id, p_active: active }),
    success: (_r, v) => (v.active ? 'Item reativado.' : 'Item desativado: ele some das listas de seleção, mas continua nos relatórios.'),
  });
}

export function useSaveSupplier(onSaved?: (id: number) => void) {
  return useWrite<Partial<Supplier> & { name: string }, number>({
    mutationFn: (supplier) => rpc<number>('save_supplier', { p_supplier: supplier }),
    success: (_id, s) => (s.id ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.'),
    onSuccess: (id) => onSaved?.(id),
  });
}

interface MovementResult {
  movement_ids?: number[];
  movement_id?: number | null;
  operation_id?: string;
}

/** Desfaz uma operação avulsa recém-feita pelo primeiro movimento dela (o estorno pega a operação inteira). */
async function undoMovement(result: MovementResult) {
  const id = result.movement_ids?.[0] ?? result.movement_id;
  if (!id) return;
  await rpc('reverse_movement', { p_request_id: newRequestId(), p_movement_id: id, p_reason: 'Desfeito logo após o lançamento' });
}

export function useRegisterOpening(onDone?: () => void) {
  return useWrite<{ requestId: string; itemId: number; entries: Array<{ qty: string; unit_cost?: string | null; layers?: Record<string, string> }>; occurredAt?: string | null }, MovementResult>({
    mutationFn: (v) => rpc('register_opening_balance', { p_request_id: v.requestId, p_item_id: v.itemId, p_entries: v.entries, p_occurred_at: v.occurredAt ?? null }),
    success: 'Saldo inicial registrado.',
    undo: { run: undoMovement },
    onSuccess: () => onDone?.(),
  });
}

export function useRegisterIssue(onDone?: () => void) {
  return useWrite<{ requestId: string; itemId: number; type: string; qty: string; reason: string; lotId?: number | null; occurredAt?: string | null }, MovementResult & { total_cost?: number }>({
    mutationFn: (v) =>
      rpc('register_stock_issue', {
        p_request_id: v.requestId,
        p_item_id: v.itemId,
        p_type: v.type,
        p_qty: v.qty,
        p_reason: v.reason,
        p_lot_id: v.lotId ?? null,
        p_occurred_at: v.occurredAt ?? null,
      }),
    success: 'Saída registrada.',
    undo: { run: undoMovement },
    onSuccess: () => onDone?.(),
  });
}

export function useAdjustStock(onDone?: (result: { diff: number }) => void) {
  return useWrite<
    { requestId: string; itemId: number; countedQty?: string | null; grossWeight?: string | null; lotId?: number | null; reason: string; confirmLarge?: boolean },
    MovementResult & { diff: number }
  >({
    mutationFn: (v) =>
      rpc('adjust_stock', {
        p_request_id: v.requestId,
        p_item_id: v.itemId,
        p_counted_qty: v.countedQty ?? null,
        p_reason: v.reason,
        p_lot_id: v.lotId ?? null,
        p_gross_weight_g: v.grossWeight ?? null,
        p_confirm_large: v.confirmLarge ?? false,
      }),
    success: (r) => (Number(r.diff) === 0 ? 'Sem diferença: o saldo já estava certo.' : 'Ajuste registrado.'),
    undo: { run: undoMovement },
    onSuccess: (r) => onDone?.(r),
    toastError: false,
  });
}

export function useDiscardLot(onDone?: () => void) {
  return useWrite<{ requestId: string; lotId: number; reason: string }, MovementResult>({
    mutationFn: (v) => rpc('discard_lot', { p_request_id: v.requestId, p_lot_id: v.lotId, p_reason: v.reason }),
    success: 'Resto do carretel descartado como perda.',
    undo: { run: undoMovement },
    onSuccess: () => onDone?.(),
  });
}

export function useOpenLot() {
  return useWrite<number>({
    mutationFn: (lotId) => rpc('open_lot', { p_lot_id: lotId }),
    success: 'Carretel marcado como aberto.',
  });
}

export function useReverseMovement(onDone?: () => void) {
  return useWrite<{ movementId: number; reason: string }>({
    mutationFn: (v) => rpc('reverse_movement', { p_request_id: newRequestId(), p_movement_id: v.movementId, p_reason: v.reason }),
    success: 'Movimentação estornada.',
    onSuccess: () => onDone?.(),
  });
}
