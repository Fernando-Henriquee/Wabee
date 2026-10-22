import { type QueryKey, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ensureOnline } from '@/lib/connectivity';
import { describeError } from '@/lib/errors';

/** Consulta do app (chave sempre começa com 'w', para invalidar tudo após uma escrita). */
export function useAppQuery<T>(key: unknown[], queryFn: () => Promise<T>, options?: Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'>) {
  return useQuery<T, Error, T, QueryKey>({ queryKey: ['w', ...key], queryFn, ...options });
}

interface UndoOption<TResult> {
  /** Texto do botão (padrão "Desfazer"). */
  label?: string;
  /** Estorna a operação recém-feita (US-0.7: "Desfazer" por 10 segundos). */
  run: (result: TResult) => Promise<unknown>;
}

interface WriteOptions<TVars, TResult> {
  mutationFn: (vars: TVars) => Promise<TResult>;
  success?: string | ((result: TResult, vars: TVars) => string);
  onSuccess?: (result: TResult, vars: TVars) => void;
  undo?: UndoOption<TResult>;
  /** Mostra toast de erro automaticamente (padrão: true). */
  toastError?: boolean;
}

/**
 * Escrita confirmada: verifica a conexão ANTES de gravar, nunca enfileira para
 * depois, atualiza os dados da tela e mostra o resultado (com "Desfazer" quando a
 * operação permite estorno).
 */
export function useWrite<TVars = void, TResult = unknown>({ mutationFn, success, onSuccess, undo, toastError = true }: WriteOptions<TVars, TResult>) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TVars>({
    mutationFn: async (vars) => {
      await ensureOnline();
      return mutationFn(vars);
    },
    onSuccess: async (result, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['w'] });
      if (success) {
        const message = typeof success === 'function' ? success(result, vars) : success;
        toast.success(message, undo
          ? {
              duration: 10_000,
              action: {
                label: undo.label ?? 'Desfazer',
                onClick: () => {
                  void ensureOnline()
                    .then(() => undo.run(result))
                    .then(() => queryClient.invalidateQueries({ queryKey: ['w'] }))
                    .then(() => toast.success('Operação desfeita.'))
                    .catch((error: unknown) => toast.error(describeError(error)));
                },
              },
            }
          : undefined);
      }
      onSuccess?.(result, vars);
    },
    onError: (error) => {
      if (toastError) toast.error(describeError(error));
    },
  });
}
