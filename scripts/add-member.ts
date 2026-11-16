import { readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * Libera o acesso de uma conta JÁ CRIADA no Supabase Auth (Authentication → Users →
 * Add user) a uma empresa do Wabee, como dono ou membro. É o caminho administrativo; no dia a
 * dia o dono convida pelo app (Configurações → Pessoas), que usa a função de borda invite-member.
 *
 *   npm run member:add -- voce@exemplo.com dono "Seu nome" [empresa]
 *
 * `empresa` é o id ou o nome da empresa; pode ser omitida se existir uma só.
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

const [email, role = 'dono', name, companyArg] = process.argv.slice(2);
if (!email || !['dono', 'membro'].includes(role)) {
  console.error('Uso: npm run member:add -- <email> [dono|membro] ["Nome"] [empresa]');
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

  const companies = await client.query<{ id: string; name: string }>('select id, name from public.companies order by created_at');
  const wanted = (companyArg ?? '').trim().toLowerCase();
  const matches = wanted
    ? companies.rows.filter((c) => c.id === wanted || c.name.toLowerCase() === wanted)
    : companies.rows.length === 1
      ? companies.rows
      : [];
  if (matches.length !== 1) {
    console.error(wanted ? `✗ Empresa "${companyArg}" não encontrada ou ambígua.` : '✗ Há mais de uma empresa: informe qual (id ou nome).');
    for (const c of companies.rows) console.error(`  - ${c.name} (${c.id})`);
    process.exit(1);
  }
  const company = matches[0]!;

  await client.query(
    `insert into public.company_members (company_id, user_id, role, active) values ($1, $2, $3, true)
     on conflict (company_id, user_id) do update set role = excluded.role, active = true`,
    [company.id, id, role],
  );
  await client.query(
    `insert into public.profiles (id, display_name) values ($1, $2)
     on conflict (id) do update set display_name = case when $2 <> '' then $2 else public.profiles.display_name end`,
    [id, (name ?? '').trim()],
  );
  console.log(`✓ ${email} liberado como ${role} em "${company.name}".`);
} finally {
  await client.end();
}
