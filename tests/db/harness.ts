import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
export const migrationsDir = join(root, 'supabase', 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export interface TestDbOptions {
  /**
   * Simula a opção "Automatically expose new tables" do Supabase.
   * true (padrão): privilégios automáticos para anon/authenticated/service_role.
   * false: nenhum privilégio automático; só valem as concessões das migrations.
   */
  defaultGrants?: boolean;
}

/** Cria um PostgreSQL em memória com o stub do Supabase e todas as migrations. */
export async function createTestDb(options: TestDbOptions = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, 'supabase-stub.sql'), 'utf8'));
  if (options.defaultGrants !== false) await db.exec(readFileSync(join(here, 'supabase-default-grants.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    } catch (error) {
      throw new Error(`Falha ao aplicar ${file}: ${(error as Error).message}`, { cause: error });
    }
  }
  return db;
}
