import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';

/**
 * Aplica no Supabase as migrations de supabase/migrations que ainda faltam, em ordem,
 * cada uma numa transação. O histórico fica em supabase_migrations.schema_migrations
 * (o mesmo da Supabase CLI: depois dá para usar `supabase db push` sem conflito).
 *
 *   npm run db:migrate -- --status     mostra aplicadas e pendentes
 *   npm run db:migrate -- --dry-run    lista o que seria aplicado
 *   npm run db:migrate                 aplica as pendentes
 *   npm run db:migrate -- --until 20261021000300   aplica só até essa versão
 *
 * Lê SUPABASE_DB_URL de .env.local (fora do git). Ela contém a senha do banco:
 * nunca use o prefixo VITE_ e nunca cadastre na Vercel.
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
loadEnvFile('.env.provision');

const { values } = parseArgs({
  options: {
    status: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    // Aplica só até esta versão (inclusive), ex.: --until 20261021000300
    until: { type: 'string' },
  },
});

const url = process.env.SUPABASE_DB_URL ?? '';
if (!url) {
  console.error('✗ Defina SUPABASE_DB_URL em .env.local (Supabase → Connect → Session pooler → URI, com a senha do banco).');
  process.exit(1);
}
if (url.includes('[YOUR-PASSWORD]')) {
  console.error('✗ Troque [YOUR-PASSWORD] pela senha do banco em SUPABASE_DB_URL.');
  process.exit(1);
}
if (process.env.VITE_SUPABASE_DB_URL) {
  console.error('✗ Nunca use o prefixo VITE_ para a conexão do banco: ela seria embutida no app.');
  process.exit(1);
}

const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter((file) => /^\d{14}_.+\.sql$/.test(file))
  .sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'wabee-migrate' });
await client.connect();
try {
  const host = new URL(url).host.replace(/:[^:]*@/, '@');
  console.log(`Banco: ${host}`);
  await client.query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  const applied = new Set(
    (await client.query<{ version: string }>('select version from supabase_migrations.schema_migrations')).rows.map((row) => row.version),
  );
  const pending = files.filter((file) => !applied.has(file.slice(0, 14)) && (!values.until || file.slice(0, 14) <= values.until));

  if (values.status || values['dry-run']) {
    for (const file of files) console.log(`  ${applied.has(file.slice(0, 14)) ? '✓ aplicada ' : '· pendente '} ${file}`);
    console.log(pending.length ? `\n${pending.length} pendente(s).` : '\nTudo aplicado.');
    process.exit(0);
  }
  if (pending.length === 0) {
    console.log('Nada a aplicar: o banco já está com todas as migrations.');
    process.exit(0);
  }
  for (const file of pending) {
    const sql = readFileSync(join(dir, file), 'utf8');
    process.stdout.write(`→ ${file} … `);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [
        file.slice(0, 14),
        file.slice(15, -4),
      ]);
      await client.query('commit');
      console.log('ok');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      console.log('FALHOU');
      const e = error as { message?: string; position?: string; detail?: string };
      console.error(`\n✗ ${e.message}${e.detail ? `\n  ${e.detail}` : ''}`);
      if (e.position) {
        const before = sql.slice(0, Number(e.position));
        console.error(`  (linha ${before.split('\n').length} de ${file})`);
      }
      console.error('Nada desta migration foi gravado. As anteriores continuam aplicadas.');
      process.exit(1);
    }
  }
  console.log(`\n${pending.length} migration(s) aplicada(s).`);
} finally {
  await client.end();
}
