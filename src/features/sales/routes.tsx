import { Route } from 'react-router';
import { ComingSoon } from '@/components/layout/coming-soon';

/** Rotas do módulo (páginas carregadas sob demanda). */
export function salesRoutes() {
  return (
    <>
      <Route path="/vendas/*" element={<ComingSoon title="Vendas" description="Venda rápida, encomendas, entregas e recebimentos" />} />
      <Route path="/clientes/*" element={<ComingSoon title="Clientes" />} />
    </>
  );
}
