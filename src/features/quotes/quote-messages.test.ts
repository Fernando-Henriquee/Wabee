import { describe, expect, it } from 'vitest';
import { firstName, followUpTemplates, pixBlock, priceLine, proposalMessage, type QuoteMessageContext } from './quote-messages';

const ctx: QuoteMessageContext = {
  name: 'João da Silva',
  item: 'Moto 3D',
  qty: 1,
  size: '20 cm',
  color: 'vermelha',
  description: 'Moto esportiva em PLA, com acabamento liso.',
  unitPrice: 35.5,
  validUntil: '2026-11-10',
  company: 'Wabee',
  pix: { key: 'storewabee@gmail.com', type: 'EMAIL', holder: null },
};

describe('proposalMessage', () => {
  it('monta a proposta com valor, validade e o PIX em linha própria', () => {
    const text = proposalMessage(ctx);
    expect(text).toContain('Oi, João! Aqui é da Wabee.');
    expect(text).toContain('Segue o orçamento: Moto 3D.');
    expect(text).toContain('Tamanho: 20 cm · Cor: vermelha');
    expect(text).toContain('Valor combinado: R$ 35,50');
    expect(text).toContain('Válido até 10/11/2026.');
    expect(text).toContain('Pagamento via PIX:\nstorewabee@gmail.com');
    expect(text).not.toContain('(E-mail');
  });

  it('com várias peças mostra o valor de cada e o total', () => {
    expect(proposalMessage({ ...ctx, qty: 3, unitPrice: 33.33 })).toContain('Valor combinado: R$ 33,33 cada (3 peças = R$ 99,99)');
  });

  it('sem chave PIX não traz o bloco de pagamento', () => {
    expect(proposalMessage({ ...ctx, pix: null })).not.toContain('PIX');
    expect(proposalMessage({ ...ctx, pix: { key: '  ', type: 'EMAIL', holder: null } })).not.toContain('PIX');
  });

  it('sem nome nem validade, a proposta continua completa', () => {
    const text = proposalMessage({ ...ctx, name: null, validUntil: null });
    expect(text.startsWith('Oi! Aqui é da Wabee.')).toBe(true);
    expect(text).not.toContain('Válido até');
  });
});

describe('pixBlock', () => {
  it('traz só a chave (telefone formatado para pagamento), sem tipo nem titular', () => {
    expect(pixBlock({ key: '(11) 98888-7777', type: 'TELEFONE', holder: 'Wabee 3D' })).toBe('Pagamento via PIX:\n+5511988887777');
    expect(pixBlock(null)).toBeNull();
  });
});

describe('mensagens de retomada', () => {
  it('com proposta, citam o valor e a validade', () => {
    const [interest, hold, cheaper] = followUpTemplates(ctx);
    expect(interest!.text).toContain('O valor era R$ 35,50 (válido até 10/11/2026)');
    expect(hold!.text).toContain('segurar o valor de R$ 35,50');
    expect(cheaper!.text).toContain('versão mais em conta');
  });

  it('sem proposta, pedem os detalhes que faltam', () => {
    const templates = followUpTemplates({ ...ctx, unitPrice: null });
    expect(templates.map((t) => t.id)).toEqual(['info', 'interest']);
    expect(templates[0]!.text).toContain('tamanho e cor');
  });
});

describe('helpers', () => {
  it('primeiro nome e linha de preço', () => {
    expect(firstName('  Maria  Souza')).toBe('Maria');
    expect(firstName(null)).toBe('');
    expect(priceLine(10, 1)).toBe('R$ 10,00');
  });
});
