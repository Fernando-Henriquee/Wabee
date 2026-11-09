/** Mandar imagens para fora do app: compartilhar (celular), baixar e copiar para colar na conversa. */

/** Baixa a imagem de um endereço e a devolve como arquivo (o compartilhamento precisa de File). */
export async function fetchImageFile(url: string, name: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Não foi possível carregar a foto.');
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

/** O navegador consegue compartilhar estes arquivos (menu de compartilhar do celular)? */
export function canShareFiles(files: File[]): boolean {
  if (files.length === 0 || typeof navigator === 'undefined') return false;
  return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files });
}

/** Baixa os arquivos (um download por arquivo). */
export function downloadFiles(files: File[]): void {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Copia a imagem para a área de transferência (só PNG é aceito por todos os navegadores). */
export async function copyImageToClipboard(file: File): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('Este navegador não copia imagens. Use Baixar.');
  const png = async (): Promise<Blob> => {
    if (file.type === 'image/png') return file;
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível preparar a imagem.');
      context.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Não foi possível preparar a imagem.');
      return blob;
    } finally {
      bitmap.close();
    }
  };
  // O ClipboardItem aceita uma promessa: o navegador mantém o gesto do clique enquanto converte.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })]);
}
