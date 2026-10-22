import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AuthError, LocalAuth } from './auth';
import { type Claims, LocalDatabase, projectRoot } from './db';
import { handleRpc, handleTable, RestError, type RestRequest, toRestError } from './rest';
import { seedLocal } from './seed';
import { LocalStorage } from './storage';

/**
 * AMBIENTE LOCAL — emulador da API do Supabase (Auth, PostgREST, RPC, Storage)
 * sobre PGlite, com as migrations reais. Serve para desenvolvimento e testes E2E
 * sem Docker e sem tocar em dados reais. Nunca use em produção.
 *
 *   npx tsx tools/local-backend/server.ts [--port 54321] [--memory] [--reset] [--demo]
 */

export const LOCAL_ANON_KEY = 'local-anon-key';

const { values: options } = parseArgs({
  options: {
    port: { type: 'string', default: '54321' },
    memory: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    demo: { type: 'boolean', default: false },
  },
});

const stateDir = join(projectRoot, '.local-backend');
mkdirSync(stateDir, { recursive: true });

function loadSecret(): string {
  const file = join(stateDir, 'jwt-secret');
  if (options.memory) return randomBytes(32).toString('hex');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}

const dataDir = options.memory ? null : join(stateDir, 'pgdata');

/** Token para comandos administrativos locais (ex.: npm run local:add-user). Só aceita conexões de 127.0.0.1. */
const adminToken = randomBytes(24).toString('hex');
writeFileSync(join(stateDir, `admin-token-${options.port}`), adminToken, { mode: 0o600 });
if (options.reset && dataDir && existsSync(dataDir)) {
  const { rmSync } = await import('node:fs');
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(join(stateDir, 'storage'), { recursive: true, force: true });
}

console.log('Wabee — AMBIENTE LOCAL (emulador da API Supabase)');
const db = await LocalDatabase.open(dataDir);
const secret = loadSecret();
const auth = new LocalAuth(db, secret);
const storage = new LocalStorage(db, secret, options.memory ? null : join(stateDir, 'storage'));
const seeded = await seedLocal(db, auth, { demo: options.demo });

const CORS_HEADERS = {
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers':
    'authorization,apikey,content-type,prefer,range,x-client-info,accept-profile,content-profile,x-upsert,accept,x-supabase-api-version,cache-control,x-retry-count,x-metadata',
  'access-control-expose-headers': 'content-range,content-type,x-supabase-api-version',
  'access-control-max-age': '600',
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: string | Buffer | null, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...CORS_HEADERS, 'access-control-allow-origin': res.req.headers.origin ?? '*', ...headers });
  res.end(body ?? undefined);
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8' });
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7) : undefined;
}

function claimsFor(req: IncomingMessage): Claims {
  const token = bearer(req);
  const payload = token && token !== LOCAL_ANON_KEY ? auth.claimsFromToken(token) : null;
  if (payload?.sub) return { sub: String(payload.sub), role: 'authenticated', email: String(payload.email ?? '') };
  return { role: 'anon' };
}

/** Cabeçalhos como o PostgREST os expõe ao banco (request.headers), com a origem da conexão. */
function requestHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (name === 'authorization' || name === 'cookie' || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  if (!headers['x-forwarded-for'] && req.socket.remoteAddress) headers['x-forwarded-for'] = req.socket.remoteAddress;
  return headers;
}

