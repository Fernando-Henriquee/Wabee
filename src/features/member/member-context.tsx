import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { unwrap } from '@/data/api';
import type { CompanySummary } from '@/data/company';
import { todayIn } from '@/lib/dates';
import type { PixKeyType } from '@/lib/pix';
import { supabase } from '@/lib/supabase';

export type Role = 'dono' | 'membro';

/**
 * O que cada perfil pode fazer na interface. Todo membro da empresa tem acesso a tudo; só o dono
 * gerencia pessoas (convites, remoção, perfis). A proteção real está no banco: a RLS limita tudo
 * à empresa ativa e as RPCs de gestão conferem o dono.
 */
export type Capability = 'write' | 'production' | 'costs' | 'settings' | 'audit' | 'members';

const BASE_CAPABILITIES: Capability[] = ['write', 'production', 'costs', 'settings', 'audit'];

const CAPABILITIES: Record<Role, Capability[]> = {
  dono: [...BASE_CAPABILITIES, 'members'],
  membro: BASE_CAPABILITIES,
};

export const ROLE_LABELS: Record<Role, string> = { dono: 'Dono', membro: 'Membro' };

export interface AppSettings {
  company_name: string;
  timezone: string;
  allow_negative_stock: boolean;
  absorb_scrap_cost: boolean;
  default_owner_funding_type: 'CAPITAL_CONTRIBUTION' | 'OWNER_LOAN';
  default_channel_id: number | null;
  margin_target_pct: number;
  tax_regime: 'CPF_SEM_CNPJ' | 'MEI' | 'SIMPLES';
  sales_tax_pct: number;
  mei_monthly_das: number;
  coverage_alert_days: number;
  go_live_date: string | null;
  filament_reference_cost_g: number;
  default_order_packaging_item_id: number | null;
  /** Despesas fixas mensais previstas para a meta (nulo = estimar pelos lançamentos). */
  monthly_fixed_expenses: number | null;
  monthly_profit_target: number;
  printer_hours_per_day: number;
  cash_reserve_months: number;
  /** Chave PIX que vai no texto da proposta de orçamento. */
  pix_key: string | null;
  pix_key_type: PixKeyType;
  pix_holder: string | null;
  /** Dias até o próximo retorno de um orçamento sem resposta. */
  quote_followup_days: number;
  onboarding_state: OnboardingState;
}

export interface OnboardingState {
  done?: boolean;
  step?: string;
  completed?: string[];
  skipped?: string[];
}

export interface Membership {
  user_id: string;
  role: Role;
  active: boolean;
  company: CompanySummary;
  settings: AppSettings;
}

/** Configurações da empresa ativa (a RLS devolve só a linha dela) e o papel da pessoa nela. */
export function useMembership(userId: string | undefined, company: CompanySummary) {
  return useQuery({
    queryKey: ['w', 'membership', userId, company.id],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Membership | null> => {
      const settings = await unwrap<AppSettings[]>(supabase.from('settings').select('*'));
      if (!settings[0]) return null;
      return { user_id: userId!, role: company.role, active: true, company, settings: settings[0] };
    },
  });
}

interface MemberState {
  role: Role;
  company: CompanySummary;
  settings: AppSettings;
  can: (capability: Capability) => boolean;
  /** Hoje no fuso da empresa (AAAA-MM-DD). */
  today: () => string;
}

const MemberContext = createContext<MemberState | null>(null);

export function MemberProvider({ membership, children }: { membership: Membership; children: ReactNode }) {
  const value = useMemo<MemberState>(
    () => ({
      role: membership.role,
      company: membership.company,
      settings: membership.settings,
      can: (capability) => CAPABILITIES[membership.role].includes(capability),
      today: () => todayIn(membership.settings.timezone),
    }),
    [membership],
  );
  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}

export function useMember(): MemberState {
  const context = useContext(MemberContext);
  if (!context) throw new Error('useMember fora do MemberProvider');
  return context;
}
