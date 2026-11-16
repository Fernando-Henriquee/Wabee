/**
 * Empresa ativa da aba. O cabeçalho x-company-id das chamadas ao Supabase e o prefixo das fotos
 * vêm daqui. O banco sempre confere se a pessoa é membro; este valor só escolhe entre as empresas dela.
 */

const STORAGE_KEY = 'wabee:company';

let current: string | null = null;

export function getActiveCompanyId(): string | null {
  return current;
}

export function setActiveCompanyId(id: string | null): void {
  current = id;
}

/** Última empresa usada neste aparelho (apagada no logout junto com os demais dados locais). */
export function readRememberedCompanyId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberCompanyId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // armazenamento indisponível: o app escolhe a primeira empresa na próxima vez
  }
}
