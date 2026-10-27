import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import type { AppSettings, OnboardingState, Role } from '@/features/member/member-context';
import { from, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';

/**
 * Configurações da empresa (US-0.4), canais e taxas (US-6.2), pessoas com acesso,
 * integridade dos dados e assistente inicial (US-0.11). Toda escrita passa por RPC.
 */

export interface Profile {
  id: string;
  display_name: string;
}

export function useMyProfile() {
  const { user } = useAuth();
  return useAppQuery(['profile', user?.id], async () => {
    const rows = await unwrap<Profile[]>(from('profiles').select('id,display_name').eq('id', user!.id));
    return rows[0] ?? null;
  }, { enabled: Boolean(user) });
}

export function useSaveDisplayName() {
  const queryClient = useQueryClient();
  return useWrite<{ displayName: string }>({
    mutationFn: ({ displayName }) => rpc('update_my_profile', { p_display_name: displayName }),
    success: 'Nome atualizado.',
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['w', 'profile'] }),
  });
}

// -----------------------------------------------------------------------------
// Empresa e regras (US-0.4)
// -----------------------------------------------------------------------------

export type TaxRegime = AppSettings['tax_regime'];
export type FundingType = AppSettings['default_owner_funding_type'];

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  CPF_SEM_CNPJ: 'Pessoa física (sem CNPJ)',
  MEI: 'MEI',
  SIMPLES: 'Simples Nacional',
};

export const FUNDING_TYPE_LABELS: Record<FundingType, string> = {
  CAPITAL_CONTRIBUTION: 'Aporte de capital',
  OWNER_LOAN: 'Empréstimo do dono',
};

/** Fusos horários do Brasil (IANA). */
export const BRAZIL_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'America/Sao_Paulo', label: 'Brasília (SP, RJ, MG, Sul, GO, DF, BA…)' },
  { value: 'America/Manaus', label: 'Amazonas (Manaus)' },
  { value: 'America/Cuiaba', label: 'Mato Grosso (Cuiabá)' },
  { value: 'America/Campo_Grande', label: 'Mato Grosso do Sul (Campo Grande)' },
  { value: 'America/Porto_Velho', label: 'Rondônia (Porto Velho)' },
  { value: 'America/Boa_Vista', label: 'Roraima (Boa Vista)' },
  { value: 'America/Rio_Branco', label: 'Acre (Rio Branco)' },
  { value: 'America/Belem', label: 'Pará — leste (Belém)' },
  { value: 'America/Santarem', label: 'Pará — oeste (Santarém)' },
  { value: 'America/Fortaleza', label: 'Nordeste (Fortaleza, Natal, São Luís…)' },
  { value: 'America/Recife', label: 'Pernambuco (Recife)' },
  { value: 'America/Maceio', label: 'Alagoas e Sergipe (Maceió)' },
  { value: 'America/Bahia', label: 'Bahia (Salvador)' },
  { value: 'America/Araguaina', label: 'Tocantins (Araguaína)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha' },
];

/** Campos aceitos por save_settings. Decimais como texto canônico ("0.3"). */
export interface SettingsInput {
  company_name?: string;
  timezone?: string;
  allow_negative_stock?: boolean;
  absorb_scrap_cost?: boolean;
  default_owner_funding_type?: FundingType;
  default_channel_id?: number | null;
  margin_target_pct?: string;
  tax_regime?: TaxRegime;
  sales_tax_pct?: string;
  mei_monthly_das?: string;
  coverage_alert_days?: number;
  go_live_date?: string | null;
  filament_reference_cost_g?: string;
  default_order_packaging_item_id?: number | null;
}

export type SettingsRow = AppSettings & { updated_at: string };

/** Configurações atuais lidas do banco (o contexto do membro também as tem, mas esta leitura é sempre a mais recente). */
export function useCompanySettings() {
  return useAppQuery(['settings'], async () => {
    const rows = await unwrap<SettingsRow[]>(from('settings').select('*'));
    return rows[0] ?? null;
  });
}

