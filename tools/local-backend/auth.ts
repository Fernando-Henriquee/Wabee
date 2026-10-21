import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { LocalDatabase } from './db';

/**
 * Subconjunto do GoTrue (Supabase Auth) para o ambiente local: login por senha,
 * renovação de sessão, usuário, troca de senha, logout e recuperação de senha
 * (o link é exibido no console em vez de enviado por e-mail).
 */

export const ACCESS_TOKEN_TTL_SECONDS = 3600;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

interface UserRow {
  id: string;
  email: string;
  raw_user_meta_data: Record<string, unknown>;
  created_at: string;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
  }
}

function userJson(user: UserRow) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.created_at,
    phone: '',
    confirmed_at: user.created_at,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: user.raw_user_meta_data ?? {},
    identities: [],
    created_at: user.created_at,
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  };
}

export class LocalAuth {
  constructor(
    private readonly db: LocalDatabase,
    private readonly secret: string,
  ) {}

  async createUser(email: string, password: string, displayName?: string): Promise<string> {
    return this.db.admin(async (pg) => {
      const existing = await pg.query<{ id: string }>('select id from auth.users where lower(email) = lower($1)', [email]);
      if (existing.rows[0]) return existing.rows[0].id;
      const row = await pg.query<{ id: string }>(
        'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
        [email.toLowerCase(), JSON.stringify(displayName ? { display_name: displayName } : {})],
      );
      const id = row.rows[0]!.id;
      await pg.query('insert into local_auth.credentials (user_id, password_hash) values ($1, $2)', [id, hashPassword(password)]);
      return id;
    });
  }

  private async findUser(where: 'id' | 'email', value: string): Promise<UserRow | null> {
    return this.db.admin(async (pg) => {
      const sql =
        where === 'id'
          ? 'select id, email, raw_user_meta_data, created_at::text from auth.users where id = $1'
          : 'select id, email, raw_user_meta_data, created_at::text from auth.users where lower(email) = lower($1)';
      const result = await pg.query<UserRow>(sql, [value]);
      return result.rows[0] ?? null;
    });
  }

  private async issueSession(user: UserRow, sessionId: string = randomUUID()) {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = signJwt(
      { sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, session_id: sessionId, iat: now, exp: now + ACCESS_TOKEN_TTL_SECONDS },
      this.secret,
    );
    const refreshToken = randomBytes(24).toString('base64url');
    await this.db.admin((pg) =>
      pg.query('insert into local_auth.refresh_tokens (token, user_id, session_id) values ($1, $2, $3)', [refreshToken, user.id, sessionId]),
    );
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      expires_at: now + ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      user: userJson(user),
    };
  }

  async signInWithPassword(email: string, password: string) {
    const user = await this.findUser('email', email ?? '');
    const credentials = user
      ? await this.db.admin(async (pg) => {
          const result = await pg.query<{ password_hash: string }>('select password_hash from local_auth.credentials where user_id = $1', [user.id]);
          return result.rows[0] ?? null;
        })
      : null;
    if (!user || !credentials || !checkPassword(password ?? '', credentials.password_hash)) {
      throw new AuthError(400, 'invalid_credentials', 'Invalid login credentials');
    }
    return this.issueSession(user);
  }

  async refresh(refreshToken: string) {
    const row = await this.db.admin(async (pg) => {
      const result = await pg.query<{ user_id: string; session_id: string; revoked: boolean }>(
        'update local_auth.refresh_tokens set revoked = true where token = $1 and not revoked returning user_id, session_id, revoked',
        [refreshToken ?? ''],
      );
      return result.rows[0] ?? null;
    });
    if (!row) throw new AuthError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
    const user = await this.findUser('id', row.user_id);
    if (!user) throw new AuthError(400, 'user_not_found', 'User not found');
    return this.issueSession(user, row.session_id);
  }

  claimsFromToken(token: string | undefined): Record<string, unknown> | null {
    if (!token) return null;
    return verifyJwt(token, this.secret);
  }

  async getUser(claims: Record<string, unknown>) {
    const user = await this.findUser('id', String(claims.sub));
    if (!user) throw new AuthError(403, 'user_not_found', 'User from sub claim in JWT does not exist');
    return userJson(user);
  }

  async updateUser(claims: Record<string, unknown>, body: { password?: string; data?: Record<string, unknown> }) {
    const userId = String(claims.sub);
    if (body.password !== undefined) {
      if (body.password.length < 8) throw new AuthError(422, 'weak_password', 'Password should be at least 8 characters.');
      await this.db.admin((pg) => pg.query('update local_auth.credentials set password_hash = $2 where user_id = $1', [userId, hashPassword(body.password!)]));
    }
    if (body.data) {
      await this.db.admin((pg) =>
        pg.query(`update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb where id = $1`, [userId, JSON.stringify(body.data)]),
      );
    }
    return this.getUser(claims);
  }

  async logout(claims: Record<string, unknown>, scope: string) {
    await this.db.admin((pg) =>
      scope === 'global'
        ? pg.query('update local_auth.refresh_tokens set revoked = true where user_id = $1', [String(claims.sub)])
        : pg.query('update local_auth.refresh_tokens set revoked = true where session_id = $1', [String(claims.session_id)]),
    );
  }

  /** Gera um link de recuperação (implicit flow) — no Supabase real, enviado por e-mail. */
  async recoveryLink(email: string, redirectTo: string): Promise<string | null> {
    const user = await this.findUser('email', email ?? '');
    if (!user) return null;
    const session = await this.issueSession(user);
    const params = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: String(session.expires_in),
      expires_at: String(session.expires_at),
      token_type: 'bearer',
      type: 'recovery',
    });
    return `${redirectTo}#${params.toString()}`;
  }
}
