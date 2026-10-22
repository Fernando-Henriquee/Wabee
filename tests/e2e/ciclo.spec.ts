import { expect, test } from '@playwright/test';
import { collectErrors, expectToast, login } from './helpers';

/**
 * Ciclo principal pela interface (seção 16.3): compra → recebimento → impressão →
 * venda → recebimento → pagamento, sobre os dados de demonstração do emulador.
 */

test.describe.configure({ mode: 'serial' });

test.skip(({ isMobile }) => isMobile, 'O ciclo grava dados: roda uma vez, no computador.');

test('compra paga no Pix, confirmada e recebida (US-3.2, US-3.5)', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  await page.goto('/compras/nova');
  await page.getByRole('button', { name: 'Fornecedor' }).click();
  await page.getByRole('dialog').getByRole('searchbox').fill('Loja 3D');
  await page.getByRole('dialog').getByRole('button', { name: /Loja 3D/ }).first().click();
  await page.getByRole('button', { name: 'Item', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('searchbox').fill('PLA preto');
  await page.getByRole('dialog').getByRole('button', { name: /PLA preto — Demo/ }).click();
  await page.getByLabel('Número de carretéis').first().fill('1');
  await page.getByLabel('Preço por carretel').first().fill('90');
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByLabel('De qual conta saiu').selectOption({ label: 'Pix da empresa' });
  await page.getByRole('button', { name: /Salvar, confirmar e receber/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirmar e receber' }).click();
  await expect(page.getByText('Recebida', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('impressão em andamento finalizada com uma falha (US-5.4)', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  await page.goto('/producao?status=IMPRIMINDO');
  await page.getByRole('button', { name: 'Finalizar', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Filamento usado').waitFor();
  await dialog.getByLabel('Horas').fill('2');
  await dialog.getByLabel('Minutos').fill('5');
  await dialog.getByRole('button', { name: 'Finalizar impressão' }).click();
  await expect(dialog.getByText('Tudo gravado')).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('venda rápida recebida no Pix (US-6.3)', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  await page.goto('/vendas/rapida');
  await page.getByRole('button', { name: 'Adicionar Chaveiro Abelha — amarelo' }).click();
  await page.getByRole('radio', { name: 'Pix da empresa' }).first().click();
  // No computador o botão mostra o total ("Confirmar R$ 5,00"); no celular, "Receber".
  await page.getByRole('button', { name: /^(Confirmar R\$|Receber$)/ }).first().click();
  await expect(page.getByText(/Venda PED-\d{4}-\d{4} registrada/)).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('parcela a receber baixada e parcela a pagar paga (US-6.7, US-7.4)', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  await page.goto('/financeiro/receber');
  await page.getByRole('button', { name: 'Receber', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('Conta da empresa').selectOption({ label: 'Pix da empresa' });
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar recebimento' }).click();
  await expectToast(page, 'Recebimento registrado.');

  await page.goto('/financeiro/pagar');
  await page.getByRole('button', { name: 'Pagar', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('De onde saiu o dinheiro').selectOption({ label: 'Pix da empresa' });
  await dialog.getByRole('button', { name: 'Registrar pagamento' }).click();
  await expectToast(page, 'Pagamento registrado.');

  // O DRE do mês mostra a receita da venda entregue.
  await page.goto('/financeiro/dre');
  await expect(page.getByRole('row', { name: /Receita bruta de vendas/ })).not.toContainText('R$ 0,00');
  expect(errors).toEqual([]);
});
