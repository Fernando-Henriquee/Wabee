import type { Tone } from '@/components/ui/badge';
import type { AuditAction, AuditRow } from '@/data/audit';
import { formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { formatNumber } from '@/lib/money';

/** Textos e formatação da auditoria (US-0.5). Funções puras, testadas em audit-format.test.ts. */

export const ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Criação',
  UPDATE: 'Alteração',
  DELETE: 'Exclusão',
  CANCEL: 'Cancelamento',
  REVERSE: 'Estorno',
  CLOSE_MONTH: 'Fechamento de mês',
  REOPEN_MONTH: 'Reabertura de mês',
  LOGIN: 'Entrada no sistema',
};

export const ACTION_TONES: Record<AuditAction, Tone> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  CANCEL: 'danger',
  REVERSE: 'warning',
  CLOSE_MONTH: 'accent',
  REOPEN_MONTH: 'warning',
  LOGIN: 'neutral',
};

/** Nome amigável de cada entidade auditada (model_label no banco). */
export const MODEL_LABELS: Record<string, string> = {
  app_member: 'Pessoa com acesso',
  auth: 'Acesso ao sistema',
  bom_version: 'Ficha técnica',
  channel_price: 'Preço por canal',
  cost_rate: 'Taxa de custo',
  customer: 'Cliente',
  equipment: 'Equipamento',
  financial_category: 'Categoria financeira',
  installment: 'Parcela',
  item: 'Item de estoque',
  month_close: 'Fechamento do mês',
  owner_movement: 'Movimento do dono',
  payable: 'Despesa / conta a pagar',
  payment_account: 'Conta ou cartão',
  print_job: 'Impressão',
  print_job_output: 'Saída de impressão',
  product: 'Produto',
  product_variant: 'Variação de produto',
  purchase: 'Compra',
  receipt: 'Recebimento de compra',
  sales_channel: 'Canal de venda',
  sales_channel_fee: 'Taxas do canal',
  sales_order: 'Pedido de venda',
  settings: 'Configurações',
  stock_adjustment: 'Ajuste de estoque',
  stock_issue: 'Saída avulsa de estoque',
  stock_lot: 'Carretel',
  stock_movement: 'Movimentação de estoque',
  stock_opening: 'Saldo inicial de estoque',
  supplier: 'Fornecedor',
  transfer: 'Transferência entre contas',
};

export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model.replace(/_/g, ' ');
}

/** Nome amigável dos campos mais comuns nos registros de antes/depois. */
const FIELD_LABELS: Record<string, string> = {
  absorb_scrap_cost: 'Peças boas absorvem o custo das falhas',
  acquired_at: 'Data de aquisição',
  acquisition_cost: 'Valor de aquisição',
  active: 'Ativo',
  allow_negative_stock: 'Permitir estoque negativo',
  avg_power_w: 'Potência média (W)',
  brand: 'Marca',
  card_closing_day: 'Dia de fechamento do cartão',
  card_due_day: 'Dia de vencimento do cartão',
  category: 'Categoria',
  channel_id: 'Canal',
  code: 'Código',
  color_hex: 'Cor (hex)',
  color_name: 'Cor',
  company_name: 'Nome da empresa',
  coverage_alert_days: 'Alerta de cobertura (dias)',
  created_at: 'Criado em',
  created_by: 'Criado por',
  default_channel_id: 'Canal padrão',
  default_order_packaging_item_id: 'Embalagem padrão do pedido',
  default_owner_funding_type: 'Dinheiro do dono (padrão)',
  default_supplier_id: 'Fornecedor padrão',
  description: 'Descrição',
  document: 'Documento',
  email: 'E-mail',
  equipment_id: 'Equipamento',
  fee_fixed: 'Taxa fixa',
  fee_fixed_per: 'Taxa fixa cobrada',
  fee_pct: 'Taxa do canal',
  filament_reference_cost_g: 'Custo de referência do filamento (R$/g)',
  go_live_date: 'Início do uso do sistema',
  id: 'Código interno',
  initial_hours: 'Horas iniciais',
  instagram: 'Instagram',
  item_id: 'Item',
  kind: 'Tipo',
  location: 'Local',
  maintenance_interval_hours: 'Intervalo de manutenção (h)',
  margin_target_pct: 'Margem alvo',
  material: 'Material',
  mei_monthly_das: 'DAS mensal (MEI)',
  min_qty: 'Estoque mínimo',
  model: 'Modelo',
  name: 'Nome',
  nature: 'Natureza',
  notes: 'Observações',
  onboarding_state: 'Assistente inicial',
  opening_balance: 'Saldo inicial',
  opening_date: 'Data do saldo inicial',
  owner: 'Titular',
  parent_id: 'Categoria principal',
  payment_fee_pct: 'Taxa de pagamento',
  payout_days: 'Dias para receber',
  phone: 'Telefone',
  price: 'Preço',
  product_id: 'Produto',
  purchase_line_id: 'Linha da compra',
  purchase_id: 'Compra',
  supplier_id: 'Fornecedor',
  customer_id: 'Cliente',
  account_id: 'Conta',
  payment_account_id: 'Conta de pagamento',
  bom_version_id: 'Ficha técnica',
  is_custom: 'Personalizado',
  is_hidden: 'Oculto',
  is_sellable: 'Vendido avulso',
  is_stock_tracked: 'Controla saldo',
  license_notes: 'Licença',
  license_allows_commercial: 'Licença permite venda',
  model_source: 'Origem do modelo',
  photo_path: 'Foto',
  diameter_mm: 'Diâmetro (mm)',
  density_g_cm3: 'Densidade (g/cm³)',
  nominal_spool_g: 'Carretel nominal (g)',
  empty_spool_tare_g: 'Peso do carretel vazio (g)',
  needs_drying: 'Precisa secar',
  tool_condition: 'Condição',
  calc_params: 'Parâmetros do cálculo',
  disposed_at: 'Baixado em',
  disposal_value: 'Valor da baixa',
  in_income_statement: 'Entra no resultado',
  is_system: 'Do sistema',
  anonymized_at: 'Anonimizado em',
  rate_type: 'Tipo de taxa',
  reference_price: 'Preço de referência',
  reorder_qty: 'Recompra sugerida',
  residual_value: 'Valor residual',
  sales_tax_pct: 'Imposto sobre vendas',
  serial: 'Número de série',
  sku: 'SKU',
  slug: 'Identificador',
  source: 'Origem',
  status: 'Situação',
  tax_regime: 'Regime tributário',
  timezone: 'Fuso horário',
  unit: 'Unidade',
  url: 'Site',
  useful_life_hours: 'Vida útil (h)',
  valid_from: 'Vigente desde',
  valid_to: 'Vigente até',
  value: 'Valor',
  variant_id: 'Variação',
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
}

