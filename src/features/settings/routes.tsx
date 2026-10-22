import { lazy } from 'react';
import { Route } from 'react-router';
import { ComingSoon } from '@/components/layout/coming-soon';

const ProfilePage = lazy(() => import('@/features/profile/profile-page').then((m) => ({ default: m.ProfilePage })));

export function settingsRoutes() {
  return (
    <>
      <Route path="/configuracoes/*" element={<ComingSoon title="Configurações" description="Empresa, canais, contas, categorias, pessoas com acesso e aplicativo" />} />
      <Route path="/auditoria" element={<ComingSoon title="Auditoria" />} />
      <Route path="/perfil" element={<ProfilePage />} />
    </>
  );
}
