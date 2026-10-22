import { lazy } from 'react';
import { Route } from 'react-router';

const SettingsHubPage = lazy(() => import('./settings-hub-page').then((m) => ({ default: m.SettingsHubPage })));
const CompanyPage = lazy(() => import('./company-page').then((m) => ({ default: m.CompanyPage })));
const ChannelsPage = lazy(() => import('./channels-page').then((m) => ({ default: m.ChannelsPage })));
const PeoplePage = lazy(() => import('./people-page').then((m) => ({ default: m.PeoplePage })));
const AppPage = lazy(() => import('./app-page').then((m) => ({ default: m.AppPage })));
const AuditPage = lazy(() => import('@/features/audit/audit-page').then((m) => ({ default: m.AuditPage })));
const ProfilePage = lazy(() => import('@/features/profile/profile-page').then((m) => ({ default: m.ProfilePage })));

/** Configurações (US-0.4, US-6.2), pessoas, aplicativo, auditoria (US-0.5) e perfil. */
export function settingsRoutes() {
  return (
    <>
      <Route path="/configuracoes" element={<SettingsHubPage />} />
      <Route path="/configuracoes/empresa" element={<CompanyPage />} />
      <Route path="/configuracoes/canais" element={<ChannelsPage />} />
      <Route path="/configuracoes/pessoas" element={<PeoplePage />} />
      <Route path="/configuracoes/aplicativo" element={<AppPage />} />
      <Route path="/auditoria" element={<AuditPage />} />
      <Route path="/perfil" element={<ProfilePage />} />
    </>
  );
}
