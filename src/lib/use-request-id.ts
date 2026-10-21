import { useCallback, useState } from 'react';

/**
 * Identificador de idempotência de um formulário: gerado ao abrir e reutilizado em
 * reenvios (duplo clique, falha de rede). Renove após uma gravação bem-sucedida.
 */
export function useRequestId(): [string, () => void] {
  const [id, setId] = useState(() => crypto.randomUUID());
  const renew = useCallback(() => setId(crypto.randomUUID()), []);
  return [id, renew];
}