function parseJson(buffer: Buffer): unknown {
  if (buffer.length === 0) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new RestError(400, 'PGRST102', 'JSON inválido no corpo da requisição');
  }
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname.replace(/^\/auth\/v1/, '');
  try {
    if (path === '/health') return sendJson(res, 200, { name: 'GoTrue (local)', version: 'local' });
    if (path === '/settings') return sendJson(res, 200, { external: { email: true }, disable_signup: true });
    if (path === '/signup') throw new AuthError(422, 'signup_disabled', 'Signups not allowed for this instance');
    if (path === '/token' && req.method === 'POST') {
      const body = parseJson(await readBody(req)) as Record<string, string>;
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') return sendJson(res, 200, await auth.signInWithPassword(body.email ?? '', body.password ?? ''));
      if (grant === 'refresh_token') return sendJson(res, 200, await auth.refresh(body.refresh_token ?? ''));
      throw new AuthError(400, 'unsupported_grant_type', 'Unsupported grant type');
    }
    if (path === '/recover' && req.method === 'POST') {
      const body = parseJson(await readBody(req)) as Record<string, string>;
      const redirect = url.searchParams.get('redirect_to') ?? 'http://localhost:5173/redefinir-senha';
      const link = await auth.recoveryLink(body.email ?? '', redirect);
      if (link) {
        writeFileSync(join(stateDir, `last-recovery-link-${options.port}.txt`), link);
        console.log(`\n[e-mail simulado] Recuperação de senha para ${body.email}:\n${link}\n`);
      }
      return sendJson(res, 200, {});
    }
    const payload = auth.claimsFromToken(bearer(req));
    if (!payload) throw new AuthError(401, 'no_authorization', 'This endpoint requires a valid Bearer token');
    if (path === '/user' && req.method === 'GET') return sendJson(res, 200, await auth.getUser(payload));
    if (path === '/user' && req.method === 'PUT') {
      return sendJson(res, 200, await auth.updateUser(payload, parseJson(await readBody(req)) as Record<string, never>));
    }
    if (path === '/logout' && req.method === 'POST') {
      await auth.logout(payload, url.searchParams.get('scope') ?? 'global');
      return send(res, 204, null);
    }
    throw new AuthError(404, 'not_found', `Endpoint de auth não emulado: ${req.method} ${path}`);
  } catch (error) {
    if (error instanceof AuthError) {
      return sendJson(res, error.status, { code: error.status, error_code: error.errorCode, msg: error.message });
    }
    throw error;
  }
}

async function handleRest(req: IncomingMessage, res: ServerResponse, url: URL) {
  const claims = claimsFor(req);
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const request: RestRequest = {
    method: req.method ?? 'GET',
    relation: path,
    search: url.searchParams,
    headers: { accept: req.headers.accept, prefer: req.headers.prefer as string | undefined, range: req.headers.range },
    body: null,
  };
  try {
    const raw = await readBody(req);
    request.body = parseJson(raw);
    const response = await db.asRole(
      claims,
      (pg) => {
        if (path.startsWith('rpc/')) {
          const args =
            req.method === 'GET' ? Object.fromEntries(url.searchParams.entries()) : ((request.body as Record<string, unknown>) ?? {});
          return handleRpc(pg, path.slice(4), args, request);
        }
        return handleTable(pg, request);
      },
      requestHeaders(req),
    );
    send(res, response.status, response.body, response.headers);
  } catch (error) {
    const rest = toRestError(error, claims.role === 'authenticated');
    if (rest.status >= 500) console.error(error);
    sendJson(res, rest.status, { code: rest.code, message: rest.message, details: rest.details, hint: rest.hint });
  }
}

