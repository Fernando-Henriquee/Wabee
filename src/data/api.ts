import { supabase } from '@/lib/supabase';

/** Lança o erro do Supabase (PostgrestError) ou devolve os dados. */
export async function unwrap<T>(request: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw error;
  return data as T;
}

/** Chamada de RPC tipada. */
export function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return unwrap<T>(supabase.rpc(fn, args) as unknown as PromiseLike<{ data: T | null; error: unknown }>);
}

/** Lista de uma tabela/view (select simples, sem embedding — o app usa views). */
export function from(relation: string) {
  return supabase.from(relation);
}

/** Identificador de requisição para idempotência (gerado ao abrir o formulário). */
export function newRequestId(): string {
  return crypto.randomUUID();
}
