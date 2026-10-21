import { describe, expect, it } from 'vitest';
import { readEnv } from './env';

const anonJwt = `x.${btoa(JSON.stringify({ role: 'anon' }))}.y`;
const serviceJwt = `x.${btoa(JSON.stringify({ role: 'service_role' }))}.y`;
const url = 'https://abcdefghijklmnopqrst.supabase.co';

describe('readEnv', () => {
  it('usa as variáveis próprias do app (VITE_*)', () => {
    const env = readEnv({ VITE_SUPABASE_URL: `${url}/`, VITE_SUPABASE_ANON_KEY: anonJwt, VITE_APP_ENV: 'preview' }, '');
    expect(env).toEqual({ supabaseUrl: url, supabaseAnonKey: anonJwt, appEnv: 'preview', problems: [] });
  });

  it('aceita os nomes da integração Supabase ↔ Vercel, preferindo a publishable key', () => {
    const env = readEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc', NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt, PROD: true }, 'production');
    expect(env).toMatchObject({ supabaseUrl: url, supabaseAnonKey: 'sb_publishable_abc', appEnv: 'production', problems: [] });
    expect(readEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt }, '').supabaseAnonKey).toBe(anonJwt);
  });

  it('VITE_* tem prioridade sobre os nomes da integração', () => {
    const env = readEnv({ VITE_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: 'https://outro.supabase.co', VITE_SUPABASE_ANON_KEY: anonJwt, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }, '');
    expect(env.supabaseUrl).toBe(url);
    expect(env.supabaseAnonKey).toBe(anonJwt);
  });

  it('ambiente vem de VITE_APP_ENV, da Vercel ou do tipo de build', () => {
    expect(readEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonJwt }, 'preview').appEnv).toBe('preview');
    expect(readEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonJwt, PROD: true }, '').appEnv).toBe('production');
    expect(readEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonJwt }, '').appEnv).toBe('development');
  });

  it('recusa chaves secretas em qualquer nome', () => {
    expect(readEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }, '').problems[0]).toMatch(/SECRETA/);
    expect(readEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: serviceJwt }, '').problems[0]).toMatch(/SECRETA/);
  });

  it('aponta o que falta', () => {
    expect(readEnv({}, '').problems).toHaveLength(2);
  });
});
