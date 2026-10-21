import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type { Claims, LocalDatabase } from './db';
import { RestError } from './rest';

/**
 * Subconjunto do Supabase Storage: upload, URL assinada, download assinado e remoção.
 * A autorização usa as MESMAS políticas RLS de storage.objects das migrations.
 * Em memória (--memory) ou em disco (.local-backend/storage).
 */

export class LocalStorage {
  private readonly memory = new Map<string, { data: Buffer; contentType: string }>();

  constructor(
    private readonly db: LocalDatabase,
    private readonly secret: string,
    private readonly dir: string | null,
  ) {}

  private filePath(bucket: string, name: string): string {
    const path = normalize(join(this.dir!, bucket, name));
    if (!path.startsWith(normalize(this.dir!))) throw new RestError(400, 'InvalidKey', 'Caminho inválido');
    return path;
  }

  private write(bucket: string, name: string, data: Buffer, contentType: string) {
    if (!this.dir) {
      this.memory.set(`${bucket}/${name}`, { data, contentType });
      return;
    }
    const path = this.filePath(bucket, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    writeFileSync(`${path}.content-type`, contentType);
  }

  private read(bucket: string, name: string): { data: Buffer; contentType: string } | null {
    if (!this.dir) return this.memory.get(`${bucket}/${name}`) ?? null;
    const path = this.filePath(bucket, name);
    if (!existsSync(path)) return null;
    return { data: readFileSync(path), contentType: readFileSync(`${path}.content-type`, 'utf8') };
  }

  private delete(bucket: string, name: string) {
    if (!this.dir) {
      this.memory.delete(`${bucket}/${name}`);
      return;
    }
    const path = this.filePath(bucket, name);
    rmSync(path, { force: true });
    rmSync(`${path}.content-type`, { force: true });
  }

  async upload(claims: Claims, bucket: string, name: string, data: Buffer, contentType: string, upsert: boolean) {
    if (claims.role !== 'authenticated') throw new RestError(401, 'Unauthorized', 'Faça login para enviar arquivos.');
    const limits = await this.db.admin(async (pg) => {
      const result = await pg.query<{ file_size_limit: number | null; allowed_mime_types: string[] | null }>(
        'select file_size_limit, allowed_mime_types from storage.buckets where id = $1',
        [bucket],
      );
      return result.rows[0] ?? null;
    });
    if (!limits) throw new RestError(404, 'Bucket not found', 'Bucket não encontrado');
    if (limits.file_size_limit && data.length > Number(limits.file_size_limit)) {
      throw new RestError(413, 'Payload too large', 'O arquivo excede o tamanho máximo permitido.');
    }
    if (limits.allowed_mime_types && !limits.allowed_mime_types.includes(contentType)) {
      throw new RestError(415, 'invalid_mime_type', `Tipo de arquivo não permitido: ${contentType}`);
    }
    const id = randomUUID();
    await this.db.asRole(claims, (pg) =>
      upsert
        ? pg.query(
            `insert into storage.objects (id, bucket_id, name, owner, metadata) values ($1, $2, $3, $4, $5)
             on conflict (bucket_id, name) do update set metadata = excluded.metadata`,
            [id, bucket, name, claims.sub, JSON.stringify({ mimetype: contentType, size: data.length })],
          )
        : pg.query('insert into storage.objects (id, bucket_id, name, owner, metadata) values ($1, $2, $3, $4, $5)', [
            id,
            bucket,
            name,
            claims.sub,
            JSON.stringify({ mimetype: contentType, size: data.length }),
          ]),
    );
    this.write(bucket, name, data, contentType);
    return { Key: `${bucket}/${name}`, Id: id };
  }

  private token(bucket: string, name: string, expiresAt: number): string {
    return `${expiresAt}.${createHmac('sha256', this.secret).update(`${bucket}/${name}:${expiresAt}`).digest('base64url')}`;
  }

  async sign(claims: Claims, bucket: string, name: string, expiresIn: number) {
    const visible = await this.db.asRole(claims, async (pg) => {
      const result = await pg.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name]);
      return result.rows.length > 0;
    });
    if (!visible) throw new RestError(400, 'not_found', 'Object not found');
    const expiresAt = Math.floor(Date.now() / 1000) + Math.min(Math.max(expiresIn || 60, 1), 604800);
    return { signedURL: `/object/sign/${bucket}/${name}?token=${encodeURIComponent(this.token(bucket, name, expiresAt))}` };
  }

  download(bucket: string, name: string, token: string | null) {
    const [expires] = (token ?? '').split('.');
    const expiresAt = Number(expires);
    if (!token || !Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now() || token !== this.token(bucket, name, expiresAt)) {
      throw new RestError(400, 'InvalidSignature', 'URL assinada inválida ou expirada');
    }
    const file = this.read(bucket, name);
    if (!file) throw new RestError(404, 'not_found', 'Object not found');
    return file;
  }

  async remove(claims: Claims, bucket: string, prefixes: string[]) {
    const removed = await this.db.asRole(claims, async (pg) => {
      const result = await pg.query<{ name: string }>(
        `delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`,
        [bucket, `{${prefixes.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(',')}}`],
      );
      return result.rows.map((r) => r.name);
    });
    for (const name of removed) this.delete(bucket, name);
    return removed.map((name) => ({ name, bucket_id: bucket }));
  }
}
