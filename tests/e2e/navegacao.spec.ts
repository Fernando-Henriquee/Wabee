import { expect, test } from '@playwright/test';
import { collectErrors, login } from './helpers';

/** Todas as telas abrem sem erro, e cada perfil vê só o que pode (US-0.3, US-0.7). */

const ROUTES: Array<[string, RegExp]> = [
  ['/', /Visão geral/],
  ['/estoque', /Estoque/],
  ['/estoque/carreteis', /Carretéis/],
  ['/produtos', /Produtos/],
  ['/produtos/1', /Chaveiro Abelha/],
  ['/producao', /Produção/],
  ['/producao/impressoes/nova', /impressão/i],
  ['/producao/equipamentos', /Equipamentos/],
  ['/producao/taxas', /Taxas/],
  ['/compras', /Compras/],
  ['/compras/nova', /Nova compra/],
  ['/fornecedores', /Fornecedores/],
  ['/vendas', /Vendas/],
  ['/vendas/rapida', /Venda rápida/],
  ['/clientes', /Clientes/],
  ['/financeiro', /Financeiro/],
  ['/financeiro/pagar', /Contas a pagar/],
  ['/financeiro/receber', /Contas a receber/],
  ['/financeiro/despesas', /Despesas/],
  ['/financeiro/caixa', /Fluxo de caixa/],
  ['/financeiro/dre', /DRE/],
  ['/financeiro/dono', /Dono/],
  ['/financeiro/contas', /Contas e cartões/],
  ['/financeiro/fechamento', /Fechamento/],
  ['/configuracoes', /Configurações/],
  ['/auditoria', /Auditoria/],
];

test('dono abre todas as telas sem erro', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  for (const [path, heading] of ROUTES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first(), path).toHaveText(heading, { timeout: 20_000 });
  }
  expect(errors).toEqual([]);
});

test('produção não vê valores nem o financeiro', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page, 'producao@local.test');
  for (const path of ['/producao', '/estoque', '/produtos/1', '/estoque/carreteis']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main'), path).not.toContainText('R$');
  }
  await page.goto('/financeiro');
  await expect(page.getByText('Sem acesso')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Financeiro' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('leitura vê valores mas não tem botões de lançamento', async ({ page }) => {
  await login(page, 'leitura@local.test');
  await page.goto('/financeiro/despesas');
  await expect(page.getByRole('heading', { name: 'Despesas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova despesa' })).toHaveCount(0);
  await page.goto('/produtos');
  await expect(page.getByRole('link', { name: /Novo produto/ })).toHaveCount(0);
});
