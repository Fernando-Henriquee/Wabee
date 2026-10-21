/**
 * Configuração do frontend. Somente valores PÚBLICOS: a URL do projeto e a chave
 * anon/publishable (protegida pela RLS). Chaves secretas são recusadas.
 *
 * Aceita os nomes próprios do app (VITE_*) e, como alternativa, os nomes criados
 * pela integração Supabase ↔ Vercel (NEXT_PUBLIC_*), que também são públicos.
 * Variáveis secretas da integração (SUPABASE_SERVICE_ROLE_KEY, POSTGRES_*…) não têm
 * esses prefixos e nunca entram no código do navegador.
 */

export type AppEnv = 'local' | 'development' | 'preview' | 'production';

export interface EnvStatus {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appEnv: AppEnv;
  problems: string[];
}

export interface RawEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_APP_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  PROD?: boolean;
}

const APP_ENVS: AppEnv[] = ['local', 'development', 'preview', 'production'];

function decodeJwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

function firstFilled(...values: Array<string | undefined>): string {
  return (values.find((value) => value !== undefined && value.trim() !== '') ?? '').trim();
}

/** Ambiente da Vercel no momento do build (production | preview | development), se houver. */
const BUILD_VERCEL_ENV = typeof __VERCEL_ENV__ === 'string' ? __VERCEL_ENV__ : '';

export function readEnv(raw: RawEnv = import.meta.env as unknown as RawEnv, vercelEnv: string = BUILD_VERCEL_ENV): EnvStatus {
  const supabaseUrl = firstFilled(raw.VITE_SUPABASE_URL, raw.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
  const supabaseAnonKey = firstFilled(raw.VITE_SUPABASE_ANON_KEY, raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, raw.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const declared = firstFilled(raw.VITE_APP_ENV, vercelEnv) as AppEnv;
  const appEnv: AppEnv = APP_ENVS.includes(declared) ? declared : raw.PROD ? 'production' : 'development';

  const problems: string[] = [];
  if (!supabaseUrl) problems.push('URL do Supabase não definida (VITE_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_URL).');
  else if (!/^https?:\/\//.test(supabaseUrl)) problems.push('A URL do Supabase deve começar com https://.');
  else if (appEnv === 'production' && !supabaseUrl.startsWith('https://')) problems.push('Em produção a URL do Supabase deve usar HTTPS.');
  if (!supabaseAnonKey) {
    problems.push('Chave pública do Supabase não definida (VITE_SUPABASE_ANON_KEY ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/ANON_KEY).');
  }
  if (supabaseAnonKey.startsWith('sb_secret_') || decodeJwtRole(supabaseAnonKey) === 'service_role') {
    problems.push('A chave configurada é SECRETA (service_role). Remova-a do frontend imediatamente e gere uma nova no Supabase.');
  }
  return { supabaseUrl, supabaseAnonKey, appEnv, problems };
}

export const env = readEnv();
export const isLocalEnv = env.appEnv === 'local';
