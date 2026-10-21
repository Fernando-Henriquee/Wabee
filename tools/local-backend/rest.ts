import type { PGlite } from '@electric-sql/pglite';

/**
 * Subconjunto do PostgREST suficiente para o app: select de colunas, filtros
 * (eq, neq, gt, gte, lt, lte, like, ilike, is, in, not.*, or=(...)), order,
 * limit/offset/Range, count=exact, insert/update/delete e RPC.
 * Resultados são serializados com json_agg no próprio PostgreSQL, como o PostgREST.
 * Embedding de relações NÃO é suportado (o app usa views).
 */

export class RestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string | null = null,
    readonly hint: string | null = null,
  ) {
    super(message);
  }
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function ident(name: string): string {
  if (!IDENT.test(name)) throw new RestError(400, 'PGRST100', `Identificador inválido: ${name}`);
  return `"${name}"`;
}

class Params {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export function parseSelect(select: string | null): string {
  if (!select || select.trim() === '*' || select.trim() === '') return '*';
  if (select.includes('(')) {
    throw new RestError(400, 'PGRST100', 'Embedding de relações não é suportado pelo emulador local; use uma view.');
  }
  return select
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (item === '*') return '*';
      const [left, cast] = item.split('::');
      const [alias, column] = left!.includes(':') ? left!.split(':') : [null, left!];
      let expr = ident(column!.trim());
      if (cast) expr += `::${ident(cast.trim())}`;
      return alias ? `${expr} as ${ident(alias.trim())}` : expr;
    })
    .join(', ');
}

/** Divide por vírgulas fora de parênteses e aspas. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '(') depth += 1;
    if (!quoted && char === ')') depth -= 1;
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\"/g, '"') : value;
}

function condition(column: string, expression: string, params: Params): string {
  let negate = false;
  let rest = expression;
  if (rest.startsWith('not.')) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  if (dot < 0) throw new RestError(400, 'PGRST100', `Filtro inválido: ${column}=${expression}`);
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  const col = ident(column);
  let sql: string;
  switch (op) {
    case 'eq':
      sql = `${col} = ${params.add(value)}`;
      break;
    case 'neq':
      sql = `${col} <> ${params.add(value)}`;
      break;
    case 'gt':
      sql = `${col} > ${params.add(value)}`;
      break;
    case 'gte':
      sql = `${col} >= ${params.add(value)}`;
      break;
    case 'lt':
      sql = `${col} < ${params.add(value)}`;
      break;
    case 'lte':
      sql = `${col} <= ${params.add(value)}`;
      break;
    case 'like':
      sql = `${col}::text like ${params.add(value.replace(/\*/g, '%'))}`;
      break;
    case 'ilike':
      sql = `${col}::text ilike ${params.add(value.replace(/\*/g, '%'))}`;
      break;
    case 'is': {
      const normalized = value.toLowerCase();
      if (!['null', 'true', 'false', 'unknown'].includes(normalized)) throw new RestError(400, 'PGRST100', `Valor inválido para is: ${value}`);
      sql = `${col} is ${normalized}`;
      break;
    }
    case 'in': {
      if (!value.startsWith('(') || !value.endsWith(')')) throw new RestError(400, 'PGRST100', `Lista inválida: ${value}`);
      const items = splitTopLevel(value.slice(1, -1)).map((item) => unquote(item.trim()));
      sql = items.length === 0 ? 'false' : `${col} in (${items.map((item) => params.add(item)).join(', ')})`;
      break;
    }
    default:
      throw new RestError(400, 'PGRST100', `Operador não suportado pelo emulador: ${op}`);
  }
  return negate ? `not (${sql})` : sql;
}

function logicalGroup(kind: 'or' | 'and', body: string, params: Params): string {
  if (!body.startsWith('(') || !body.endsWith(')')) throw new RestError(400, 'PGRST100', `Grupo lógico inválido: ${body}`);
  const parts = splitTopLevel(body.slice(1, -1)).map((part) => {
    const trimmed = part.trim();
    const nested = /^(not\.)?(or|and)(\(.*\))$/.exec(trimmed);
    if (nested) {
      const inner = logicalGroup(nested[2] as 'or' | 'and', nested[3]!, params);
      return nested[1] ? `not ${inner}` : inner;
    }
    const dot = trimmed.indexOf('.');
    return condition(trimmed.slice(0, dot), trimmed.slice(dot + 1), params);
  });
  return `(${parts.join(kind === 'or' ? ' or ' : ' and ')})`;
}

export function buildWhere(search: URLSearchParams, params: Params): string {
  const clauses: string[] = [];
  for (const [key, value] of search.entries()) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and') clauses.push(logicalGroup(key, value, params));
    else if (key === 'not.or' || key === 'not.and') clauses.push(`not ${logicalGroup(key.slice(4) as 'or' | 'and', value, params)}`);
    else clauses.push(condition(key, value, params));
  }
  return clauses.length ? `where ${clauses.join(' and ')}` : '';
}

function buildOrder(order: string | null): string {
  if (!order) return '';
  const parts = order.split(',').map((part) => {
    const [column, ...modifiers] = part.trim().split('.');
    let sql = ident(column!);
    for (const modifier of modifiers) {
      if (modifier === 'asc' || modifier === 'desc') sql += ` ${modifier}`;
      else if (modifier === 'nullsfirst') sql += ' nulls first';
      else if (modifier === 'nullslast') sql += ' nulls last';
      else throw new RestError(400, 'PGRST100', `Ordenação inválida: ${part}`);
    }
    return sql;
  });
  return `order by ${parts.join(', ')}`;
}

export interface RestRequest {
  method: string;
  relation: string;
  search: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface RestResponse {
  status: number;
  body: string | null;
  headers: Record<string, string>;
}

function preferences(headers: RestRequest['headers']): Set<string> {
  return new Set(
    (headers.prefer ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  );
}

function wantsObject(headers: RestRequest['headers']): boolean {
  return (headers.accept ?? '').includes('application/vnd.pgrst.object+json');
}

function rangeFrom(request: RestRequest): { limit: number | null; offset: number } {
  let limit = request.search.get('limit') ? Number(request.search.get('limit')) : null;
  let offset = request.search.get('offset') ? Number(request.search.get('offset')) : 0;
  const range = request.headers.range;
  if (range) {
    const match = /^(\d+)-(\d*)$/.exec(range);
    if (match) {
      offset = Number(match[1]);
      if (match[2]) limit = Number(match[2]) - offset + 1;
    }
  }
  if ((limit !== null && (!Number.isInteger(limit) || limit < 0)) || !Number.isInteger(offset) || offset < 0) {
    throw new RestError(400, 'PGRST100', 'Paginação inválida');
  }
  return { limit, offset };
}

async function aggregate(pg: PGlite, sql: string, values: unknown[]): Promise<unknown[]> {
  const result = await pg.query<{ body: string }>(`select coalesce(json_agg(_r), '[]'::json)::text as body from (${sql}) _r`, values);
  return JSON.parse(result.rows[0]?.body ?? '[]') as unknown[];
}

/** INSERT/UPDATE/DELETE precisam ficar num CTE de nível superior. */
async function mutate(pg: PGlite, statement: string, returning: string, values: unknown[]): Promise<unknown[]> {
  const result = await pg.query<{ body: string }>(
    `with _w as (${statement} returning *) select coalesce(json_agg(_r), '[]'::json)::text as body from (select ${returning} from _w) _r`,
    values,
  );
  return JSON.parse(result.rows[0]?.body ?? '[]') as unknown[];
}

function finish(rows: unknown[], request: RestRequest, status: number, extraHeaders: Record<string, string> = {}): RestResponse {
  if (wantsObject(request.headers)) {
    if (rows.length !== 1) {
      throw new RestError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${rows.length} rows`);
    }
    return { status, body: JSON.stringify(rows[0]), headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders } };
  }
  return { status, body: JSON.stringify(rows), headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders } };
}

