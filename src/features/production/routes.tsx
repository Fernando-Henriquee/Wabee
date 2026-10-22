import { lazy } from 'react';
import { Route } from 'react-router';

const BoardPage = lazy(() => import('./board-page').then((m) => ({ default: m.BoardPage })));
const PlanPage = lazy(() => import('./plan-page').then((m) => ({ default: m.PlanPage })));
const JobDetailPage = lazy(() => import('./job-detail-page').then((m) => ({ default: m.JobDetailPage })));
const EquipmentListPage = lazy(() => import('./equipment-list-page').then((m) => ({ default: m.EquipmentListPage })));
const EquipmentFormPage = lazy(() => import('./equipment-form-page').then((m) => ({ default: m.EquipmentFormPage })));
const EquipmentDetailPage = lazy(() => import('./equipment-detail-page').then((m) => ({ default: m.EquipmentDetailPage })));
const RatesPage = lazy(() => import('./rates-page').then((m) => ({ default: m.RatesPage })));

/** Rotas da produção (Módulo 5) e de equipamentos e taxas (Módulo 2). */
export function productionRoutes() {
  return (
    <>
      <Route path="/producao" element={<BoardPage />} />
      <Route path="/producao/impressoes/nova" element={<PlanPage />} />
      <Route path="/producao/impressoes/:id" element={<JobDetailPage />} />
      <Route path="/producao/equipamentos" element={<EquipmentListPage />} />
      <Route path="/producao/equipamentos/novo" element={<EquipmentFormPage />} />
      <Route path="/producao/equipamentos/:id" element={<EquipmentDetailPage />} />
      <Route path="/producao/equipamentos/:id/editar" element={<EquipmentFormPage />} />
      <Route path="/producao/taxas" element={<RatesPage />} />
    </>
  );
}
