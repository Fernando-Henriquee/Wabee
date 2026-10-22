import { Route } from 'react-router';
import { ComingSoon } from '@/components/layout/coming-soon';

/** Rotas do módulo (páginas carregadas sob demanda). */
export function financeRoutes() {
  return (
    <>
      <Route path="/financeiro/*" element={<ComingSoon title="Financeiro" description="Contas a pagar e a receber, caixa, DRE e investimento do dono" />} />
    </>
  );
}
