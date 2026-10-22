import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de ponta a ponta contra o emulador local (dados de demonstração em memória).
 *   npm run test:e2e
 */
const API_PORT = 54371;
const WEB_PORT = 5210;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: `npx tsx tools/local-backend/server.ts --memory --demo --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/auth/v1/health`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`, VITE_SUPABASE_ANON_KEY: 'local-anon-key', VITE_APP_ENV: 'local' },
    },
  ],
});
