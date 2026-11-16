import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getActiveCompanyId } from './active-company';
import { env } from './env';

/**
 * Envia a empresa ativa em toda chamada de dados e de arquivos (x-company-id). O banco confere
 * o vínculo da pessoa com a empresa; sem vínculo, nenhuma linha é devolvida. Login e funções de
 * borda ficam de fora (a empresa vai no corpo quando a função precisa).
 */
const companyFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const company = getActiveCompanyId();
  if (!company || !(url.includes('/rest/v1/') || url.includes('/storage/v1/'))) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-company-id', company);
  return fetch(input, { ...init, headers });
};

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
    global: { headers: { 'x-client-info': 'wabee-web' }, fetch: companyFetch },
  },
);
