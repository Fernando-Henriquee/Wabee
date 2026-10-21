import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, type TestDbOptions } from './harness';

export type Row = Record<string, unknown>;

export interface Session {
  /** Executa SQL e devolve as linhas. */
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Executa SQL e devolve exatamente uma linha. */
  one<T = Row>(sql: string, params?: unknown[]): Promise<T>;
  /** Chama uma função pública com argumentos nomeados (como o PostgREST faz). */
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
}

function buildSession(db: PGlite): Session {
  const session: Session = {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await db.query<T>(sql, params);
      return result.rows;
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const rows = await session.query<T>(sql, params);
      if (rows.length !== 1) throw new Error(`Esperava 1 linha, obteve ${rows.length}: ${sql}`);
      return rows[0] as T;
    },
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const placeholders = names.map((name, index) => `${name} => $${index + 1}`).join(', ');
      const values = names.map((name) => {
        const value = args[name];
        return value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)
          ? JSON.stringify(value)
          : Array.isArray(value) && value.some((v) => typeof v === 'object')
            ? JSON.stringify(value)
            : value;
      });
      const rows = await session.query<{ result: T }>(`select public.${fn}(${placeholders}) as result`, values);
      return rows[0]?.result as T;
    },
  };
  return session;
}

/**
 * Ambiente de teste: um PostgreSQL (PGlite) com as migrations aplicadas.
 * `as(userId, fn)` executa `fn` numa transação com o papel `authenticated` e as
 * claims do JWT do usuário — o mesmo que o PostgREST faz — e faz COMMIT ao final,
 * disparando as verificações adiadas (constraint triggers).
 */
export class TestEnv {
  private constructor(readonly db: PGlite) {}

  static async create(options?: TestDbOptions): Promise<TestEnv> {
    return new TestEnv(await createTestDb(options));
  }

  async close() {
    await this.db.close();
  }

  /** SQL como superusuário (equivalente ao SQL Editor / service role). */
  admin(): Session {
    return buildSession(this.db);
  }

  async createUser(email: string, displayName?: string): Promise<string> {
    const row = await this.admin().one<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [email, JSON.stringify(displayName ? { display_name: displayName } : {})],
    );
    return row.id;
  }

  /** Cria um negócio com membros e os produtos iniciais. */
  async createBusiness(name: string, members: Array<{ userId: string; role: 'owner' | 'editor' | 'viewer' }>) {
    const admin = this.admin();
    const business = await admin.one<{ id: string }>(`insert into public.businesses (name) values ($1) returning id`, [name]);
    for (const member of members) {
      await admin.query(`insert into public.business_members (business_id, user_id, role) values ($1, $2, $3)`, [
        business.id,
        member.userId,
        member.role,
      ]);
    }
    await admin.query(`select private.seed_business_defaults($1)`, [business.id]);
    return business.id;
  }

  async as<T>(userId: string | null, fn: (session: Session) => Promise<T>): Promise<T> {
    await this.db.exec('begin');
    try {
      if (userId) {
        await this.db.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: userId, role: 'authenticated' }),
        ]);
        await this.db.exec('set local role authenticated');
      } else {
        await this.db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
        await this.db.exec('set local role anon');
      }
      const result = await fn(buildSession(this.db));
      await this.db.exec('commit');
      return result;
    } catch (error) {
      await this.db.exec('rollback').catch(() => undefined);
      throw error;
    }
  }

  /** Executa como service_role (chave administrativa do script de provisionamento). */
  async serviceRole<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    await this.db.exec('begin');
    try {
      await this.db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
      await this.db.exec('set local role service_role');
      const result = await fn(buildSession(this.db));
      await this.db.exec('commit');
      return result;
    } catch (error) {
      await this.db.exec('rollback').catch(() => undefined);
      throw error;
    }
  }

  async anon<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    return this.as(null, fn);
  }

  async today(): Promise<string> {
    const row = await this.admin().one<{ d: string }>(
      `select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`,
    );
    return row.d;
  }
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Converte valores do PGlite (bigint/numeric podem vir como string) para number. */
export function n(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  throw new Error(`Valor não numérico: ${String(value)}`);
}

export async function productId(session: Session, businessId: string, name: string): Promise<string> {
  const row = await session.one<{ id: string }>(`select id from public.products where business_id = $1 and name = $2`, [
    businessId,
    name,
  ]);
  return row.id;
}
