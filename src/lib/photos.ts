import { PHOTO_BUCKET } from './photo-url';
import { supabase } from './supabase';

export type PhotoFolder = 'products' | 'items' | 'quotes';

const MAX_SIDE = 1024;
const QUALITY = 0.82;

/** Reduz a foto no navegador (lado maior 1024 px, JPEG): carrega rápido e economiza armazenamento. */
export async function resizePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a foto.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('Não foi possível preparar a foto.');
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Envia uma imagem já reduzida (resizePhoto) e devolve o caminho no bucket. */
export async function uploadPhotoBlob(folder: PhotoFolder, blob: Blob): Promise<string> {
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw new Error(`Não foi possível enviar a foto: ${error.message}`);
  return path;
}

/** Reduz a foto e a envia; devolve o caminho no bucket (guardado em photo_path). */
export async function uploadPhoto(folder: PhotoFolder, file: File): Promise<string> {
  return uploadPhotoBlob(folder, await resizePhoto(file));
}

/** Escolha feita no formulário: arquivo novo, remoção ou nada (mantém a foto atual). */
export interface PhotoDraft {
  file: File | null;
  remove: boolean;
}

export const NO_PHOTO_DRAFT: PhotoDraft = { file: null, remove: false };

export interface PhotoChange extends PhotoDraft {
  /** Caminho da foto que já estava gravada (apagada do bucket depois da troca). */
  previous: string | null;
}

/**
 * Aplica a escolha do formulário: envia o arquivo, grava o caminho (setPath) e só então apaga o antigo.
 * Se gravar o caminho falhar, o arquivo recém-enviado é descartado.
 */
export async function applyPhotoChange(
  folder: PhotoFolder,
  change: PhotoChange,
  setPath: (path: string | null) => Promise<unknown>,
): Promise<void> {
  if (change.file) {
    const path = await uploadPhoto(folder, change.file);
    try {
      await setPath(path);
    } catch (error) {
      await removePhoto(path);
      throw error;
    }
    await removePhoto(change.previous);
  } else if (change.remove && change.previous) {
    await setPath(null);
    await removePhoto(change.previous);
  }
}

/** Remove o arquivo antigo. Falha silenciosa: sobra, no máximo, um arquivo sem uso. */
export async function removePhoto(path: string | null | undefined): Promise<void> {
  if (!path || /^(https?:|data:|blob:)/.test(path)) return;
  await supabase.storage.from(PHOTO_BUCKET).remove([path]).catch(() => undefined);
}
