import { from, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';

/**
 * Produção (Módulo 5) e equipamentos/taxas (Módulo 2). Leituras pelas views v_* — para o
 * perfil Produção as colunas de valores chegam nulas. Escritas só pelas RPCs.
 */

export type PrintJobStatus = 'PLANEJADA' | 'IMPRIMINDO' | 'CONCLUIDA' | 'FALHOU' | 'CANCELADA' | 'ESTORNADA';
export type FailureReason =
  | 'DESCOLOU_MESA'
  | 'ENTUPIMENTO'
  | 'FALTA_FILAMENTO'
  | 'QUEDA_ENERGIA'
  | 'ERRO_MODELO'
  | 'UMIDADE'
  | 'CAMADA_DESLOCADA'
  | 'DEFEITO_ACABAMENTO'
  | 'OUTRO';
export type PostProcessKind = 'REMOCAO_SUPORTE' | 'LIXA' | 'PINTURA' | 'MONTAGEM' | 'INSPECAO';
export type OutputStatus = 'AGUARDANDO_ACABAMENTO' | 'LIBERADA';
export type EquipmentKind = 'PRINTER' | 'DRYER' | 'POST_PROCESS' | 'OTHER';
export type EquipmentStatus = 'ATIVO' | 'MANUTENCAO' | 'BAIXADO';
export type RateType = 'ENERGY_PRICE_KWH' | 'ENERGY_PER_HOUR' | 'DEPRECIATION_PER_HOUR' | 'OPERATIONAL_PER_HOUR' | 'MAINTENANCE_PER_HOUR' | 'LABOR_PER_HOUR';
export type RateMode = 'SPLIT' | 'COMBINED' | 'MISSING';

export const JOB_STATUS_LABELS: Record<PrintJobStatus, string> = {
  PLANEJADA: 'Planejada',
  IMPRIMINDO: 'Imprimindo',
  CONCLUIDA: 'Concluída',
  FALHOU: 'Falhou',
  CANCELADA: 'Cancelada',
  ESTORNADA: 'Estornada',
};

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  DESCOLOU_MESA: 'Descolou da mesa',
  ENTUPIMENTO: 'Entupimento',
  FALTA_FILAMENTO: 'Falta de filamento',
  QUEDA_ENERGIA: 'Queda de energia',
  ERRO_MODELO: 'Erro de modelo/fatiamento',
  UMIDADE: 'Umidade do filamento',
  CAMADA_DESLOCADA: 'Camada deslocada',
  DEFEITO_ACABAMENTO: 'Defeito no acabamento',
  OUTRO: 'Outro',
};

export const FAILURE_REASONS = Object.keys(FAILURE_REASON_LABELS) as FailureReason[];

export const POST_PROCESS_LABELS: Record<PostProcessKind, string> = {
  REMOCAO_SUPORTE: 'Remoção de suporte',
  LIXA: 'Lixa',
  PINTURA: 'Pintura',
  MONTAGEM: 'Montagem',
  INSPECAO: 'Inspeção',
};

export const POST_PROCESS_KINDS = Object.keys(POST_PROCESS_LABELS) as PostProcessKind[];

export const OUTPUT_STATUS_LABELS: Record<OutputStatus, string> = { AGUARDANDO_ACABAMENTO: 'Aguardando acabamento', LIBERADA: 'Liberada' };

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = { PRINTER: 'Impressora 3D', DRYER: 'Secadora', POST_PROCESS: 'Pós-processamento', OTHER: 'Outro' };
export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = { ATIVO: 'Ativo', MANUTENCAO: 'Em manutenção', BAIXADO: 'Baixado' };

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  ENERGY_PRICE_KWH: 'Tarifa de energia (R$/kWh)',
  ENERGY_PER_HOUR: 'Energia por hora',
  DEPRECIATION_PER_HOUR: 'Depreciação por hora',
  OPERATIONAL_PER_HOUR: 'Operacional combinada por hora',
  MAINTENANCE_PER_HOUR: 'Manutenção por hora',
  LABOR_PER_HOUR: 'Trabalho por hora',
};

export const RATE_TYPES = Object.keys(RATE_TYPE_LABELS) as RateType[];

/** Unidade do valor da taxa na tela. */
export function rateUnit(type: RateType): string {
  return type === 'ENERGY_PRICE_KWH' ? '/kWh' : '/h';
}

