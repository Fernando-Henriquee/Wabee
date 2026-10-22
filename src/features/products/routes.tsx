import { lazy } from 'react';
import { Route } from 'react-router';

const ProductsPage = lazy(() => import('./products-page').then((m) => ({ default: m.ProductsPage })));
const ProductDetailPage = lazy(() => import('./product-detail-page').then((m) => ({ default: m.ProductDetailPage })));
const ProductFormPage = lazy(() => import('./product-form-page').then((m) => ({ default: m.ProductFormPage })));
const BomEditorPage = lazy(() => import('./bom-editor-page').then((m) => ({ default: m.BomEditorPage })));

/** Rotas de produtos, variações, fichas técnicas e preços (Módulo 4). */
export function productsRoutes() {
  return (
    <>
      <Route path="/produtos" element={<ProductsPage />} />
      <Route path="/produtos/novo" element={<ProductFormPage />} />
      <Route path="/produtos/:id" element={<ProductDetailPage />} />
      <Route path="/produtos/:id/editar" element={<ProductFormPage />} />
      <Route path="/produtos/:id/fichas/:bomId" element={<BomEditorPage />} />
    </>
  );
}
