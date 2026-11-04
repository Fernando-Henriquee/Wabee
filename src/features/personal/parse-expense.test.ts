import { describe, expect, it } from 'vitest';
import { digitize, learnableWords, parseBrNumber, parseSpoken, type ParseContext, tokenize } from './parse-expense';

// 2026-11-04 é uma quarta-feira.
const ctx: ParseContext = {
  today: '2026-11-04',
  categories: [
    { id: 1, name: 'Mercado', kind: 'GASTO', keywords: ['mercado', 'supermercado', 'feira', 'padaria'] },
    { id: 2, name: 'Transporte', kind: 'GASTO', keywords: ['uber', '99', 'gasolina', 'onibus'] },
    { id: 3, name: 'Alimentação fora', kind: 'GASTO', keywords: ['ifood', 'restaurante', 'lanche', 'pizza'] },
    { id: 4, name: 'Moradia', kind: 'GASTO', keywords: ['aluguel', 'luz', 'agua', 'internet'] },
    { id: 5, name: 'Saúde', kind: 'GASTO', keywords: ['farmacia', 'remedio', 'dentista'] },
    { id: 6, name: 'Lazer', kind: 'GASTO', keywords: ['cinema', 'bar'] },
    { id: 7, name: 'Salário', kind: 'ENTRADA', keywords: ['salario'] },
    { id: 8, name: 'Extra', kind: 'ENTRADA', keywords: ['extra', 'freela', 'venda'] },
  ],
  accounts: [
    { id: 10, name: 'Conta principal', kind: 'CONTA' },
    { id: 11, name: 'Nubank', kind: 'CARTAO' },
    { id: 12, name: 'Carteira', kind: 'CARTEIRA' },
  ],
};

const one = (text: string, c: ParseContext = ctx) => {
  const list = parseSpoken(text, c);
  expect(list).toHaveLength(1);
  return list[0]!;
};

describe('números por extenso', () => {
  const words = (text: string) => digitize(tokenize(text)).join(' ');

  it('converte dezenas, centenas e milhares', () => {
    expect(words('quarenta e cinco reais')).toBe('45 reais');
    expect(words('cento e cinquenta')).toBe('150');
    expect(words('duzentos e trinta e dois')).toBe('232');
    expect(words('mil e duzentos reais')).toBe('1200 reais');
    expect(words('dois mil e quinhentos')).toBe('2500');
    expect(words('mil')).toBe('1000');
    expect(words('dezenove reais')).toBe('19 reais');
  });

  it('não confunde artigo com número', () => {
    expect(words('comprei um tenis')).toBe('comprei um tenis');
    expect(words('um real')).toBe('1 real');
    expect(words('paguei uma conta')).toBe('paguei uma conta');
  });

  it('separa dois números seguidos que não formam um só', () => {
    expect(words('quarenta e cinco e noventa')).toBe('45 e 90');
  });

  it('lê números no formato brasileiro', () => {
    expect(parseBrNumber('1.200,50')).toBe(1200.5);
    expect(parseBrNumber('1.200')).toBe(1200);
    expect(parseBrNumber('45.90')).toBe(45.9);
    expect(parseBrNumber('45,9')).toBe(45.9);
    expect(parseBrNumber('45')).toBe(45);
  });
});

describe('um gasto', () => {
  it('valor, categoria e descrição de uma frase simples', () => {
    expect(one('gastei 45 reais no mercado')).toMatchObject({ kind: 'GASTO', amount: 45, categoryId: 1, description: 'Mercado', date: '2026-11-04', uncertain: [] });
  });

  it('valor por extenso', () => {
    expect(one('gastei quarenta e cinco reais no mercado')).toMatchObject({ amount: 45, categoryId: 1 });
    expect(one('paguei mil e duzentos reais de aluguel')).toMatchObject({ amount: 1200, categoryId: 4, description: 'Aluguel' });
  });

  it('centavos de várias formas', () => {
    expect(one('gastei 45,90 na padaria').amount).toBe(45.9);
    expect(one('R$ 45,90 farmácia').amount).toBe(45.9);
    expect(one('gastei 45 reais e 90 centavos na farmácia')).toMatchObject({ amount: 45.9, categoryId: 5 });
    expect(one('gastei 45 e 90 centavos no mercado').amount).toBe(45.9);
    expect(one('gastei 1.250,00 no dentista').amount).toBe(1250);
  });

  it('descrição sem os verbos e preposições', () => {
    expect(one('paguei 120 de luz')).toMatchObject({ amount: 120, categoryId: 4, description: 'Luz' });
    expect(one('gastei 32 com pizza no ifood')).toMatchObject({ amount: 32, categoryId: 3, description: 'Pizza ifood' });
  });

  it('categoria no plural e palavra-chave com mais de uma palavra', () => {
    expect(one('comprei remédios por 80')).toMatchObject({ amount: 80, categoryId: 5 });
    const c = { ...ctx, categories: [...ctx.categories, { id: 9, name: 'Assinaturas', kind: 'GASTO' as const, keywords: ['amazon prime', 'netflix'] }] };
    expect(one('paguei 14,90 do amazon prime', c)).toMatchObject({ amount: 14.9, categoryId: 9 });
  });

  it('sem categoria conhecida fica em dúvida', () => {
    expect(one('gastei 30 num negócio qualquer')).toMatchObject({ amount: 30, categoryId: null, uncertain: ['category'] });
  });

  it('sem valor fica em dúvida, mantendo o texto', () => {
    const e = one('fui ao mercado');
    expect(e.amount).toBeNull();
    expect(e.uncertain).toEqual(['amount']);
    expect(e.categoryId).toBe(1);
  });

  it('"sexta-feira" não vira a categoria Mercado', () => {
    expect(one('gastei 50 na sexta-feira no bar')).toMatchObject({ categoryId: 6, date: '2026-10-30' });
  });
});