export const RATE_MODE_LABELS: Record<RateMode, string> = {
  SPLIT: 'Energia + depreciação separadas',
  COMBINED: 'Taxa combinada',
  MISSING: 'Sem taxa vigente',
};

export interface PrintJobRow {
  id: number;
  code: string;
  status: PrintJobStatus;
  equipment_id: number;
  equipment_name: string;
  planned_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  est_minutes: number;
  actual_minutes: number | null;
  time_estimated: boolean;
  sales_order_id: number | null;
  failure_reason: FailureReason | null;
  failure_notes: string | null;
  notes: string | null;
  expected_end: string | null;
  rate_mode: RateMode | null;
  missing_rates: boolean;
  reversed_at: string | null;
  reverse_reason: string | null;
  replanned_from_id: number | null;
  created_at: string;
  qty_planned: number;
  qty_good: number;
  qty_failed: number;
  outputs_waiting: number;
  outputs_summary: string | null;
  est_grams: number;
  actual_grams: number | null;
  cost_material: number | null;
  cost_energy: number | null;
  cost_depreciation: number | null;
  cost_operational: number | null;
  cost_labor: number | null;
  cost_total: number | null;
  cost_scrap: number | null;
}

export interface PrintJobOutputRow {
  id: number;
  print_job_id: number;
  print_job_code: string;
  print_job_status: PrintJobStatus;
  equipment_id: number;
  finished_at: string | null;
  variant_id: number;
  variant_sku: string;
  product_id: number;
  variant_name: string;
  item_id: number;
  bom_version_id: number | null;
  qty_planned: number;
  qty_good: number | null;
  qty_failed: number | null;
  qty_released: number | null;
  qty_rejected: number;
  est_weight_g_per_unit: number | null;
  allocation_share: number | null;
  failure_reason: FailureReason | null;
  status: OutputStatus | null;
  needs_finishing: boolean;
  released_at: string | null;
  reject_reason: string | null;
  sort_order: number;
  post_process_minutes: number;
  alloc_total: number | null;
  alloc_material: number | null;
  alloc_operational_group: number | null;
  good_cost: number | null;
  scrap_cost: number | null;
  components_cost: number | null;
  labor_cost: number | null;
  unit_material: number | null;
  unit_energy: number | null;
  unit_depreciation: number | null;
  unit_operational: number | null;
  unit_labor: number | null;
  unit_total: number | null;
  print_unit_cost: number | null;
}

export interface PrintJobMaterialRow {
  id: number;
  print_job_id: number;
  item_id: number;
  sku: string;
  item_name: string;
  color_hex: string | null;
  material: string | null;
  lot_id: number | null;
  lot_code: string | null;
  est_g: number;
  actual_g: number | null;
  unit_cost_snapshot: number | null;
  cost_total: number | null;
}

export interface PostProcessEntryRow {
  id: number;
  output_id: number;
  performed_at: string;
  minutes: number;
  kind: PostProcessKind;
  notes: string | null;
  created_by: string | null;
  labor_rate: number | null;
  labor_cost: number | null;
}

export interface EquipmentRow {
  id: number;
  name: string;
  kind: EquipmentKind;
  brand: string | null;
  model: string | null;
  serial: string | null;
  acquired_at: string | null;
  useful_life_hours: number | null;
  avg_power_w: number | null;
  initial_hours: number;
  maintenance_interval_hours: number | null;
  status: EquipmentStatus;
  notes: string | null;
  purchase_line_id: number | null;
  created_at: string;
  hours_used: number;
  hours_this_month: number;
  occupancy_month: number;
  hours_since_maintenance: number;
  last_maintenance_at: string | null;
  maintenance_due: boolean;
  fully_depreciated: boolean;
  printing_code: string | null;
  acquisition_cost: number | null;
  residual_value: number | null;
  accumulated_depreciation: number | null;
  book_value: number | null;
}

export interface CostRateRow {
  id: number;
  rate_type: RateType;
  equipment_id: number | null;
  equipment_name: string | null;
  value: number;
  valid_from: string;
  valid_to: string | null;
  source: 'MANUAL' | 'CALCULATED';
  calc_params: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  is_current: boolean;
  used_by_jobs: number;
}

export interface RateSet {
  energy_h: number;
  depreciation_h: number;
  operational_h: number;
  labor_h: number;
  mode: RateMode;
  rate_ids: number[];
  fully_depreciated: boolean;
}

