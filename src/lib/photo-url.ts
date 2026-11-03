import { env } from './env';

export const PHOTO_BUCKET = 'product-photos';

/**
 * Endereço de exibição de uma foto. Aceita o caminho no bucket público
 * (ex.: products/abc.jpg) ou um endereço completo (http, data, blob).
 */
export function photoUrl(path: string | null | undefined, baseUrl: string = env.supabaseUrl): string | null {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  if (!baseUrl) return null;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/storage/v1/object/public/${PHOTO_BUCKET}/${encoded}`;
}
