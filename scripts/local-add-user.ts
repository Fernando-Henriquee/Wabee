import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AMBIENTE LOCAL: cria uma conta com perfil de acesso ao Wabee local.
 *   npm run local:add-user -- voce@exemplo.com "sua-senha" "Seu nome" [dono|producao|leitura]
 * O ambiente local (npm run dev:local) precisa estar rodando.
 * Em produção não existe este atalho: contas são convidadas pelo Supabase (docs/SUPABASE.md).
 */
const [email, password, name, role = 'dono'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Uso: npm run local:add-user -- <email> <senha> ["Nome"] [dono|producao|leitura]');
  process.exit(1);
}
const port = process.env.LOCAL_API_PORT ?? '54321';
let token: string;
try {
  token = readFileSync(join(process.cwd(), '.local-backend', `admin-token-${port}`), 'utf8').trim();
} catch {
  console.error('Ambiente local não encontrado. Rode "npm run dev:local" em outro terminal primeiro.');
  process.exit(1);
}
const response = await fetch(`http://127.0.0.1:${port}/local-admin/users`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-local-admin': token },
  body: JSON.stringify({ email, password, name, role }),
}).catch(() => null);
if (!response) {
  console.error('Não foi possível falar com o ambiente local. Ele está rodando (npm run dev:local)?');
  process.exit(1);
}
const result = (await response.json()) as Record<string, unknown>;
if (!response.ok) {
  console.error(`Erro: ${String(result.message)}`);
  process.exit(1);
}
console.log(`Conta criada: ${String(result.email)} (${String(result.role)}).`);
console.log('Entre em http://localhost:5173 com esse e-mail e senha.');