export interface VariantRow {
  id: number;
  product_id: number;
  product_name: string;
  category: string | null;
  sku: string;
  name: string;
  full_name: string;
  item_id: number;
  is_hidden: boolean;
  active: boolean;
  product_active: boolean;
  active_bom_id: number | null;
  active_bom_version: number | null;
  units_per_plate: number | null;
  est_print_minutes_per_plate: number | null;
  est_post_process_minutes_per_unit: number | null;
  qty_on_hand: number;
  qty_available: number;
  qty_in_finishing: number;
}

export interface BomLineRow {
  id: number;
  bom_version_id: number;
  item_id: number;
  sku: string;
  item_name: string;
  item_kind: string;
  unit: string;
  color_hex: string | null;
  line_kind: 'FILAMENT_MODEL' | 'FILAMENT_SUPPORT' | 'FILAMENT_PURGE' | 'COMPONENT' | 'PACKAGING' | 'CONSUMABLE';
  qty_per_unit: number;
  waste_pct: number;
  consumed_at: 'PRODUCTION' | 'ASSEMBLY' | 'DELIVERY';
  sort_order: number;
}

/** Corpo de preview_print_job / plan_print_job. */
export interface PrintJobInput {
  equipment_id: number;
  planned_for?: string | null;
  est_minutes?: number | null;
  outputs: Array<{ variant_id: number; qty_planned: number; est_weight_g_per_unit?: string | null }>;
  materials?: Array<{ item_id: number; est_g: string; lot_id?: number | null }>;
  sales_order_id?: number | null;
  notes?: string | null;
}

export interface PreviewOutput {
  variant_id: number;
  variant_name: string;
  qty_planned: number;
  bom_version_id: number | null;
  est_weight_g_per_unit: number | null;
  needs_finishing: boolean;
  est_material?: number;
  est_operational?: number;
  est_unit_cost?: number;
}

export interface PreviewMaterial {
  item_id: number;
  item_name: string;
  needed_g: number;
  available_g: number;
  lot_id: number | null;
  lot_code: string | null;
  lot_remaining_g: number | null;
  unit_cost: number | null;
  estimated: boolean;
}

export interface PrintPreview {
  equipment_id: number;
  equipment_name: string;
  est_minutes: number;
  outputs: PreviewOutput[];
  materials: PreviewMaterial[];
  components: Array<{ item_id: number; item_name: string; needed: number; available: number }>;
  warnings: string[];
  shortage: boolean;
  rate_mode: RateMode;
  cost: { material: number; energy: number; depreciation: number; operational: number; total: number } | null;
}

export interface PlanResult {
  print_job_id: number;
  code: string;
  warnings: string[] | null;
  shortage: boolean;
}

export interface CloseResult {
  print_job_id: number;
  code: string;
  minutes: number;
  time_estimated: boolean;
  rate_mode: RateMode;
  cost_total: number;
  cost_scrap: number;
  released: Array<{ output_id: number; qty_released: number; qty_rejected: number; unit_cost: number | null }>;
}

export interface ReleaseResult {
  output_id: number;
  qty_released: number;
  qty_rejected: number;
  unit_cost: number | null;
}

/** Pista ("hint") do erro da RPC, ex.: 'confirmacao_necessaria', 'saldo_insuficiente'. */
export function errorHint(error: unknown): string | null {
  const hint = (error as { hint?: unknown } | null)?.hint;
  return typeof hint === 'string' && hint ? hint : null;
}

// -----------------------------------------------------------------------------
// Leituras
// -----------------------------------------------------------------------------

const ACTIVE: PrintJobStatus[] = ['PLANEJADA', 'IMPRIMINDO'];
export const HISTORY_STATUSES: PrintJobStatus[] = ['CONCLUIDA', 'FALHOU', 'CANCELADA', 'ESTORNADA'];

/** Impressões do quadro: planejadas, imprimindo e terminadas desde `since` (início do dia). */
export function useBoardJobs(since: string) {
  return useAppQuery(
    ['print-jobs', 'board', since],
    async () => {
      const [active, done] = await Promise.all([
        unwrap<PrintJobRow[]>(from('v_print_jobs').select('*').in('status', ACTIVE).order('planned_for', { ascending: true }).order('id')),
        unwrap<PrintJobRow[]>(from('v_print_jobs').select('*').in('status', ['CONCLUIDA', 'FALHOU']).gte('finished_at', since).order('finished_at', { ascending: false })),
      ]);
      return { active, done };
    },
    { refetchInterval: 60_000 },
  );
}

