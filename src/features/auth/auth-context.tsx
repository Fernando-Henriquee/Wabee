import type { Session, User } from '@supabase/supabase-js';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearPersistedCaches } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  /** true enquanto a sessão salva é carregada. */
  loading: boolean;
  /** Entrou por link de recuperação/convite: precisa definir senha. */
  passwordSetupRequired: boolean;
  clearPasswordSetup: () => void;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Limpa tudo que é local e sensível: cache de dados e preferências do app. */
export async function wipeLocalData() {
  await clearPersistedCaches();
  try {
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of Object.keys(storage)) {
        if (key.startsWith('wabee:')) storage.removeItem(key);
      }
    }
  } catch {
    // armazenamento indisponível
  }
}

function urlRequestsPasswordSetup(): boolean {
  if (typeof window === 'undefined') return false;
  return /type=(recovery|invite|signup)/.test(window.location.hash);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(urlRequestsPasswordSetup);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setPasswordSetupRequired(true);
      if (event === 'SIGNED_OUT') void wipeLocalData();
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    // Mesmo se a revogação no servidor falhar (offline), a sessão e os dados locais são apagados.
    await supabase.auth.signOut({ scope }).catch(() => supabase.auth.signOut({ scope: 'local' }));
    await wipeLocalData();
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      passwordSetupRequired,
      clearPasswordSetup: () => setPasswordSetupRequired(false),
      signOut,
    }),
    [session, loading, passwordSetupRequired, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth fora do AuthProvider');
  return context;
}