describe('datas', () => {
  it('hoje, ontem e anteontem', () => {
    expect(one('gastei 10 no mercado hoje').date).toBe('2026-11-04');
    expect(one('gastei 10 no mercado ontem').date).toBe('2026-11-03');
    expect(one('gastei 10 no mercado anteontem').date).toBe('2026-11-02');
  });

  it('dia do mês (mês atual ou anterior se ainda não chegou)', () => {
    expect(one('gastei 10 no mercado dia 2').date).toBe('2026-11-02');
    expect(one('gastei 10 no mercado dia 28').date).toBe('2026-10-28');
    expect(one('gastei 10 no mercado dia 31').date).toBe('2026-10-31');
  });

  it('dia da semana: o mais recente, e "passada" volta uma semana quando é hoje', () => {
    expect(one('gastei 10 no mercado na sexta').date).toBe('2026-10-30');
    expect(one('gastei 10 no mercado domingo').date).toBe('2026-11-01');
    expect(one('gastei 10 no mercado quarta').date).toBe('2026-11-04');
    expect(one('gastei 10 no mercado quarta passada').date).toBe('2026-10-28');
  });

  it('dia que o mês anterior não tem cai no último dia dele', () => {
    expect(one('gastei 10 no mercado dia 31', { ...ctx, today: '2026-03-05' }).date).toBe('2026-02-28');
  });
});

describe('conta e entradas', () => {
  it('reconhece a conta pelo nome e por apelidos', () => {
    expect(one('gastei 50 no mercado no nubank').accountId).toBe(11);
    expect(one('gastei 50 no mercado no cartão').accountId).toBe(11);
    expect(one('gastei 50 no mercado em dinheiro').accountId).toBe(12);
    expect(one('gastei 50 no mercado').accountId).toBeNull();
  });

  it('o nome da conta não vai para a descrição', () => {
    expect(one('gastei 50 na padaria no nubank').description).toBe('Padaria');
  });

  it('recebimentos viram entrada', () => {
    expect(one('recebi 3000 de salário')).toMatchObject({ kind: 'ENTRADA', amount: 3000, categoryId: 7 });
    expect(one('ganhei 200 num freela')).toMatchObject({ kind: 'ENTRADA', amount: 200, categoryId: 8 });
  });
});

describe('vários gastos numa frase', () => {
  it('separa em "e"', () => {
    const list = parseSpoken('gastei 20 na padaria e 50 de uber', ctx);
    expect(list.map((e) => [e.amount, e.categoryId])).toEqual([[20, 1], [50, 2]]);
  });

  it('separa por vírgula e leva a data para o trecho certo', () => {
    const list = parseSpoken('gastei 20 no mercado, 35 de gasolina ontem', ctx);
    expect(list.map((e) => [e.amount, e.categoryId, e.date])).toEqual([[20, 1, '2026-11-04'], [35, 2, '2026-11-03']]);
  });

  it('separa sem conector quando há dois valores com moeda', () => {
    const list = parseSpoken('20 reais padaria 50 reais uber', ctx);
    expect(list.map((e) => [e.amount, e.categoryId])).toEqual([[20, 1], [50, 2]]);
  });

  it('três gastos', () => {
    const list = parseSpoken('gastei 10 no ônibus, 25 na farmácia e 80 no restaurante', ctx);
    expect(list.map((e) => [e.amount, e.categoryId])).toEqual([[10, 2], [25, 5], [80, 3]]);
  });
});

describe('parcelado', () => {
  it('valor de cada parcela informado', () => {
    expect(one('comprei um tênis em 3x de 100')).toMatchObject({ amount: 100, installments: { count: 3, amount: 100 } });
  });

  it('valor total informado: divide pelas parcelas', () => {
    expect(one('comprei um tênis de 300 em 3 vezes')).toMatchObject({ amount: 300, installments: { count: 3, amount: 100 } });
  });

  it('a quantidade de parcelas não é outro gasto', () => {
    expect(parseSpoken('geladeira 1200 em 12x', ctx)).toHaveLength(1);
  });
});

describe('aprendizado', () => {
  it('palavra aprendida vence as palavras-chave', () => {
    const learned = { ...ctx, learned: [{ word: 'pizzaria', category_id: 6 }] };
    expect(one('gastei 60 na pizzaria', learned).categoryId).toBe(6);
    expect(one('gastei 60 na pizza', learned).categoryId).toBe(3);
  });
});

describe('texto vazio', () => {
  it('não devolve nada', () => {
    expect(parseSpoken('   ', ctx)).toEqual([]);
  });
});

describe('quantidade não é valor', () => {
  it('"2 camisas por 80" é um gasto de 80', () => {
    expect(one('comprei 2 camisas por 80')).toMatchObject({ amount: 80 });
  });

  it('palavras para ensinar ao interpretador', () => {
    expect(learnableWords('Pizzaria do Zé')).toEqual(['pizzaria']);
    expect(learnableWords('Uber para o trabalho')).toEqual(['uber', 'trabalho']);
  });
});
