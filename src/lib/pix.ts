export type PixKeyType = 'EMAIL' | 'TELEFONE' | 'CPF_CNPJ' | 'ALEATORIA';

export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  EMAIL: 'E-mail',
  TELEFONE: 'Telefone',
  CPF_CNPJ: 'CPF ou CNPJ',
  ALEATORIA: 'Chave aleatória',
};

/** Mensagem de erro se a chave não combina com o tipo; null se está válida (ou vazia). */
export function pixKeyProblem(type: PixKeyType, key: string | null | undefined): string | null {
  const value = (key ?? '').trim();
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  switch (type) {
    case 'EMAIL':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Informe um e-mail válido.';
    case 'TELEFONE':
      return digits.length >= 10 && digits.length <= 13 ? null : 'Informe o telefone com DDD.';
    case 'CPF_CNPJ':
      return digits.length === 11 || digits.length === 14 ? null : 'CPF tem 11 números e CNPJ tem 14.';
    case 'ALEATORIA':
      return /^[0-9a-f-]{32,36}$/i.test(value) ? null : 'A chave aleatória tem 32 caracteres (letras, números e hífens).';
  }
}

/** Telefone no formato que o PIX aceita (+55…); outros tipos seguem como digitados. */
export function pixKeyForPayment(type: PixKeyType, key: string): string {
  const value = key.trim();
  if (type !== 'TELEFONE') return value;
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('55') && digits.length > 11 ? `+${digits}` : `+55${digits}`;
}