/** Histórico: concluídas, com falha, canceladas e estornadas no período (pela data de término ou de criação). */
export function useJobHistory(range: { from: string; to: string }, equipmentId?: number) {
  return useAppQuery(['print-jobs', 'history', range.from, range.to, equipmentId ?? null], async () => {
    const start = `${range.from}T00:00:00-03:00`;
    const end = `${range.to}T23:59:59-03:00`;
    let query = from('v_print_jobs')
      .select('*')
      .in('status', HISTORY_STATUSES)
      .or(`and(finished_at.gte.${start},finished_at.lte.${end}),and(finished_at.is.null,created_at.gte.${start},created_at.lte.${end})`)
      .order('created_at', { ascending: false });
    if (equipmentId) query = query.eq('equipment_id', equipmentId);
    return unwrap<PrintJobRow[]>(query.limit(1000));
  });
}

/** Impressões de um equipamento (mais recentes primeiro). */
export function useEquipmentJobs(equipmentId: number | undefined) {
  return useAppQuery(
    ['print-jobs', 'equipment', equipmentId],
    () => unwrap<PrintJobRow[]>(from('v_print_jobs').select('*').eq('equipment_id', equipmentId!).order('created_at', { ascending: false }).limit(500)),
    { enabled: Boolean(equipmentId) },
  );
}