export function useSaveSettings(options: { success?: string | null; onSuccess?: () => void } = {}) {
  return useWrite<SettingsInput | Record<string, unknown>>({
    mutationFn: (settings) => rpc('save_settings', { p_settings: settings }),
    success: options.success === null ? undefined : (options.success ?? 'Configurações salvas. Valem para as próximas operações.'),
    onSuccess: () => options.onSuccess?.(),
  });
}

export function useSaveOnboardingState(onSaved?: (state: OnboardingState) => void) {
  return useWrite<OnboardingState | Record<string, unknown>, OnboardingState>({
    mutationFn: (state) => rpc<OnboardingState>('save_onboarding_state', { p_state: state }),
    onSuccess: (state) => onSaved?.(state),
  });
}

/** Frase que o dono digita para confirmar o reset (conferida também no banco). */
export const RESET_CONFIRM_PHRASE = 'APAGAR TUDO';

/** Reset do sistema: apaga a operação, os produtos e os itens; mantém configurações e cadastros base. */
export function useResetSystem(onDone?: () => void) {
  return useWrite<void>({
    mutationFn: () => rpc('reset_system', { p_confirm: RESET_CONFIRM_PHRASE }),
    success: 'Sistema resetado. Comece pelo assistente inicial.',
    onSuccess: () => onDone?.(),
  });
}

// -----------------------------------------------------------------------------
// Canais de venda e taxas (US-6.2)
// -----------------------------------------------------------------------------

export type ChannelKind = 'DIRETO' | 'REDE_SOCIAL' | 'MARKETPLACE' | 'FEIRA';
export type FeeFixedPer = 'PEDIDO' | 'UNIDADE';

export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  DIRETO: 'Venda direta',
  REDE_SOCIAL: 'Rede social / WhatsApp',
  MARKETPLACE: 'Marketplace',
  FEIRA: 'Feira / evento',
};

export const FEE_FIXED_PER_LABELS: Record<FeeFixedPer, string> = { PEDIDO: 'por pedido', UNIDADE: 'por unidade' };

