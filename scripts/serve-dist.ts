import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { parseArgs } from 'node:util';

/**
 * Serve o build de produção como a Vercel: arquivos estáticos, rewrite de SPA e os
 * MESMOS cabeçalhos do vercel.json (CSP, cache do service worker…). Usado nos
 * testes E2E. A CSP recebe a origem da API local em connect-src (em produção,
 * https://*.supabase.co) e não usa upgrade-insecure-requests (localhost é http).
 */

const { values } = parseArgs({ options: { dir: { type: 'string', default: 'dist' }, port: { type: 'string', default: '4183' }, api: { type: 'string', default: '' } } });
const root = normalize(join(process.cwd(), values.dir));
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function toRegExp(source: string): RegExp {
  // Converte os padrões do vercel.json ("/(.*)", "/assets/(.*)", "/(a|b)") em RegExp.
  return new RegExp(`^${source.replace(/\./g, '\\.').replace(/\(\\\.\*\)/g, '(.*)')}$`);
}

function headersFor(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rule of vercel.headers) {
    if (!toRegExp(rule.source).test(path)) continue;
    for (const header of rule.headers) result[header.key] = header.value;
  }
  const csp = result['Content-Security-Policy'];
  if (csp && values.api) {
    result['Content-Security-Policy'] = csp
      .replace("connect-src 'self'", `connect-src 'self' ${values.api}`)
      .replace('; upgrade-insecure-requests', '');
  }
  delete result['Strict-Transport-Security'];
  return result;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Rewrite de SPA: rotas sem extensão (fora de /assets) vão para o index.html.
    if (extname(path) && !path.endsWith('.html')) {
      res.writeHead(404, headersFor(path)).end('Não encontrado');
      return;
    }
    path = '/index.html';
    file = join(root, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...headersFor(path) });
  createReadStream(file).pipe(res);
}).listen(Number(values.port), '127.0.0.1', () => {
  console.log(`Build servido em http://127.0.0.1:${values.port} (${values.dir})`);
});
