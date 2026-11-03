import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { photoUrl } from '@/lib/photo-url';
import { NO_PHOTO_DRAFT, type PhotoDraft } from '@/lib/photos';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Escolha de foto (galeria ou câmera do celular) com pré-visualização.
 * Nada é enviado aqui: o formulário guarda a escolha e a envia ao salvar.
 */
export function PhotoField({
  label = 'Foto',
  path,
  draft,
  onChange,
  className,
}: {
  label?: string;
  /** Foto já gravada (caminho no bucket), se houver. */
  path: string | null;
  draft: PhotoDraft;
  onChange: (draft: PhotoDraft) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const shown = (draft.file ? preview : null) ?? (draft.remove || draft.file ? null : photoUrl(path));

  const replacePreview = (next: string | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(next);
  };

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Escolha um arquivo de imagem.');
    if (file.size > MAX_SOURCE_BYTES) return setError('A foto é grande demais (máximo 25 MB).');
    replacePreview(URL.createObjectURL(file));
    onChange({ file, remove: false });
  };

  return (
    <div className={cn('space-y-2', className)}>
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex items-center gap-3">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-subtle text-muted">
          {shown ? <img src={shown} alt="Foto escolhida" className="size-full object-cover" /> : <Camera className="size-6" aria-hidden />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            <ImagePlus /> {shown ? 'Trocar foto' : 'Escolher foto'}
          </Button>
          {shown ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => {
                replacePreview(null);
                onChange(path ? { file: null, remove: true } : NO_PHOTO_DRAFT);
              }}>
              <Trash2 /> Remover
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-label={`${label}: escolher arquivo`}
          onChange={(event) => {
            pick(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted">No celular, abre a câmera ou a galeria. A foto é reduzida antes de enviar.</p>
      )}
    </div>
  );
}
