import { Route } from 'react-router';
import { ComingSoon } from '@/components/layout/coming-soon';

/** Rotas do módulo (páginas carregadas sob demanda). */
export function productionRoutes() {
  return (
    <>
      <Route path="/producao/*" element={<ComingSoon title="Produção" description="Impressões, acabamento, equipamentos e taxas" />} />
    </>
  );
}
