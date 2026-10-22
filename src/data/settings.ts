import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { from, rpc, unwrap } from './api';
import { useAppQuery, useWrite } from './hooks';

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

export function useSaveSettings() {
  return useWrite<Record<string, unknown>>({
    mutationFn: (settings) => rpc('save_settings', { p_settings: settings }),
    success: 'Configurações salvas. Valem para as próximas operações.',
  });
}

export function useSaveOnboardingState() {
  return useWrite<Record<string, unknown>>({
    mutationFn: (state) => rpc('save_onboarding_state', { p_state: state }),
  });
}
