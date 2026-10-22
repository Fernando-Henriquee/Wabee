import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { unwrap } from '@/data/api';
import { todayIn } from '@/lib/dates';
import { supabase } from '@/lib/supabase';

export type Role = 'dono' | 'producao' | 'leitura';

/**
 * O que cada perfil pode fazer na interface (seção 1.3). A proteção real está no
 * banco: as RPCs conferem o perfil e a RLS esconde valores de quem não pode vê-los.
 */
export type Capability = 'write' | 'production' | 'costs' | 'settings' | 'audit';

const CAPABILITIES: Record<Role, Capability[]> = {
  dono: ['write', 'production', 'costs', 'settings', 'audit'],
  producao: ['production'],
  leitura: ['costs', 'audit'],
};

export const ROLE_LABELS: Record<Role, string> = { dono: 'Dono', producao: 'Produção', leitura: 'Somente leitura' };

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
  settings: AppSettings;
}

/** Perfil de acesso do usuário logado e as configurações da empresa. */
export function useMembership(userId: string | undefined) {
  return useQuery({
    queryKey: ['w', 'membership', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Membership | null> => {
      const members = await unwrap<Array<{ user_id: string; role: Role; active: boolean }>>(
        supabase.from('app_members').select('user_id,role,active').eq('user_id', userId!),
      );
      const member = members[0];
      if (!member || !member.active) return null;
      const settings = await unwrap<AppSettings[]>(supabase.from('settings').select('*'));
      return { ...member, settings: settings[0]! };
    },
  });
}

interface MemberState {
  role: Role;
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
