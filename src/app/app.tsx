import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { type ReactNode, Suspense, useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { SetPasswordPage } from '@/features/auth/set-password-page';
import { MemberProvider, useMembership } from '@/features/member/member-context';
import { useOnline } from '@/lib/connectivity';
import { env } from '@/lib/env';
import { CACHE_MAX_AGE_MS, createAppQueryClient, createUserPersister, persistDehydrateOptions } from '@/lib/query-cache';
import { AppRoutes } from './routes';
import { ConfigProblemScreen, MembershipErrorScreen, NoAccessScreen, OfflineWithoutDataScreen, PageFallback, Splash } from './screens';

function PublicRoutes() {
  const location = useLocation();
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-senha" element={<SetPasswordPage />} />
      <Route path="*" element={<Navigate to="/entrar" replace state={{ from: location.pathname }} />} />
    </Routes>
  );
}

function MembershipGate({ userId }: { userId: string }) {
  const membership = useMembership(userId);
  const online = useOnline();
  if (membership.isPending) return online ? <Splash /> : <OfflineWithoutDataScreen />;
  if (membership.isError && !membership.data) return <MembershipErrorScreen error={membership.error} onRetry={() => void membership.refetch()} />;
  if (!membership.data) return <NoAccessScreen />;
  return (
    <MemberProvider membership={membership.data}>
      <AppShell>
        <Suspense fallback={<PageFallback />}>
          <AppRoutes />
        </Suspense>
      </AppShell>
    </MemberProvider>
  );
}

/** Cliente de consultas e cache local exclusivos do usuário logado. */
function UserDataScope({ userId, children }: { userId: string; children: ReactNode }) {
  // Um cliente e um cache por usuário (o componente também é remontado via key).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queryClient = useMemo(() => createAppQueryClient(), [userId]);
  const persister = useMemo(() => createUserPersister(userId), [userId]);
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: CACHE_MAX_AGE_MS, buster: __APP_VERSION__, dehydrateOptions: persistDehydrateOptions }}
      // Dados restaurados do aparelho nunca valem como atuais: revalida tudo assim que possível.
      onSuccess={() => void queryClient.invalidateQueries()}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

function Root() {
  const { session, loading, passwordSetupRequired } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <PublicRoutes />;
  if (passwordSetupRequired) return <SetPasswordPage />;
  return (
    <UserDataScope key={session.user.id} userId={session.user.id}>
      <MembershipGate userId={session.user.id} />
    </UserDataScope>
  );
}

export function App() {
  if (env.problems.length > 0) return <ConfigProblemScreen problems={env.problems} />;
  return (
    <AuthProvider>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
      <Toaster position="top-center" richColors closeButton toastOptions={{ duration: 4000 }} />
    </AuthProvider>
  );
}
