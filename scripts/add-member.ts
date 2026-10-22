import { readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * Libera o acesso de uma conta JÁ CRIADA no Supabase Auth (Authentication → Users →
 * Add user) com um perfil do Wabee: dono, producao ou leitura.
 *
 *   npm run member:add -- voce@exemplo.com dono "Seu nome"
 *
 * Usa SUPABASE_DB_URL do .env.local (fora do git). Rodar de novo só atualiza o perfil.
 */

function loadEnvFile(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && match[2] !== '' && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
    }
  } catch {
    // arquivo opcional
  }
}

loadEnvFile('.env.local');

const [email, role = 'dono', name] = process.argv.slice(2);
if (!email || !['dono', 'producao', 'leitura'].includes(role)) {
  console.error('Uso: npm run member:add -- <email> [dono|producao|leitura] ["Nome"]');
  process.exit(1);
}
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('✗ Defina SUPABASE_DB_URL em .env.local.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const user = await client.query<{ id: string }>('select id from auth.users where lower(email) = lower($1)', [email.trim()]);
  if (!user.rows[0]) {
    console.error(`✗ ${email} não existe no Supabase Auth. Crie a conta em Authentication → Users → Add user e rode de novo.`);
    process.exit(1);
  }
  const id = user.rows[0].id;
  await client.query(
    `insert into public.app_members (user_id, role, active) values ($1, $2, true)
     on conflict (user_id) do update set role = excluded.role, active = true`,
    [id, role],
  );
  await client.query(
    `insert into public.profiles (id, display_name) values ($1, $2)
     on conflict (id) do update set display_name = case when $2 <> '' then $2 else public.profiles.display_name end`,
    [id, (name ?? '').trim()],
  );
  console.log(`✓ ${email} liberado como ${role}.`);
} finally {
  await client.end();
}
