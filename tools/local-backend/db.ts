import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Banco do ambiente local: PGlite (PostgreSQL em WASM) com o stub do Supabase
 * e as MESMAS migrations de produção (supabase/migrations). Não é usado em produção.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, '..', '..');
const migrationsDir = join(projectRoot, 'supabase', 'migrations');
const stubFile = join(projectRoot, 'tests', 'db', 'supabase-stub.sql');

export interface Claims {
  sub?: string;
  role: 'anon' | 'authenticated';
  email?: string;
}

/** Fila simples: o PGlite tem uma única conexão, então serializamos as transações. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export class LocalDatabase {
  private readonly mutex = new Mutex();

  private constructor(readonly pg: PGlite) {}

  static async open(dataDir: string | null): Promise<LocalDatabase> {
    if (dataDir && !existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const pg = dataDir ? new PGlite(dataDir, { extensions: { btree_gist } }) : new PGlite({ extensions: { btree_gist } });
    const db = new LocalDatabase(pg);
    await db.migrate();
    return db;
  }

  private async migrate() {
    await this.pg.exec(`create schema if not exists local_meta;
      create table if not exists local_meta.applied (file text primary key, applied_at timestamptz not null default now());`);
    const applied = new Set((await this.pg.query<{ file: string }>('select file from local_meta.applied')).rows.map((r) => r.file));
    const steps = [
      { file: '00000000000000_supabase_stub.sql', path: stubFile },
      ...readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((file) => ({ file, path: join(migrationsDir, file) })),
    ];
    for (const step of steps) {
      if (applied.has(step.file)) continue;
      await this.pg.exec('begin');
      try {
        await this.pg.exec(readFileSync(step.path, 'utf8'));
        await this.pg.query('insert into local_meta.applied (file) values ($1)', [step.file]);
        await this.pg.exec('commit');
        console.log(`  migration aplicada: ${step.file}`);
      } catch (error) {
        await this.pg.exec('rollback');
        throw new Error(`Falha ao aplicar ${step.file}: ${(error as Error).message}`, { cause: error });
      }
    }
    await this.pg.exec(`
      create schema if not exists local_auth;
      create table if not exists local_auth.credentials (
        user_id uuid primary key references auth.users (id) on delete cascade,
        password_hash text not null
      );
      create table if not exists local_auth.refresh_tokens (
        token text primary key,
        user_id uuid not null references auth.users (id) on delete cascade,
        session_id uuid not null,
        revoked boolean not null default false,
        created_at timestamptz not null default now()
      );
    `);
  }

  /** Executa como superusuário (fora da RLS) — uso interno do emulador. */
  admin<T>(task: (pg: PGlite) => Promise<T>): Promise<T> {
    return this.mutex.run(() => task(this.pg));
  }

  /**
   * Executa numa transação com o papel e as claims do JWT, como o PostgREST:
   * SET LOCAL ROLE + request.jwt.claims (+ request.headers). Constraint triggers
   * adiadas rodam no COMMIT.
   */
  asRole<T>(claims: Claims, task: (pg: PGlite) => Promise<T>, headers: Record<string, string> = {}): Promise<T> {
    return this.mutex.run(async () => {
      await this.pg.exec('begin');
      try {
        await this.pg.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        await this.pg.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(headers)]);
        await this.pg.exec(claims.role === 'authenticated' ? 'set local role authenticated' : 'set local role anon');
        const result = await task(this.pg);
        await this.pg.exec('commit');
        return result;
      } catch (error) {
        await this.pg.exec('rollback').catch(() => undefined);
        throw error;
      }
    });
  }

  close() {
    return this.pg.close();
  }
}
