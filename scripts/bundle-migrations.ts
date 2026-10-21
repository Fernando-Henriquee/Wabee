import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Junta todas as migrations, em ordem, num único arquivo para colar no SQL Editor
 * do Supabase num projeto NOVO (primeira instalação). Para atualizações, use a
 * Supabase CLI (`supabase db push`), que aplica só o que falta.
 *   npm run sql:bundle  →  supabase/.bundle/instalacao-completa.sql
 */
const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const parts = files.map((file) => `-- >>> ${file}\n${readFileSync(join(dir, file), 'utf8').trim()}\n`);
const header = `-- Magi Doces — instalação completa (${files.length} migrations), gerado em ${new Date().toISOString()}
-- Cole TUDO no Supabase → SQL Editor → New query → Run, num projeto novo.
-- Executa numa única transação: se algo falhar, nada fica pela metade.
begin;
`;
mkdirSync(join(process.cwd(), 'supabase', '.bundle'), { recursive: true });
const out = join(process.cwd(), 'supabase', '.bundle', 'instalacao-completa.sql');
writeFileSync(out, `${header}\n${parts.join('\n')}\ncommit;\n`);
console.log(`Gerado ${out} com ${files.length} migrations:\n${files.map((f) => `  - ${f}`).join('\n')}`);
