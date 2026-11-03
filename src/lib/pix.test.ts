import { describe, expect, it } from 'vitest';
import { pixKeyForPayment, pixKeyProblem } from './pix';

describe('pixKeyProblem', () => {
  it('aceita chaves válidas e vazia', () => {
    expect(pixKeyProblem('EMAIL', 'storewabee@gmail.com')).toBeNull();
    expect(pixKeyProblem('TELEFONE', '(11) 98888-7777')).toBeNull();
    expect(pixKeyProblem('CPF_CNPJ', '123.456.789-09')).toBeNull();
    expect(pixKeyProblem('CPF_CNPJ', '12.345.678/0001-95')).toBeNull();
    expect(pixKeyProblem('ALEATORIA', '123e4567-e89b-12d3-a456-426614174000')).toBeNull();
    expect(pixKeyProblem('EMAIL', '  ')).toBeNull();
  });

  it('recusa chave que não combina com o tipo', () => {
    expect(pixKeyProblem('EMAIL', 'sem-arroba')).toMatch(/e-mail/);
    expect(pixKeyProblem('TELEFONE', '1234')).toMatch(/DDD/);
    expect(pixKeyProblem('CPF_CNPJ', '12345')).toMatch(/CPF/);
    expect(pixKeyProblem('ALEATORIA', 'curta')).toMatch(/32/);
  });
});

describe('pixKeyForPayment', () => {
  it('prefixa o telefone com +55 e mantém os demais tipos', () => {
    expect(pixKeyForPayment('TELEFONE', '(11) 98888-7777')).toBe('+5511988887777');
    expect(pixKeyForPayment('TELEFONE', '5511988887777')).toBe('+5511988887777');
    expect(pixKeyForPayment('EMAIL', ' a@b.co ')).toBe('a@b.co');
  });
});
