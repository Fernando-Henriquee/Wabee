import { describe, expect, it } from 'vitest';
import { signUpSchema } from './signup-page';

const valid = { name: 'Maria Silva', company: 'Oficina 3D', email: 'maria@exemplo.com', password: 'senha1234', confirm: 'senha1234' };

describe('cadastro (criar conta)', () => {
  it('aceita dados completos e limpa espaços', () => {
    const parsed = signUpSchema.parse({ ...valid, name: '  Maria Silva ', company: ' Oficina 3D ', email: ' maria@exemplo.com ' });
    expect(parsed).toMatchObject({ name: 'Maria Silva', company: 'Oficina 3D', email: 'maria@exemplo.com' });
  });

  it('exige nome, empresa e e-mail válidos', () => {
    expect(signUpSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, company: '' }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, email: 'sem-arroba' }).success).toBe(false);
  });

  it('segue as regras de senha do Supabase: 8+ caracteres, com letras e números', () => {
    for (const password of ['curta1', 'somenteletras', '123456789']) {
      expect(signUpSchema.safeParse({ ...valid, password, confirm: password }).success, password).toBe(false);
    }
  });

  it('as senhas precisam conferir', () => {
    const result = signUpSchema.safeParse({ ...valid, confirm: 'outra-senha1' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['confirm']);
  });
});
