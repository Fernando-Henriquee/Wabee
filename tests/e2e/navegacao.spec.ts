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

test('membro tem acesso a tudo da empresa, inclusive o financeiro', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page, 'membro@local.test');
  for (const path of ['/producao', '/estoque', '/produtos', '/financeiro']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first(), path).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.getByText('Sem acesso')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Financeiro' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('quem é de outra empresa não vê nada da empresa do dono', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page, 'outra@local.test');
  await page.goto('/estoque');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).not.toContainText('Abelha');
  await page.goto('/produtos');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).not.toContainText('Abelha');
  expect(errors).toEqual([]);
});