export interface SalesChannel {
  id: number;
  name: string;
  kind: ChannelKind;
  payout_days: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelFee {
  id: number;
  channel_id: number;
  fee_pct: number;
  fee_fixed: number;
  fee_fixed_per: FeeFixedPer;
  payment_fee_pct: number;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
}

export interface ChannelWithFees extends SalesChannel {
  /** Tabelas de taxas, da mais recente para a mais antiga. */
  fees: ChannelFee[];
  /** Tabela vigente hoje. */
  current: ChannelFee | null;
  /** Tabela que começa depois de hoje (já agendada), se houver. */
  scheduled: ChannelFee | null;
}

/** Canais (inclusive inativos) com o histórico de taxas. */
export function useSalesChannelsWithFees(today: string) {
  return useAppQuery(['sales-channels', 'admin', today], async () => {
    const [channels, fees] = await Promise.all([
      unwrap<SalesChannel[]>(from('sales_channels').select('*').order('name')),
      unwrap<ChannelFee[]>(from('sales_channel_fees').select('*').order('valid_from', { ascending: false })),
    ]);
    return channels.map<ChannelWithFees>((channel) => {
      const own = fees.filter((fee) => fee.channel_id === channel.id);
      const current = own.find((fee) => fee.valid_from <= today && (fee.valid_to === null || fee.valid_to >= today)) ?? null;
      const scheduled = own.filter((fee) => fee.valid_from > today).at(-1) ?? null;
      return { ...channel, fees: own, current, scheduled };
    });
  });
}

/** Canais para seleção (todos os perfis podem ler a lista). */
export function useSalesChannelOptions() {
  return useAppQuery(['sales-channels', 'options'], () => unwrap<SalesChannel[]>(from('sales_channels').select('*').order('name')));
}

export interface ChannelInput {
  id?: number;
  name: string;
  kind: ChannelKind;
  payout_days: number;
  active: boolean;
  notes: string | null;
  fee_pct: string;
  fee_fixed: string;
  fee_fixed_per: FeeFixedPer;
  payment_fee_pct: string;
  /** Quando alguma taxa muda: início da nova tabela (a anterior termina no dia anterior). */
  fees_valid_from?: string;
}

export function useSaveSalesChannel(onSaved?: (id: number) => void) {
  return useWrite<ChannelInput, number>({
    mutationFn: (channel) => rpc<number>('save_sales_channel', { p_channel: channel }),
    success: (_id, channel) => (channel.id ? 'Canal atualizado.' : 'Canal cadastrado.'),
    onSuccess: (id) => onSaved?.(id),
    toastError: false,
  });
}

// -----------------------------------------------------------------------------
// Pessoas com acesso
// -----------------------------------------------------------------------------

export interface MemberRow {
  user_id: string;
  role: Role;
  active: boolean;
  created_at: string;
  display_name: string | null;
  email: string | null;
}

export function useMembers() {
  return useAppQuery(['members'], () => unwrap<MemberRow[]>(from('v_members').select('*').order('created_at')));
}

export function useSetMemberRole(onDone?: () => void) {
  return useWrite<{ userId: string; role: Role; active: boolean }>({
    mutationFn: (v) => rpc('set_member_role', { p_user_id: v.userId, p_role: v.role, p_active: v.active }),
    success: (_r, v) => (v.active ? 'Acesso atualizado.' : 'Acesso desativado: a pessoa não entra mais no sistema.'),
    onSuccess: () => onDone?.(),
    toastError: false,
  });
}

// -----------------------------------------------------------------------------
// Integridade dos dados (razão de estoque e reservas)
// -----------------------------------------------------------------------------

export interface StockIntegrity {
  ok: boolean;
  ledger: Array<{ item_id: number; sku: string; problem: string; cached: string | null; ledger: string | null }>;
  reservations: Array<{ item_id: number; cached: number; reservations: number }>;
}

export function useStockIntegrity(enabled: boolean) {
  return useAppQuery(['stock-integrity'], () => rpc<StockIntegrity>('check_stock_integrity'), { enabled, staleTime: 60_000 });
}

// -----------------------------------------------------------------------------
// Assistente inicial (US-0.11)
// -----------------------------------------------------------------------------

export type AccountKind = 'BANCO' | 'DINHEIRO' | 'CARTAO_CREDITO' | 'CARTEIRA';
export type AccountOwner = 'EMPRESA' | 'DONO';

export interface OnboardingAccount {
  id: number;
  name: string;
  kind: AccountKind;
  owner: AccountOwner;
  card_closing_day: number | null;
  card_due_day: number | null;
  active: boolean;
}

export interface OnboardingEquipment {
  id: number;
  name: string;
  kind: string;
  status: string;
  purchase_line_id: number | null;
}

export interface OnboardingRate {
  id: number;
  rate_type: string;
  equipment_id: number | null;
  value: number;
  valid_from: string;
  valid_to: string | null;
}

export interface OnboardingPurchase {
  id: number;
  number: string;
  purchased_at: string;
  status: string;
  cash_price_total: number;
  installments_total: number | null;
  installments_count: number;
  payer: AccountOwner;
}

export interface OnboardingSnapshot {
  accounts: OnboardingAccount[];
  printers: OnboardingEquipment[];
  rates: OnboardingRate[];
  /** Itens ativos por tipo (FILAMENT, COMPONENT…). */
  itemCounts: Record<string, number>;
  /** Itens ativos com saldo maior que zero, por tipo. */
  itemsWithStock: Record<string, number>;
  products: number;
  variants: number;
  variantsWithBom: number;
  openingPurchases: OnboardingPurchase[];
  openingMovements: number;
}

async function countRows(request: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await request;
  if (error) throw error;
  return count ?? 0;
}

/** O que já existe no banco: usado para marcar como feitos os passos do assistente. */
export function useOnboardingSnapshot(enabled = true) {
  return useAppQuery(
    ['onboarding-snapshot'],
    async (): Promise<OnboardingSnapshot> => {
      const [accounts, equipment, rates, items, products, variants, purchases, openingMovements] = await Promise.all([
        unwrap<OnboardingAccount[]>(from('payment_accounts').select('id,name,kind,owner,card_closing_day,card_due_day,active').order('name')),
        unwrap<OnboardingEquipment[]>(from('equipment').select('id,name,kind,status,purchase_line_id').order('name')),
        unwrap<OnboardingRate[]>(from('cost_rates').select('id,rate_type,equipment_id,value,valid_from,valid_to').order('valid_from', { ascending: false })),
        unwrap<Array<{ kind: string; qty_on_hand: number | null }>>(from('v_items').select('kind,qty_on_hand').eq('active', true)),
        countRows(from('products').select('id', { count: 'exact', head: true })),
        unwrap<Array<{ id: number; active_bom_id: number | null }>>(from('v_product_variants').select('id,active_bom_id').eq('is_hidden', false)),
        unwrap<OnboardingPurchase[]>(
          from('purchases')
            .select('id,number,purchased_at,status,cash_price_total,installments_total,installments_count,payer')
            .eq('is_opening', true)
            .neq('status', 'CANCELADA')
            .order('purchased_at'),
        ),
        countRows(from('stock_movements').select('id', { count: 'exact', head: true }).eq('type', 'OPENING')),
      ]);
      const itemCounts: Record<string, number> = {};
      const itemsWithStock: Record<string, number> = {};
      for (const item of items) {
        itemCounts[item.kind] = (itemCounts[item.kind] ?? 0) + 1;
        if (Number(item.qty_on_hand ?? 0) > 0) itemsWithStock[item.kind] = (itemsWithStock[item.kind] ?? 0) + 1;
      }
      return {
        accounts: accounts.filter((a) => a.active),
        printers: equipment.filter((e) => e.kind === 'PRINTER' && e.status !== 'BAIXADO'),
        rates,
        itemCounts,
        itemsWithStock,
        products,
        variants: variants.length,
        variantsWithBom: variants.filter((v) => v.active_bom_id !== null).length,
        openingPurchases: purchases,
        openingMovements,
      };
    },
    { enabled },
  );
}

export interface AccountInput {
  name: string;
  kind: AccountKind;
  owner: AccountOwner;
  opening_balance?: string | null;
  opening_date?: string | null;
  card_closing_day?: number | null;
  card_due_day?: number | null;
}

export function useCreatePaymentAccount(onSaved?: (id: number) => void) {
  return useWrite<AccountInput, number>({
    mutationFn: (account) => rpc<number>('save_payment_account', { p_account: account }),
    success: (_id, account) => `“${account.name}” cadastrada.`,
    onSuccess: (id) => onSaved?.(id),
    toastError: false,
  });
}

export interface PrinterInput {
  name: string;
  brand: string | null;
  model: string | null;
  avg_power_w: string | null;
}

/** Passo "Impressora" do assistente (save_equipment, tipo PRINTER). */
export function useSavePrinter(onDone?: (id: number) => void) {
  return useWrite<PrinterInput, number>({
    mutationFn: (printer) => rpc<number>('save_equipment', { p_equipment: { ...printer, kind: 'PRINTER' } }),
    success: (_id, printer) => `“${printer.name}” cadastrada.`,
    onSuccess: (id) => onDone?.(id),
    toastError: false,
  });
}

/** Passo "Taxa operacional": taxa combinada por hora (energia + depreciação), global, com vigência. */
export function useCreateOperationalRate(onDone?: (id: number) => void) {
  return useWrite<{ value: string; validFrom: string }, number>({
    mutationFn: ({ value, validFrom }) =>
      rpc<number>('create_cost_rate', {
        p_rate_type: 'OPERATIONAL_PER_HOUR',
        p_value: value,
        p_valid_from: validFrom,
        p_equipment_id: null,
        p_source: 'MANUAL',
        p_calc_params: {},
        p_notes: 'Taxa combinada (energia + depreciação) informada no assistente inicial',
      }),
    success: 'Taxa por hora registrada.',
    onSuccess: (id) => onDone?.(id),
    toastError: false,
  });
}
