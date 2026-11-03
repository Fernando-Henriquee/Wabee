import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, TestEnv } from './env';

/** Orçamentos: questionário → análise → proposta → pedido, com retomada de quem não respondeu. */

let env: TestEnv;
let dono: string;
let leitura: string;
let producao: string;
let direct: number;
let pla: number;

const rid = () => crypto.randomUUID();
/** O driver devolve colunas date como Date (meia-noite UTC). */
const day = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value));
const plusDays = (days: number) => env.admin().one<{ d: string }>(`select (private.today() + $1::integer)::text d`, [days]).then((r) => r.d);
const quote = (id: number) => env.as(dono, (s) => s.one<Record<string, unknown>>(`select * from public.v_quotes where id = $1`, [id]));
const events = (id: number) => env.as(dono, (s) => s.query<{ kind: string; text: string }>(`select kind, text from public.quote_events where quote_id = $1 order by id`, [id]));
const create = (extra: Record<string, unknown> = {}) =>
  env.as(dono, (s) => s.rpc<number>('save_quote', { p_quote: { item_wanted: 'Moto 3D', contact_name: 'João do Instagram', ...extra } }));

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono');
  leitura = await env.createMember('leitura@wabee.test', 'leitura');
  producao = await env.createMember('producao@wabee.test', 'producao');
  await env.as(dono, async (s) => {
    direct = (await s.one<{ id: number }>(`select id from public.sales_channels where name = 'Venda direta'`)).id;
    pla = await s.rpc<number>('save_item', { p_item: { kind: 'FILAMENT', name: 'PLA amarelo', filament: { material: 'PLA', color_name: 'amarelo' } } });
    await s.rpc('create_cost_rate', { p_rate_type: 'OPERATIONAL_PER_HOUR', p_value: 1.2, p_valid_from: '2026-01-01' });
    await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: pla, p_entries: [{ qty: 1000, unit_cost: 0.1 }] });
  });
});

afterAll(async () => {
  await env.close();
});

describe('anotar o orçamento (questionário)', () => {
  it('só o que foi pedido é obrigatório; nasce NOVO com número e linha do tempo', async () => {
    const id = await env.as(dono, (s) => s.rpc<number>('save_quote', { p_quote: { item_wanted: '  Moto 3D  ' } }));
    const q = await quote(id);
    expect(q.number).toMatch(/^ORC-\d{4}-0001$/);
    expect(q).toMatchObject({ status: 'NOVO', item_wanted: 'Moto 3D', qty: 1, is_open: true, follow_up_due: false, display_name: null });
    expect((await events(id)).map((e) => e.kind)).toEqual(['NOTA']);
    await expect(env.as(dono, (s) => s.rpc('save_quote', { p_quote: { item_wanted: '   ' } }))).rejects.toThrow(/o que a pessoa pediu/);
  });

  it('guarda tamanho, cor, contato, prazo e referências; contato pode vir do cliente cadastrado', async () => {
    const customer = await env.as(dono, (s) => s.rpc<number>('save_customer', { p_customer: { name: 'Maria', phone: '(11) 98888-7777', instagram: 'maria.3d' } }));
    const id = await create({
      customer_id: customer, contact_name: null, size_text: '20 cm', color_text: 'vermelha e preta', qty: 2, source: 'INSTAGRAM',
      desired_date: '2026-12-20', reference_links: 'https://exemplo.com/moto', reference_photo_paths: ['quotes/ref-1.jpg'],
    });
    expect(await quote(id)).toMatchObject({
      size_text: '20 cm', color_text: 'vermelha e preta', qty: 2, source: 'INSTAGRAM', display_name: 'Maria', phone: '(11) 98888-7777', instagram: 'maria.3d',
      reference_photo_paths: ['quotes/ref-1.jpg'],
    });
  });

  it('recusa foto de referência fora da pasta quotes/, mais de 3 fotos e cliente inexistente', async () => {
    await expect(create({ reference_photo_paths: ['products/x.jpg'] })).rejects.toThrow(/inválido/);
    await expect(create({ reference_photo_paths: ['quotes/1.jpg', 'quotes/2.jpg', 'quotes/3.jpg', 'quotes/4.jpg'] })).rejects.toThrow(/no máximo 3/);
    await expect(create({ customer_id: 99999 })).rejects.toThrow(/Cliente não encontrado/);
  });

  it('edita o questionário enquanto o orçamento está aberto', async () => {
    const id = await create({ size_text: '10 cm' });
    await env.as(dono, (s) => s.rpc('save_quote', { p_quote: { id, item_wanted: 'Moto 3D esportiva', size_text: '15 cm', qty: 3 } }));
    expect(await quote(id)).toMatchObject({ item_wanted: 'Moto 3D esportiva', size_text: '15 cm', qty: 3 });
  });

  it('só o dono grava; leitura vê, produção não vê', async () => {
    await expect(env.as(leitura, (s) => s.rpc('save_quote', { p_quote: { item_wanted: 'x' } }))).rejects.toThrow(/permissão/);
    expect((await env.as(leitura, (s) => s.query(`select 1 from public.v_quotes`))).length).toBeGreaterThan(0);
    expect(await env.as(producao, (s) => s.query(`select 1 from public.v_quotes`))).toEqual([]);
  });
});

