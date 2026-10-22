import { expect, type Page } from '@playwright/test';

/** Senha das contas do emulador local (tools/local-backend/seed.ts). */
export const LOCAL_PASSWORD = 'senha-local-123';

export async function login(page: Page, email = 'dono@local.test') {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(LOCAL_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/entrar'), { timeout: 30_000 });
}

/** Erros do navegador durante o teste (exceções e console.error), exceto os esperados. */
export function collectErrors(page: Page, ignore: RegExp[] = []) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignore.some((r) => r.test(m.text()))) errors.push(m.text());
  });
  return errors;
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 });
}