export type ChangeShape =
  | { kind: 'empty' }
  | { kind: 'diff'; rows: Array<{ field: string; before: unknown; after: unknown }> }
  | { kind: 'snapshot'; rows: Array<{ field: string; value: unknown }> }
  | { kind: 'json'; value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Campos internos que não ajudam a entender a mudança. */
const HIDDEN_FIELDS = new Set(['updated_at']);

/**
 * Reconhece o formato de `changes`:
 *  - alteração de cadastro: { campo: { antes, depois } } → tabela antes/depois;
 *  - criação de cadastro: { depois: { ...registro } } → tabela campo/valor;
 *  - demais operações (RPCs): JSON livre → exibido formatado.
 */
export function describeChanges(changes: unknown): ChangeShape {
  if (changes === null || changes === undefined) return { kind: 'empty' };
  if (!isRecord(changes)) return { kind: 'json', value: changes };
  const keys = Object.keys(changes);
  if (keys.length === 0) return { kind: 'empty' };
  if (keys.length === 1 && keys[0] === 'depois' && isRecord(changes.depois)) {
    return {
      kind: 'snapshot',
      rows: Object.entries(changes.depois)
        .filter(([field, value]) => !HIDDEN_FIELDS.has(field) && value !== null && value !== '')
        .map(([field, value]) => ({ field, value })),
    };
  }
  const isDiff = keys.every((key) => isRecord(changes[key]) && ('antes' in (changes[key] as object) || 'depois' in (changes[key] as object)));
  if (isDiff) {
    return {
      kind: 'diff',
      rows: keys
        .filter((field) => !HIDDEN_FIELDS.has(field))
        .map((field) => {
          const entry = changes[field] as { antes?: unknown; depois?: unknown };
          return { field, before: entry.antes ?? null, after: entry.depois ?? null };
        }),
    };
  }
  return { kind: 'json', value: changes };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const PERCENT_FIELDS = /(_pct|_percent)$/;

/** Valor legível de um campo auditado. */
export function formatAuditValue(value: unknown, field?: string, timeZone?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') {
    if (field && PERCENT_FIELDS.test(field)) return `${formatNumber(value * 100, 2)}%`;
    return formatNumber(value, 6);
  }
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) return formatDateBR(value);
    if (ISO_TIMESTAMP.test(value)) return formatDateTimeBR(value, timeZone);
    return value;
  }
  return JSON.stringify(value);
}

/** Resumo exibido na lista: o da operação, ou um gerado a partir dos campos alterados. */
export function auditSummary(row: Pick<AuditRow, 'summary' | 'action' | 'model_label' | 'object_ref' | 'changes'>): string {
  if (row.summary) return row.summary;
  const shape = describeChanges(row.changes);
  const ref = row.object_ref ? ` “${row.object_ref}”` : '';
  if (row.action === 'CREATE') return `Novo cadastro: ${modelLabel(row.model_label)}${ref}`;
  if (shape.kind === 'diff' && shape.rows.length > 0) {
    const fields = shape.rows.map((r) => fieldLabel(r.field).toLowerCase());
    const shown = fields.slice(0, 3).join(', ');
    return `Alterou ${shown}${fields.length > 3 ? ` e mais ${fields.length - 3}` : ''}${ref ? ` em${ref}` : ''}`;
  }
  return `${ACTION_LABELS[row.action] ?? row.action}${ref}`;
}

/** Endereço da tela do objeto auditado, quando existe. */
export function auditObjectHref(row: Pick<AuditRow, 'model_label' | 'object_id'>): string | null {
  const id = row.object_id;
  switch (row.model_label) {
    case 'item':
    case 'stock_opening':
    case 'stock_issue':
    case 'stock_adjustment':
      return id ? `/estoque/itens/${id}` : null;
    case 'product':
      return id ? `/produtos/${id}` : null;
    case 'purchase':
      return id ? `/compras/${id}` : null;
    case 'supplier':
      return id ? `/fornecedores/${id}` : null;
    case 'print_job':
      return id ? `/producao/impressoes/${id}` : null;
    case 'equipment':
      return id ? `/producao/equipamentos/${id}` : null;
    case 'sales_order':
      return id ? `/vendas/${id}` : null;
    case 'customer':
      return id ? `/clientes/${id}` : null;
    case 'cost_rate':
      return '/producao/taxas';
    case 'sales_channel':
    case 'sales_channel_fee':
      return '/configuracoes/canais';
    case 'settings':
      return '/configuracoes/empresa';
    case 'app_member':
      return '/configuracoes/pessoas';
    case 'payment_account':
      return '/financeiro/contas';
    case 'financial_category':
      return '/financeiro/categorias';
    default:
      return null;
  }
}