describe('análise e proposta', () => {
  const analysis = () => ({ name: 'Moto 3D', units_per_plate: 1, est_print_minutes_per_plate: 150, lines: [{ item_id: pla, qty_per_unit: 30 }] });

  it('analyze_quote guarda a ficha, calcula custo e preço sugerido e não cria produto', async () => {
    const id = await create();
    const before = await env.admin().one<{ c: number }>(`select count(*)::int c from public.products`);
    const r = await env.as(dono, (s) => s.rpc<{ preview: { unit_cost: number; suggested_price: number } }>('analyze_quote', { p_quote_id: id, p_analysis: { ...analysis(), channel_id: direct } }));
    expect(n(r.preview.unit_cost)).toBe(6); // 30 g × 0,10 + 2,5 h × 1,20
    expect(n(r.preview.suggested_price)).toBe(8.57);
    expect(await quote(id)).toMatchObject({ status: 'EM_ANALISE' });
    expect(((await quote(id)).analysis as { name: string }).name).toBe('Moto 3D');
    expect((await env.admin().one<{ c: number }>(`select count(*)::int c from public.products`)).c).toBe(before.c);
  });

  it('ficha ainda sem filamento é guardada como rascunho, sem cálculo', async () => {
    const id = await create();
    const r = await env.as(dono, (s) => s.rpc<{ preview: unknown }>('analyze_quote', { p_quote_id: id, p_analysis: { name: 'Moto', lines: [] } }));
    expect(r.preview).toBeNull();
    expect((await quote(id)).cost_estimate).toBeNull();
  });

  it('send_quote grava o preço por peça, a validade e agenda o primeiro retorno pelo intervalo da empresa', async () => {
    const id = await create({ qty: 2 });
    const validUntil = await plusDays(10);
    await env.as(dono, (s) => s.rpc('send_quote', { p_quote_id: id, p_unit_price: 35.5, p_valid_until: validUntil, p_description: 'Moto em PLA vermelho' }));
    const q = await quote(id);
    expect(q).toMatchObject({ status: 'PROPOSTA_ENVIADA', proposal_description: 'Moto em PLA vermelho', follow_up_due: false });
    expect(n(q.quoted_unit_price as number)).toBe(35.5);
    expect(n(q.quoted_total as number)).toBe(71);
    expect(day(q.follow_up_at)).toBe(await plusDays(7));
    expect((await events(id)).at(-1)).toEqual({ kind: 'PRECO', text: 'Proposta enviada: R$ 35,50 por peça (2 peças).' });
  });

  it('exige preço maior que zero e validade futura', async () => {
    const id = await create();
    await expect(env.as(dono, (s) => s.rpc('send_quote', { p_quote_id: id, p_unit_price: 0 }))).rejects.toThrow(/preço/);
    await expect(env.as(dono, (s) => s.rpc('send_quote', { p_quote_id: id, p_unit_price: 10, p_valid_until: '2020-01-01' }))).rejects.toThrow(/validade/);
  });
});

describe('retomar quem não respondeu', () => {
  it('log_quote_contact conta o contato e reagenda; set_quote_follow_up só adia', async () => {
    const id = await create();
    await env.as(dono, (s) => s.rpc('send_quote', { p_quote_id: id, p_unit_price: 20 }));
    await env.as(dono, (s) => s.rpc('log_quote_contact', { p_quote_id: id, p_note: 'Chamei no WhatsApp, vai ver com a esposa.' }));
    let q = await quote(id);
    expect(q).toMatchObject({ follow_up_count: 1 });
    expect(day(q.follow_up_at)).toBe(await plusDays(7));
    const inThreeDays = await plusDays(3);
    await env.as(dono, (s) => s.rpc('set_quote_follow_up', { p_quote_id: id, p_date: inThreeDays }));
    q = await quote(id);
    expect(q).toMatchObject({ follow_up_count: 1 });
    expect(day(q.follow_up_at)).toBe(inThreeDays);
    const last = (await events(id)).at(-2);
    expect(last?.kind).toBe('CONTATO');
    expect(last?.text).toContain('vai ver com a esposa');
  });

  it('o intervalo padrão vem de Configurações e o retorno vencido aparece como "para retomar"', async () => {
    await env.as(dono, (s) => s.rpc('save_settings', { p_settings: { quote_followup_days: 3 } }));
    const id = await create();
    await env.as(dono, (s) => s.rpc('log_quote_contact', { p_quote_id: id }));
    expect(day((await quote(id)).follow_up_at)).toBe(await plusDays(3));
    await env.admin().query(`update public.quote_requests set follow_up_at = private.today() - 1 where id = $1`, [id]);
    expect(await quote(id)).toMatchObject({ follow_up_due: true });
    await env.as(dono, (s) => s.rpc('save_settings', { p_settings: { quote_followup_days: 7 } }));
  });

  it('não aceita retorno no passado', async () => {
    const id = await create();
    await expect(env.as(dono, (s) => s.rpc('log_quote_contact', { p_quote_id: id, p_next_follow_up: '2020-01-01' }))).rejects.toThrow(/passado/);
    await expect(env.as(dono, (s) => s.rpc('set_quote_follow_up', { p_quote_id: id, p_date: '2020-01-01' }))).rejects.toThrow(/hoje em diante/);
  });
});