export async function handleTable(pg: PGlite, request: RestRequest): Promise<RestResponse> {
  const relation = `public.${ident(request.relation)}`;
  const prefer = preferences(request.headers);
  const params = new Params();
  const where = buildWhere(request.search, params);
  const returning = parseSelect(request.search.get('select'));

  if (request.method === 'GET' || request.method === 'HEAD') {
    const { limit, offset } = rangeFrom(request);
    const base = `select ${returning} from ${relation} ${where}`;
    const sql = `${base} ${buildOrder(request.search.get('order'))} ${limit !== null ? `limit ${limit}` : ''} ${offset ? `offset ${offset}` : ''}`;
    const rows = request.method === 'HEAD' ? [] : await aggregate(pg, sql, params.values);
    const headers: Record<string, string> = {};
    if ([...prefer].some((p) => p.startsWith('count='))) {
      const count = await pg.query<{ c: number }>(`select count(*)::int as c from (select 1 from ${relation} ${where}) _c`, params.values);
      const total = count.rows[0]?.c ?? 0;
      headers['content-range'] = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`;
    }
    if (request.method === 'HEAD') return { status: 200, body: null, headers };
    return finish(rows, request, 200, headers);
  }

  const representation = prefer.has('return=representation');

  if (request.method === 'POST') {
    const records = Array.isArray(request.body) ? request.body : [request.body];
    if (records.length === 0 || records.some((r) => r === null || typeof r !== 'object')) {
      throw new RestError(400, 'PGRST102', 'Corpo da requisição inválido');
    }
    const columns = [...new Set(records.flatMap((record) => Object.keys(record as object)))];
    const insertParams = new Params();
    const tuples = records.map(
      (record) =>
        `(${columns
          .map((column) => {
            const value = (record as Record<string, unknown>)[column];
            if (value === undefined) return 'default';
            return insertParams.add(value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
          })
          .join(', ')})`,
    );
    const statement = `insert into ${relation} (${columns.map(ident).join(', ')}) values ${tuples.join(', ')}`;
    const rows = await mutate(pg, statement, returning, insertParams.values);
    return representation ? finish(rows, request, 201) : { status: 201, body: null, headers: {} };
  }

  if (request.method === 'PATCH' || request.method === 'DELETE') {
    if (!where) throw new RestError(400, '21000', `${request.method === 'PATCH' ? 'UPDATE' : 'DELETE'} requires a WHERE clause`);
    let statement: string;
    if (request.method === 'PATCH') {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
        throw new RestError(400, 'PGRST102', 'Corpo da requisição inválido');
      }
      const assignments = Object.entries(body).map(
        ([column, value]) => `${ident(column)} = ${params.add(value !== null && typeof value === 'object' ? JSON.stringify(value) : value)}`,
      );
      statement = `update ${relation} set ${assignments.join(', ')} ${where}`;
    } else {
      statement = `delete from ${relation} ${where}`;
    }
    const rows = await mutate(pg, statement, returning, params.values);
    if (representation) return finish(rows, request, 200);
    return { status: 204, body: null, headers: {} };
  }

  throw new RestError(405, 'PGRST000', 'Método não suportado');
}

interface FunctionInfo {
  argNames: string[];
  argTypes: string[];
  returnsSet: boolean;
  returnType: string;
}

const functionCache = new Map<string, FunctionInfo>();

async function functionInfo(pg: PGlite, name: string): Promise<FunctionInfo> {
  const cached = functionCache.get(name);
  if (cached) return cached;
  const result = await pg.query<{ names: string[] | null; types: string[] | null; retset: boolean; rettype: string }>(
    `select p.proargnames as names,
            array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types,
            p.proretset as retset, format_type(p.prorettype, null) as rettype
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  const row = result.rows[0];
  if (!row) throw new RestError(404, 'PGRST202', `Função public.${name} não encontrada`);
  const info = { argNames: row.names ?? [], argTypes: row.types ?? [], returnsSet: row.retset, returnType: row.rettype };
  functionCache.set(name, info);
  return info;
}

function arrayLiteral(values: unknown[]): string {
  return `{${values
    .map((value) => (value === null ? 'NULL' : `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`))
    .join(',')}}`;
}

export async function handleRpc(pg: PGlite, name: string, args: Record<string, unknown>, request: RestRequest): Promise<RestResponse> {
  ident(name);
  const info = await functionInfo(pg, name);
  const params = new Params();
  const assignments = Object.entries(args ?? {}).map(([arg, value]) => {
    const index = info.argNames.indexOf(arg);
    if (index < 0) throw new RestError(404, 'PGRST202', `Parâmetro desconhecido ${arg} em public.${name}`);
    const type = info.argTypes[index]!;
    let serialized: unknown = value;
    if (value !== null && value !== undefined) {
      if (type === 'jsonb' || type === 'json') serialized = JSON.stringify(value);
      else if (type.endsWith('[]')) serialized = arrayLiteral(Array.isArray(value) ? value : [value]);
      else serialized = String(value);
    }
    return `${ident(arg)} => ${params.add(serialized ?? null)}::${type}`;
  });
  const call = `public.${ident(name)}(${assignments.join(', ')})`;

  if (info.returnsSet) {
    const rows = await aggregate(pg, `select * from ${call}`, params.values);
    return finish(rows, request, 200);
  }
  if (info.returnType === 'void') {
    await pg.query(`select ${call}`, params.values);
    return { status: 204, body: null, headers: {} };
  }
  const result = await pg.query<{ body: string | null }>(`select to_json(${call})::text as body`, params.values);
  return { status: 200, body: result.rows[0]?.body ?? 'null', headers: { 'content-type': 'application/json; charset=utf-8' } };
}

/** Mapeia erros do PostgreSQL para o formato/HTTP status do PostgREST. */
export function toRestError(error: unknown, authenticated: boolean): RestError {
  if (error instanceof RestError) return error;
  const pgError = error as { code?: string; message?: string; detail?: string; hint?: string };
  const code = pgError.code ?? 'XX000';
  const status =
    code === '42501' ? (authenticated ? 403 : 401)
    : code === '23505' || code === '23503' ? 409
    : code.startsWith('22') || code.startsWith('23') || code === 'P0001' || code === '42883' || code === '42703' ? 400
    : code === 'PGRST116' ? 406
    : 500;
  return new RestError(status, code, pgError.message ?? 'Erro interno', pgError.detail ?? null, pgError.hint ?? null);
}
