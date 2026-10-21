import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { createStore, del, get, keys, set } from 'idb-keyval';
import { isNetworkError } from './errors';

/**
 * Cache de leitura para uso offline. Regras de proteção dos dados locais:
 *  - um cache por usuário (chave inclui o id), descartado se outro usuário entrar;
 *  - validade máxima de 72 h (depois disso nada é exibido offline);
 *  - somente consultas bem-sucedidas e marcadas como persistíveis;
 *  - apagado por completo no logout;
 *  - nunca contém senhas ou tokens (a sessão é gerida pelo supabase-js).
 */

export const CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const CACHE_VERSION = 'v1';

let store: ReturnType<typeof createStore> | null = null;
function idbStore() {
  store ??= createStore('magi-doces', 'query-cache');
  return store;
}

const safeStorage = {
  async getItem(key: string) {
    try {
      return (await get<string>(key, idbStore())) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string) {
    try {
      await set(key, value, idbStore());
    } catch {
      // Armazenamento indisponível (aba anônima, cota): o app segue sem cache offline.
    }
  },
  async removeItem(key: string) {
    try {
      await del(key, idbStore());
    } catch {
      // ignorado
    }
  },
};

export function createUserPersister(userId: string) {
  return createAsyncStoragePersister({ storage: safeStorage, key: `cache:${CACHE_VERSION}:${userId}`, throttleTime: 300 });
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        gcTime: CACHE_MAX_AGE_MS,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => isNetworkError(error) && failureCount < 2,
      },
      mutations: {
        // Escritas nunca ficam enfileiradas para depois: sem conexão, falham na hora.
        networkMode: 'always',
        retry: false,
      },
    },
  });
}

/** Remove todo o cache local de dados (logout, troca de usuário). */
export async function clearPersistedCaches() {
  try {
    const all = await keys(idbStore());
    await Promise.all(all.map((key) => del(key, idbStore())));
  } catch {
    // ignorado
  }
}

export const persistDehydrateOptions = {
  shouldDehydrateQuery: (query: { state: { status: string }; meta?: Record<string, unknown> }) =>
    query.state.status === 'success' && query.meta?.persist !== false,
};
