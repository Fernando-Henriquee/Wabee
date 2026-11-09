import { useEffect, useRef, useState } from 'react';
import { describeError } from '@/lib/errors';
import { photoUrl } from '@/lib/photo-url';
import { removePhoto, resizePhoto, uploadPhotoBlob } from '@/lib/photos';
import { fetchImageFile } from '@/lib/share-images';

export const MAX_PROPOSAL_PHOTOS = 3;

export interface ProposalPhoto {
  id: string;
  /** Caminho no bucket (foto já salva); nulo enquanto é só uma escolha na tela. */
  path: string | null;
  /** Arquivo pronto para compartilhar (as fotos já salvas são baixadas em segundo plano). */
  file: File | null;
  preview: string | null;
}

/** Imagens da proposta: escolhidas na tela, enviadas ao salvar, e sempre disponíveis como arquivo para compartilhar. */
export function useProposalPhotos(savedPaths: string[]) {
  const [items, setItems] = useState<ProposalPhoto[]>(() => savedPaths.map((path) => ({ id: path, path, file: null, preview: photoUrl(path) })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    for (const item of items) {
      if (!item.path || item.file || !item.preview || tried.current.has(item.id)) continue;
      tried.current.add(item.id);
      void fetchImageFile(item.preview, `${item.id.split('/').pop() ?? 'foto'}`)
        .then((file) => setItems((list) => list.map((i) => (i.id === item.id ? { ...i, file } : i))))
        .catch(() => undefined);
    }
  }, [items]);

  const add = async (picked: FileList | null) => {
    setError(null);
    const images = [...(picked ?? [])].filter((f) => f.type.startsWith('image/'));
    const room = MAX_PROPOSAL_PHOTOS - items.length;
    if (images.length > room) setError(`Anexe no máximo ${MAX_PROPOSAL_PHOTOS} imagens.`);
    setBusy(true);
    try {
      const added: ProposalPhoto[] = [];
      for (const image of images.slice(0, Math.max(room, 0))) {
        const blob = await resizePhoto(image);
        const id = crypto.randomUUID();
        added.push({ id, path: null, file: new File([blob], `${id}.jpg`, { type: 'image/jpeg' }), preview: URL.createObjectURL(blob) });
      }
      setItems((list) => [...list, ...added].slice(0, MAX_PROPOSAL_PHOTOS));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    setItems((list) => {
      const gone = list.find((i) => i.id === id);
      if (gone && !gone.path && gone.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((i) => i.id !== id);
    });
  };

  /** Envia as imagens novas e devolve a lista final de caminhos (e as recém-enviadas, para desfazer se a gravação falhar). */
  const upload = async (): Promise<{ paths: string[]; uploaded: string[] }> => {
    const uploaded: string[] = [];
    const paths: string[] = [];
    try {
      for (const item of items) {
        if (item.path) paths.push(item.path);
        else if (item.file) {
          const path = await uploadPhotoBlob('quotes', item.file);
          uploaded.push(path);
          paths.push(path);
        }
      }
    } catch (e) {
      await Promise.all(uploaded.map((path) => removePhoto(path)));
      throw e;
    }
    return { paths, uploaded };
  };

  const files = items.flatMap((i) => (i.file ? [i.file] : []));
  const dirty = (saved: string[]) => items.length !== saved.length || items.some((item, index) => item.path !== saved[index]);

  return { items, files, allReady: files.length === items.length, add, remove, upload, dirty, error, busy };
}

export type ProposalPhotosState = ReturnType<typeof useProposalPhotos>;
