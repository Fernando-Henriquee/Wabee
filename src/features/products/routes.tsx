import { Route } from 'react-router';
import { ComingSoon } from '@/components/layout/coming-soon';

/** Rotas do módulo (páginas carregadas sob demanda). */
export function productsRoutes() {
  return (
    <>
      <Route path="/produtos/*" element={<ComingSoon title="Produtos" description="Produtos, variações, fichas técnicas e preços" />} />
    </>
  );
}