describe('perder, reabrir e anotar', () => {
  it('perder exige motivo; fica fora da retomada; reabrir limpa o motivo', async () => {
    const id = await create();
    await env.as(dono, (s) => s.rpc('send_quote', { p_quote_id: id, p_unit_price: 50 }));
    await expect(env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: id, p_status: 'PERDIDO' }))).rejects.toThrow(/motivo/);
    await env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: id, p_status: 'PERDIDO', p_reason: 'SUMIU', p_note: 'Não respondeu 4 vezes' }));
    let q = await quote(id);
    expect(q).toMatchObject({ status: 'PERDIDO', lost_reason: 'SUMIU', is_open: false, follow_up_at: null });
    expect(q.closed_at).not.toBeNull();
    await expect(env.as(dono, (s) => s.rpc('log_quote_contact', { p_quote_id: id }))).rejects.toThrow(/encerrado/);
    await env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: id, p_status: 'PROPOSTA_ENVIADA' }));
    q = await quote(id);
    expect(q).toMatchObject({ status: 'PROPOSTA_ENVIADA', lost_reason: null, closed_at: null, is_open: true });
    expect(q.follow_up_at).not.toBeNull();
  });

  it('não marca proposta enviada sem preço e recusa status inválido', async () => {
    const id = await create();
    await expect(env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: id, p_status: 'PROPOSTA_ENVIADA' }))).rejects.toThrow(/preço/);
    await expect(env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: id, p_status: 'XYZ' }))).rejects.toThrow(/inválido/);
  });

  it('anotação entra na linha do tempo', async () => {
    const id = await create();
    await env.as(dono, (s) => s.rpc('add_quote_note', { p_quote_id: id, p_text: 'Quer cor metálica' }));
    expect((await events(id)).at(-1)).toEqual({ kind: 'NOTA', text: 'Quer cor metálica' });
    await expect(env.as(dono, (s) => s.rpc('add_quote_note', { p_quote_id: id, p_text: '  ' }))).rejects.toThrow(/anotação/);
  });
});

describe('virar pedido', () => {
  it('criar o pedido com quote_id fecha o orçamento como GANHO, guarda o pedido e liga o cliente', async () => {
    const id = await create({ contact_name: 'Carla', contact_phone: '11977776666' });
    await env.as(dono, (s) => s.rpc('send_quote', { p_quote_id: id, p_unit_price: 40 }));
    const item = await env.as(dono, (s) =>
      s.rpc<{ variant_id: number }>('create_custom_item', {
        p_request_id: rid(), p_item: { name: 'Moto 3D', est_print_minutes_per_plate: 150, unit_price: 40, lines: [{ item_id: pla, qty_per_unit: 30 }] },
      }),
    );
    const order = await env.as(dono, (s) =>
      s.rpc<{ order_id: number; number: string }>('create_order', {
        p_request_id: rid(),
        p_order: {
          kind: 'ENCOMENDA', channel_id: direct, quote_id: id, new_customer: { name: 'Carla', phone: '11977776666' },
          lines: [{ variant_id: item.variant_id, qty: 1, unit_price: 40 }],
        },
      }),
    );
    const q = await quote(id);
    expect(q).toMatchObject({ status: 'GANHO', order_id: order.order_id, order_number: order.number, is_open: false, follow_up_at: null });
    expect(q.customer_id).not.toBeNull();
    expect((await events(id)).at(-1)?.text).toBe(`Virou o pedido ${order.number}.`);
    await expect(env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: id, p_status: 'NOVO' }))).rejects.toThrow(/já virou pedido/);
  });

  it('um orçamento não vira dois pedidos', async () => {
    const id = await create();
    const line = { qty: 1, unit_price: 10, custom_description: 'Peça avulsa' };
    const input = () => ({ p_request_id: rid(), p_order: { kind: 'ENCOMENDA', channel_id: direct, quote_id: id, lines: [line] } });
    await env.as(dono, (s) => s.rpc('create_order', input()));
    await expect(env.as(dono, (s) => s.rpc('create_order', input()))).rejects.toThrow(/já virou o pedido/);
  });

  it('pedido sem quote_id continua igual', async () => {
    const r = await env.as(dono, (s) =>
      s.rpc<{ status: string }>('create_order', { p_request_id: rid(), p_order: { kind: 'ENCOMENDA', channel_id: direct, lines: [{ qty: 1, unit_price: 5, custom_description: 'Avulso' }] } }),
    );
    expect(r.status).toBe('RASCUNHO');
  });
});

