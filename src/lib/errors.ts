/**
 * Tradução de erros do Supabase/PostgreSQL para mensagens claras em português.
 * As RPCs já devolvem mensagens em português; mensagens técnicas em inglês são
 * substituídas por textos genéricos (sem expor detalhes internos).
 */

export class OfflineError extends Error {
  constructor(message = 'Sem conexão confirmada com o servidor. Nada foi gravado — tente novamente quando a internet voltar.') {
    super(message);
    this.name = 'OfflineError';
  }
}

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
  details?: string | null;
}

const UNIQUE_MESSAGES: Array<[RegExp, string]> = [
  [/items_sku_key/, 'Já existe um item com este SKU.'],
  [/product_variants_sku_key/, 'Já existe uma variação com este SKU.'],
  [/suppliers_name_uq/, 'Já existe um fornecedor com este nome.'],
  [/payment_accounts_name_uq/, 'Já existe uma conta com este nome.'],
  [/sales_channels_name_uq/, 'Já existe um canal com este nome.'],
  [/filament_specs_uq/, 'Já existe um filamento com o mesmo material, marca e cor.'],
  [/cost_rates_no_overlap|channel_prices_no_overlap|sales_channel_fees_no_overlap/, 'Já existe uma vigência que se sobrepõe a este período.'],
]

const TECHNICAL = /violates|permission denied|duplicate key|invalid input syntax|null value in column|value too long|does not exist|syntax error|out of range|JSON object requested|Failed to fetch|NetworkError|Load failed/i;

export function isNetworkError(error: unknown): boolean {
  const e = error as ErrorLike | null;
  if (!e) return false;
  if (e instanceof OfflineError) return true;
  const message = e.message ?? '';
  return e.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed|FetchError|fetch failed/i.test(message) || e.status === 0;
}

export function describeError(error: unknown): string {
  if (!error) return 'Erro desconhecido.';
  if (error instanceof OfflineError) return error.message;
  const e = error as ErrorLike;
  const message = e.message ?? String(error);

  if (isNetworkError(error)) return 'Falha de conexão com o servidor. Verifique a internet e tente novamente.';

  // Auth
  if (/Invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(message)) return 'Este e-mail ainda não foi confirmado.';
  if (/rate limit|too many requests/i.test(message) || e.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (/at least \d+ characters|weak_password|Password should/i.test(message)) return 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.';
  if (/should be different from the old password/i.test(message)) return 'A nova senha precisa ser diferente da atual.';
  if (/refresh token|session.*(missing|expired|not found)|JWT expired/i.test(message)) return 'Sua sessão expirou. Entre novamente.';
  if (/Signups not allowed/i.test(message)) return 'O cadastro público está desativado. Peça um convite ao dono do sistema.';

  switch (e.code) {
    case 'PGRST116':
      return 'Registro não encontrado ou sem acesso.';
    case '42501':
      return TECHNICAL.test(message) ? 'Você não tem permissão para esta operação.' : message;
    case '23505':
    case '23P01':
      // Mensagens das RPCs já vêm em português; as do banco são traduzidas pelo nome da restrição.
      if (!TECHNICAL.test(message)) return message;
      return UNIQUE_MESSAGES.find(([pattern]) => pattern.test(message))?.[1] ?? 'Já existe um registro com estes dados.';
    case '23503':
      return 'Este registro tem histórico vinculado e não pode ser excluído. Desative-o em vez disso.';
    case '22P02':
      return 'Algum valor está em formato inválido.';
    case '57014':
      return 'A operação demorou demais. Tente novamente.';
    default:
      break;
  }
  if (TECHNICAL.test(message)) return 'Não foi possível concluir a operação. Confira os dados e tente novamente.';
  return message;
}
