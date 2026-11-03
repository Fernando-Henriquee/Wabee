import { lazy } from 'react';
import { Route } from 'react-router';

const QuotesPage = lazy(() => import('./quotes-page').then((m) => ({ default: m.QuotesPage })));
const QuoteDetailPage = lazy(() => import('./quote-detail-page').then((m) => ({ default: m.QuoteDetailPage })));

/** Rotas de orçamentos: anotar, analisar, enviar a proposta e retomar. */
export function quotesRoutes() {
  return (
    <>
      <Route path="/orcamentos" element={<QuotesPage />} />
      <Route path="/orcamentos/:id" element={<QuoteDetailPage />} />
    </>
  );
}
