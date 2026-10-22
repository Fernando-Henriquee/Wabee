import { lazy } from 'react';
import { Route } from 'react-router';

const StockPage = lazy(() => import('./stock-page').then((m) => ({ default: m.StockPage })));
const ItemDetailPage = lazy(() => import('./item-detail-page').then((m) => ({ default: m.ItemDetailPage })));
const ItemFormPage = lazy(() => import('./item-form-page').then((m) => ({ default: m.ItemFormPage })));
const LotsPage = lazy(() => import('./lots-page').then((m) => ({ default: m.LotsPage })));
const AdjustPage = lazy(() => import('./adjust-page').then((m) => ({ default: m.AdjustPage })));
const OpeningPage = lazy(() => import('./opening-page').then((m) => ({ default: m.OpeningPage })));

/** Rotas do estoque (Módulo 1). */
export function inventoryRoutes() {
  return (
    <>
      <Route path="/estoque" element={<StockPage />} />
      <Route path="/estoque/itens/novo" element={<ItemFormPage />} />
      <Route path="/estoque/itens/:id" element={<ItemDetailPage />} />
      <Route path="/estoque/itens/:id/editar" element={<ItemFormPage />} />
      <Route path="/estoque/carreteis" element={<LotsPage />} />
      <Route path="/estoque/ajuste" element={<AdjustPage />} />
      <Route path="/estoque/saldo-inicial" element={<OpeningPage />} />
    </>
  );
}
