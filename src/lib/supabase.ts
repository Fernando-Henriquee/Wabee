import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Cliente Supabase do navegador. A sessão (JWT de curta duração + refresh token
 * rotativo) fica no armazenamento do navegador, como no modelo padrão de SPA do
 * Supabase. Mitigações: CSP restritiva sem scripts de terceiros, logout limpa a
 * sessão e o cache local, e nenhuma senha é armazenada.
 */
export const supabase: SupabaseClient = createClient(
  env.supabaseUrl || 'http://configuracao-ausente.invalid',
  env.supabaseAnonKey || 'configuracao-ausente',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      storageKey: 'wabee-auth',
    },
    global: { headers: { 'x-client-info': 'wabee-web' } },
  },
);
