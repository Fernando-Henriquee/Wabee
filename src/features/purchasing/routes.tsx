import { Route } from 'react-router';
import { ComingSoon } from '@/components/layout/coming-soon';

/** Rotas do módulo (páginas carregadas sob demanda). */
export function purchasingRoutes() {
  return (
    <>
      <Route path="/compras/*" element={<ComingSoon title="Compras" description="Compras, recebimento e parcelas" />} />
      <Route path="/fornecedores" element={<ComingSoon title="Fornecedores" />} />
    </>
  );
}
