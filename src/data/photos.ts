import { toast } from 'sonner';
import { describeError } from '@/lib/errors';
import { applyPhotoChange, type PhotoChange, type PhotoFolder } from '@/lib/photos';
import { rpc } from './api';

/**
 * Aplica a foto escolhida no formulário depois que o cadastro foi salvo.
 * Se a foto falhar, o cadastro continua salvo e o aviso diz isso (evita cadastro duplicado ao tentar de novo).
 */
export async function savePhotoAfter(folder: PhotoFolder, id: number, change: PhotoChange | undefined): Promise<void> {
  if (!change || (!change.file && !change.remove)) return;
  const fn = folder === 'items' ? 'set_item_photo' : 'set_product_photo';
  const arg = folder === 'items' ? 'p_item_id' : 'p_product_id';
  try {
    await applyPhotoChange(folder, change, (path) => rpc(fn, { [arg]: id, p_path: path }));
  } catch (error) {
    toast.error(`Cadastro salvo, mas a foto não foi enviada: ${describeError(error)} Edite e tente de novo.`);
  }
}