export function usePrintJob(id: number | undefined) {
  return useAppQuery(
    ['print-jobs', 'detail', id],
    async () => {
      const rows = await unwrap<PrintJobRow[]>(from('v_print_jobs').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

export function useJobOutputs(jobId: number | undefined) {
  return useAppQuery(
    ['print-jobs', 'outputs', jobId],
    () => unwrap<PrintJobOutputRow[]>(from('v_print_job_outputs').select('*').eq('print_job_id', jobId!).order('sort_order').order('id')),
    { enabled: Boolean(jobId) },
  );
}

export function useJobMaterials(jobId: number | undefined) {
  return useAppQuery(
    ['print-jobs', 'materials', jobId],
    () => unwrap<PrintJobMaterialRow[]>(from('v_print_job_materials').select('*').eq('print_job_id', jobId!).order('id')),
    { enabled: Boolean(jobId) },
  );
}

/** Fila de acabamento (US-5.6): saídas com peças boas aguardando acabamento. */
export function useFinishingQueue() {
  return useAppQuery(
    ['print-jobs', 'finishing'],
    () => unwrap<PrintJobOutputRow[]>(from('v_print_job_outputs').select('*').eq('status', 'AGUARDANDO_ACABAMENTO').order('finished_at').order('id')),
    { refetchInterval: 60_000 },
  );
}

export function useOutput(outputId: number | undefined) {
  return useAppQuery(
    ['print-jobs', 'output', outputId],
    async () => {
      const rows = await unwrap<PrintJobOutputRow[]>(from('v_print_job_outputs').select('*').eq('id', outputId!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(outputId) },
  );
}

export function usePostProcessEntries(outputIds: number[]) {
  const key = [...outputIds].sort((a, b) => a - b);
  return useAppQuery(
    ['print-jobs', 'post-process', key.join(',')],
    () => unwrap<PostProcessEntryRow[]>(from('v_post_process_entries').select('*').in('output_id', key).order('performed_at')),
    { enabled: key.length > 0 },
  );
}

export function useEquipmentList() {
  return useAppQuery(['equipment', 'list'], () => unwrap<EquipmentRow[]>(from('v_equipment').select('*').order('name')));
}

export function useEquipment(id: number | undefined) {
  return useAppQuery(
    ['equipment', 'detail', id],
    async () => {
      const rows = await unwrap<EquipmentRow[]>(from('v_equipment').select('*').eq('id', id!));
      return rows[0] ?? null;
    },
    { enabled: Boolean(id) },
  );
}

/** Taxas vigentes na data (get_rates): a do equipamento vale antes da global. */
export function useRates(equipmentId: number | null | undefined, on: string, enabled = true) {
  return useAppQuery(['rates', 'set', equipmentId ?? null, on], () => rpc<RateSet>('get_rates', { p_equipment_id: equipmentId ?? null, p_on: on }), {
    enabled: enabled && equipmentId !== undefined,
  });
}

export function useCostRates(enabled = true) {
  return useAppQuery(['rates', 'list'], () => unwrap<CostRateRow[]>(from('v_cost_rates').select('*').order('valid_from', { ascending: false }).order('id', { ascending: false })), {
    enabled,
  });
}

/**
 * Variações que podem ir para a mesa: ativas, de produtos ativos. Inclui as ocultas (itens pontuais
 * de encomenda) para planejar a partir do pedido; os seletores manuais escondem as ocultas.
 */
export function usePlannableVariants() {
  return useAppQuery(['production', 'variants'], async () => {
    const rows = await unwrap<VariantRow[]>(from('v_product_variants').select('*').eq('active', true).order('product_name').order('name'));
    return rows.filter((v) => v.product_active !== false);
  });
}

export function useBomLines(bomIds: number[]) {
  const key = [...new Set(bomIds)].sort((a, b) => a - b);
  return useAppQuery(['production', 'bom-lines', key.join(',')], () => unwrap<BomLineRow[]>(from('v_bom_lines').select('*').in('bom_version_id', key).order('sort_order')), {
    enabled: key.length > 0,
  });
}

/** Prévia do planejamento (não grava). `null` desliga a consulta. */
export function usePrintPreview(job: PrintJobInput | null) {
  return useAppQuery(['print-preview', job], () => rpc<PrintPreview>('preview_print_job', { p_job: job }), {
    enabled: job !== null,
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: 15_000,
  });
}

// -----------------------------------------------------------------------------
// Escritas (RPCs)
// -----------------------------------------------------------------------------

export function usePlanPrintJob() {
  return useWrite<{ requestId: string; job: PrintJobInput }, PlanResult>({
    mutationFn: (v) => rpc<PlanResult>('plan_print_job', { p_request_id: v.requestId, p_job: v.job }),
    success: (r) => `Impressão ${r.code} planejada.`,
  });
}

export function useStartPrintJob() {
  return useWrite<{ requestId: string; jobId: number; startedAt?: string | null; confirmShortage?: boolean }, { print_job_id: number; expected_end: string }>({
    mutationFn: (v) =>
      rpc('start_print_job', { p_request_id: v.requestId, p_print_job_id: v.jobId, p_started_at: v.startedAt ?? null, p_confirm_shortage: v.confirmShortage ?? false }),
    success: 'Impressão iniciada.',
    toastError: false,
  });
}

export interface FinishInput {
  finished_at?: string | null;
  actual_minutes: number | null;
  materials: Array<{ item_id: number; actual_g: string; lot_id?: number | null; per_output?: Record<string, string> }>;
  outputs: Array<{ output_id: number; qty_good: number; qty_failed: number; failure_reason: FailureReason | null }>;
  notes?: string | null;
}

export function useFinishPrintJob() {
  return useWrite<{ requestId: string; jobId: number; result: FinishInput }, CloseResult>({
    mutationFn: (v) => rpc<CloseResult>('finish_print_job', { p_request_id: v.requestId, p_print_job_id: v.jobId, p_result: v.result }),
    success: (r) => `Impressão ${r.code} finalizada.`,
    toastError: false,
  });
}

export interface FailInput {
  finished_at?: string | null;
  actual_minutes: number | null;
  materials: Array<{ item_id: number; actual_g: string; lot_id?: number | null }>;
  failure_reason: FailureReason;
  notes?: string | null;
}

export function useFailPrintJob() {
  return useWrite<{ requestId: string; jobId: number; result: FailInput }, CloseResult>({
    mutationFn: (v) => rpc<CloseResult>('fail_print_job', { p_request_id: v.requestId, p_print_job_id: v.jobId, p_result: v.result }),
    success: (r) => `Falha da impressão ${r.code} registrada.`,
    toastError: false,
  });
}

export function useReplanPrintJob(onDone?: (result: PlanResult) => void) {
  return useWrite<{ requestId: string; jobId: number }, PlanResult>({
    mutationFn: (v) => rpc<PlanResult>('replan_print_job', { p_request_id: v.requestId, p_print_job_id: v.jobId }),
    success: (r) => `Nova impressão ${r.code} planejada com as mesmas peças.`,
    onSuccess: (r) => onDone?.(r),
  });
}

export function useCancelPrintJob(onDone?: () => void) {
  return useWrite<{ requestId: string; jobId: number; reason?: string | null }>({
    mutationFn: (v) => rpc('cancel_print_job', { p_request_id: v.requestId, p_print_job_id: v.jobId, p_reason: v.reason ?? null }),
    success: 'Impressão cancelada.',
    onSuccess: () => onDone?.(),
  });
}

export function useReversePrintJob(onDone?: () => void) {
  return useWrite<{ requestId: string; jobId: number; reason: string }, { reversed_movements: number }>({
    mutationFn: (v) => rpc('reverse_print_job', { p_request_id: v.requestId, p_print_job_id: v.jobId, p_reason: v.reason }),
    success: 'Impressão estornada: material, peças e custos voltaram ao que eram.',
    onSuccess: () => onDone?.(),
  });
}

export function useRecordPostProcess() {
  return useWrite<
    { requestId: string; outputId: number; minutes: number; kind: PostProcessKind; performedAt?: string | null; notes?: string | null },
    { entry_id: number; labor_valued: boolean }
  >({
    mutationFn: (v) =>
      rpc('record_post_process', {
        p_request_id: v.requestId,
        p_output_id: v.outputId,
        p_minutes: v.minutes,
        p_kind: v.kind,
        p_performed_at: v.performedAt ?? null,
        p_notes: v.notes ?? null,
      }),
    success: 'Acabamento registrado.',
  });
}

export function useReleaseOutput() {
  return useWrite<{ requestId: string; outputId: number; qtyApproved: number; rejectReason?: string | null; rejectedAssembled?: boolean }, ReleaseResult>({
    mutationFn: (v) =>
      rpc<ReleaseResult>('release_output', {
        p_request_id: v.requestId,
        p_output_id: v.outputId,
        p_qty_approved: v.qtyApproved,
        p_reject_reason: v.rejectReason ?? null,
        p_rejected_assembled: v.rejectedAssembled ?? false,
      }),
    success: (r) => (r.qty_released > 0 ? `${r.qty_released} peça(s) liberada(s) para o estoque.` : 'Saída encerrada sem peças aprovadas.'),
  });
}

export interface EquipmentInput {
  id?: number;
  name: string;
  kind: EquipmentKind;
  brand?: string | null;
  model?: string | null;
  serial?: string | null;
  acquired_at?: string | null;
  acquisition_cost?: string | null;
  residual_value?: string | null;
  useful_life_hours?: string | null;
  avg_power_w?: string | null;
  initial_hours?: string | null;
  maintenance_interval_hours?: string | null;
  status?: EquipmentStatus;
  notes?: string | null;
}

export function useSaveEquipment(onSaved?: (id: number) => void) {
  return useWrite<EquipmentInput, number>({
    mutationFn: (equipment) => rpc<number>('save_equipment', { p_equipment: equipment }),
    success: (_id, e) => (e.id ? 'Equipamento atualizado.' : 'Equipamento cadastrado.'),
    onSuccess: (id) => onSaved?.(id),
  });
}

export interface RateInput {
  rateType: RateType;
  value: string;
  validFrom: string;
  equipmentId?: number | null;
  source?: 'MANUAL' | 'CALCULATED';
  calcParams?: Record<string, unknown>;
  notes?: string | null;
}

export function useCreateCostRate(onDone?: (id: number) => void) {
  return useWrite<RateInput, number>({
    mutationFn: (v) =>
      rpc<number>('create_cost_rate', {
        p_rate_type: v.rateType,
        p_value: v.value,
        p_valid_from: v.validFrom,
        p_equipment_id: v.equipmentId ?? null,
        p_source: v.source ?? 'MANUAL',
        p_calc_params: v.calcParams ?? {},
        p_notes: v.notes ?? null,
      }),
    success: 'Nova vigência registrada. A anterior foi encerrada no dia anterior.',
    onSuccess: (id) => onDone?.(id),
    toastError: false,
  });
}

export function useSplitOperationalRate(onDone?: () => void) {
  return useWrite<{ validFrom: string; energyH: string; depreciationH: string; equipmentId?: number | null }>({
    mutationFn: (v) =>
      rpc('split_operational_rate', { p_valid_from: v.validFrom, p_energy_h: v.energyH, p_depreciation_h: v.depreciationH, p_equipment_id: v.equipmentId ?? null }),
    success: 'Taxa combinada dividida em energia + depreciação.',
    onSuccess: () => onDone?.(),
    toastError: false,
  });
}