async function handleStorage(req: IncomingMessage, res: ServerResponse, url: URL) {
  const claims = claimsFor(req);
  const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''));
  try {
    let match = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(path);
    if (match && req.method === 'POST') {
      const body = parseJson(await readBody(req)) as { expiresIn?: number };
      return sendJson(res, 200, await storage.sign(claims, match[1]!, match[2]!, Number(body?.expiresIn ?? 60)));
    }
    if (match && req.method === 'GET') {
      const file = storage.download(match[1]!, match[2]!, url.searchParams.get('token'));
      return send(res, 200, file.data, { 'content-type': file.contentType, 'cache-control': 'private, max-age=60' });
    }
    match = /^\/object\/([^/]+)\/(.+)$/.exec(path);
    if (match && (req.method === 'POST' || req.method === 'PUT')) {
      const raw = await readBody(req);
      let data = raw;
      let contentType = String(req.headers['content-type'] ?? 'application/octet-stream');
      if (contentType.startsWith('multipart/form-data')) {
        const form = await new Request('http://local/upload', { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(raw) }).formData();
        const file = [...form.values()].find((value): value is File => typeof value !== 'string');
        if (!file) throw new RestError(400, 'InvalidRequest', 'Arquivo ausente');
        data = Buffer.from(await file.arrayBuffer());
        contentType = file.type || 'application/octet-stream';
      }
      const upsert = req.method === 'PUT' || req.headers['x-upsert'] === 'true';
      return sendJson(res, 200, await storage.upload(claims, match[1]!, match[2]!, data, contentType.split(';')[0]!.trim(), upsert));
    }
    match = /^\/object\/([^/]+)$/.exec(path);
    if (match && req.method === 'DELETE') {
      const body = parseJson(await readBody(req)) as { prefixes?: string[] };
      return sendJson(res, 200, await storage.remove(claims, match[1]!, body?.prefixes ?? []));
    }
    throw new RestError(404, 'not_found', `Endpoint de storage não emulado: ${req.method} ${path}`);
  } catch (error) {
    const rest = toRestError(error, claims.role === 'authenticated');
    const status = rest.code === '42501' || /row-level security/.test(rest.message) ? 403 : rest.status;
    sendJson(res, status, { statusCode: String(status), error: rest.code, message: rest.message });
  }
}

async function handleLocalAdmin(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.headers['x-local-admin'] !== adminToken) return sendJson(res, 403, { message: 'Token administrativo local inválido' });
  if (url.pathname === '/local-admin/users' && req.method === 'POST') {
    const body = parseJson(await readBody(req)) as { email?: string; password?: string; name?: string; role?: string };
    const email = (body.email ?? '').trim().toLowerCase();
    const role = body.role ?? 'dono';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { message: 'E-mail inválido' });
    if (!body.password || body.password.length < 8) return sendJson(res, 400, { message: 'A senha precisa ter pelo menos 8 caracteres' });
    if (!['dono', 'producao', 'leitura'].includes(role)) return sendJson(res, 400, { message: 'Perfil inválido (dono, producao ou leitura)' });
    const userId = await auth.createUser(email, body.password, body.name?.trim() || undefined);
    await db.admin((pg) =>
      pg.query(
        `insert into public.app_members (user_id, role) values ($1, $2) on conflict (user_id) do update set role = excluded.role, active = true`,
        [userId, role],
      ),
    );
    return sendJson(res, 201, { id: userId, email, role });
  }
  return sendJson(res, 404, { message: 'Comando administrativo desconhecido' });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'OPTIONS') return send(res, 204, null);
  if (url.pathname.startsWith('/local-admin/')) {
    handleLocalAdmin(req, res, url).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { message: 'Erro interno do emulador' });
    });
    return;
  }
  const route = url.pathname.startsWith('/auth/v1')
    ? handleAuth
    : url.pathname.startsWith('/rest/v1/')
      ? handleRest
      : url.pathname.startsWith('/storage/v1/')
        ? handleStorage
        : null;
  if (!route) return sendJson(res, 404, { message: 'Rota não encontrada no emulador local' });
  route(req, res, url).catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { message: 'Erro interno do emulador' });
  });
});

server.listen(Number(options.port), '127.0.0.1', () => {
  console.log(`\nAPI local em http://127.0.0.1:${options.port}  (chave anon: ${LOCAL_ANON_KEY})`);
  console.log(options.memory ? 'Banco em memória (descartado ao encerrar).' : `Banco persistido em ${dataDir}`);
  console.log('\nContas de teste do ambiente local:');
  for (const account of seeded.accounts) console.log(`  ${account.email}  /  ${account.password}   (${account.description})`);
  console.log('\nEstes dados existem só neste ambiente local e não têm relação com dados reais.\n');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void db.close().finally(() => process.exit(0));
  });
}