describe('funil e resumo (Visão geral)', () => {
  it('conta anotados, propostas, ganhos e perdas por motivo no período e resume o que pede ação', async () => {
    await env.admin().query(`delete from public.quote_events`);
    await env.admin().query(`delete from public.quote_requests`);
    const a = await create({ item_wanted: 'A' });
    const b = await create({ item_wanted: 'B' });
    const c = await create({ item_wanted: 'C' });
    await create({ item_wanted: 'D' });
    for (const id of [a, b, c]) await env.as(dono, (s) => s.rpc('send_quote', { p_quote_id: id, p_unit_price: 100, p_description: null }));
    await env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: a, p_status: 'PERDIDO', p_reason: 'PRECO' }));
    await env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: b, p_status: 'PERDIDO', p_reason: 'SUMIU' }));
    await env.as(dono, (s) => s.rpc('set_quote_status', { p_quote_id: c, p_status: 'GANHO' }));
    const from = (await env.admin().one<{ d: string }>(`select (private.today() - 7)::text d`)).d;
    const to = (await env.admin().one<{ d: string }>(`select (private.today() + 1)::text d`)).d;
    const f = await env.as(dono, (s) =>
      s.rpc<{ created: number; proposals: number; won: number; won_value: number; lost: number; conversion: number; lost_by_reason: Array<{ reason: string; count: number }> }>('quote_funnel', { p_from: from, p_to: to }),
    );
    expect(f).toMatchObject({ created: 4, proposals: 3, won: 1, lost: 2 });
    expect(n(f.won_value)).toBe(100);
    expect(n(f.conversion)).toBe(0.3333);
    expect(f.lost_by_reason.map((r) => r.reason).sort()).toEqual(['PRECO', 'SUMIU']);

    await env.admin().query(`update public.quote_requests set follow_up_at = private.today() - 2 where item_wanted = 'D'`);
    const summary = await env.as(dono, (s) => s.rpc<{ open: number; to_analyze: number; due: number; overdue: number; open_value: number }>('quote_summary', {}));
    expect(summary).toMatchObject({ open: 1, to_analyze: 1, due: 1, overdue: 1 });
    expect(n(summary.open_value)).toBe(0);
    await expect(env.as(producao, (s) => s.rpc('quote_summary', {}))).rejects.toThrow(/permissão/);
  });
});

describe('PIX e reset', () => {
  it('a chave PIX é cadastrável em Configurações', async () => {
    const initial = await env.as(dono, (s) => s.one<{ pix_key: string; pix_key_type: string }>(`select pix_key, pix_key_type from public.settings`));
    expect(initial).toEqual({ pix_key: 'storewabee@gmail.com', pix_key_type: 'EMAIL' });
    await env.as(dono, (s) => s.rpc('save_settings', { p_settings: { pix_key: '11999990000', pix_key_type: 'TELEFONE', pix_holder: 'Wabee 3D' } }));
    expect(await env.as(dono, (s) => s.one(`select pix_key, pix_key_type, pix_holder from public.settings`))).toEqual({ pix_key: '11999990000', pix_key_type: 'TELEFONE', pix_holder: 'Wabee 3D' });
    await env.as(dono, (s) => s.rpc('save_settings', { p_settings: { pix_key: '' } }));
    expect((await env.as(dono, (s) => s.one<{ pix_key: string | null }>(`select pix_key from public.settings`))).pix_key).toBeNull();
    await expect(env.as(leitura, (s) => s.rpc('save_settings', { p_settings: { pix_key: 'x' } }))).rejects.toThrow(/permissão/);
    await expect(env.as(dono, (s) => s.rpc('save_settings', { p_settings: { pix_key_type: 'OUTRO' } }))).rejects.toThrow();
  });

  it('o reset apaga os orçamentos e a numeração recomeça', async () => {
    await env.as(dono, (s) => s.rpc('reset_system', { p_confirm: 'APAGAR TUDO' }));
    expect((await env.admin().one<{ c: number }>(`select count(*)::int c from public.quote_requests`)).c).toBe(0);
    expect((await env.admin().one<{ c: number }>(`select count(*)::int c from public.quote_events`)).c).toBe(0);
    expect((await quote(await create())).number).toMatch(/-0001$/);
  });
});
