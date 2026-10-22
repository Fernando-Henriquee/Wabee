import { Route } from 'react-router';
import { ComingSoon } from '@/components/layout/coming-soon';

/** Rotas do módulo (páginas carregadas sob demanda). */
export function inventoryRoutes() {
  return (
    <>
      <Route path="/estoque/*" element={<ComingSoon title="Estoque" description="Filamentos, componentes, embalagens, consumíveis, ferramentas e produtos prontos" />} />
    </>
  );
}
