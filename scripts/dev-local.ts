import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Ambiente local completo: emulador da API Supabase (PGlite) + Vite.
 *   npm run dev:local            (dados persistidos em .local-backend/)
 *   npm run dev:local -- --demo  (inclui movimentações de demonstração)
 */
const extra = process.argv.slice(2);
const apiPort = process.env.LOCAL_API_PORT ?? '54321';

// Executa o próprio node (sem npx): no Windows `npx` é um .cmd, que o spawn não roda sem shell.
const viteBin = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');

const api = spawn(
  process.execPath,
  ['--import', 'tsx', 'tools/local-backend/server.ts', '--port', apiPort, ...extra],
  { stdio: 'inherit' },
);
const web = spawn(process.execPath, [viteBin], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: `http://127.0.0.1:${apiPort}`,
    VITE_SUPABASE_ANON_KEY: 'local-anon-key',
    VITE_APP_ENV: 'local',
  },
});

const stop = () => {
  api.kill('SIGTERM');
  web.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (code) => {
  if (code) stop();
});
web.on('exit', stop);
