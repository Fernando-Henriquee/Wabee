import { Copy, Download, ImagePlus, X } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/errors';
import { copyImageToClipboard, downloadFiles } from '@/lib/share-images';
import { MAX_PROPOSAL_PHOTOS, type ProposalPhotosState } from './use-proposal-photos';

/** Espaço das até 3 imagens que vão junto da proposta, com atalhos para baixar e copiar. */
export function ProposalPhotosField({ photos, name, editable }: { photos: ProposalPhotosState; name: string; editable: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const named = photos.files.map((file, index) => new File([file], `${name}-foto-${index + 1}.jpg`, { type: file.type }));

  const copy = async (file: File) => {
    try {
      await copyImageToClipboard(file);
      toast.success('Imagem copiada. É só colar na conversa.');
    } catch (e) {
      toast.error(describeError(e));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">Imagens para enviar (até {MAX_PROPOSAL_PHOTOS})</span>
        {named.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => downloadFiles(named)}>
            <Download /> Baixar {named.length === 1 ? 'imagem' : 'imagens'}
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-3">
        {photos.items.map((photo, index) => (
          <li key={photo.id} className="w-24 space-y-1">
            <div className="relative size-24">
              {photo.preview ? <img src={photo.preview} alt={`Imagem ${index + 1} da proposta`} className="size-24 rounded-xl border border-line object-cover" /> : <div className="size-24 rounded-xl bg-subtle" />}
              {editable ? (
                <button type="button" onClick={() => photos.remove(photo.id)} aria-label="Remover imagem" className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-ink text-brand-fg shadow">
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <Button type="button" variant="outline" size="sm" className="w-full" disabled={!photo.file} onClick={() => photo.file && void copy(photo.file)}>
              <Copy /> Copiar
            </Button>
          </li>
        ))}
        {editable && photos.items.length < MAX_PROPOSAL_PHOTOS ? (
          <li>
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={photos.busy}
              className="grid size-24 place-items-center rounded-xl border border-dashed border-line-strong bg-subtle text-muted hover:text-ink disabled:opacity-60"
              aria-label="Adicionar imagem da proposta"
            >
              <ImagePlus className="size-6" />
            </button>
          </li>
        ) : null}
      </ul>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Escolher imagens da proposta"
        onChange={(e) => {
          void photos.add(e.target.files);
          e.target.value = '';
        }}
      />
      {photos.error ? (
        <p role="alert" className="text-xs text-danger">
          {photos.error}
        </p>
      ) : (
        <p className="text-xs text-muted">No celular, “Enviar com imagens” manda as fotos e o texto de uma vez. No computador, copie ou baixe as imagens e cole na conversa.</p>
      )}
    </div>
  );
}
