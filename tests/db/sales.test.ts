import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, TestEnv } from './env';

/** Módulo 6 — vendas, reservas, entregas e recebimentos (seção 12). */

let env: TestEnv;
let dono: string;
let bank: number;
let direct: number;
let instagram: number;
let abelha: number;
let abelhaItem: number;
let coracao: number;
let saquinho: number;
let pla: number;
let printer: number;

const rid = () => crypto.randomUUID();

async function balance(itemId: number) {
  return env.admin().one<{ qty_on_hand: string; qty_reserved: string }>(`select * from public.stock_balances where item_id = $1`, [itemId]);
}

async function order(id: number) {
  return env.as(dono, (s) => s.one<Record<string, string | number | null>>(`select * from public.v_sales_orders where id = $1`, [id]));
}

async function sumCode(code: string, source?: string) {
  const row = await env.admin().one<{ s: string }>(
    `select coalesce(sum(e.amount), 0)::text s from public.result_entries e join public.financial_categories c on c.id = e.category_id
     where c.code = $1 and ($2::text is null or e.source_type = $2)`,
    [code, source ?? null],
  );
  return n(row.s);
}

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono');
  await env.admin().query(`update public.settings set go_live_date = '2026-10-21'`);
  await env.as(dono, async (s) => {
    bank = await s.rpc<number>('save_payment_account', { p_account: { name: 'Pix da empresa', kind: 'CARTEIRA', owner: 'EMPRESA' } });
    direct = (await s.one<{ id: number }>(`select id from public.sales_channels where name = 'Venda direta'`)).id;
    instagram = (await s.one<{ id: number }>(`select id from public.sales_channels where name = 'Instagram / WhatsApp'`)).id;
    const product = await s.rpc<number>('save_product', {
      p_product: { name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'amarelo', reference_price: 5 }] },
    });
    const v = await s.one<{ id: number; item_id: number }>(`select id, item_id from public.product_variants where product_id = $1`, [product]);
    abelha = v.id;
    abelhaItem = v.item_id;
    const product2 = await s.rpc<number>('save_product', { p_product: { name: 'Chaveiro Coração', category: 'CHAVEIRO', variants: [{ name: 'preto', reference_price: 4 }] } });
    coracao = (await s.one<{ id: number }>(`select id from public.product_variants where product_id = $1`, [product2])).id;
    saquinho = await s.rpc<number>('save_item', { p_item: { kind: 'PACKAGING', name: 'Saquinho kraft' } });
    pla = await s.rpc<number>('save_item', { p_item: { kind: 'FILAMENT', name: 'PLA amarelo', filament: { material: 'PLA', color_name: 'amarelo' } } });
    printer = await s.rpc<number>('save_equipment', { p_equipment: { name: 'Impressora 1' } });
    await s.rpc('create_cost_rate', { p_rate_type: 'OPERATIONAL_PER_HOUR', p_value: 1.2, p_valid_from: '2026-01-01' });
    await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: saquinho, p_entries: [{ qty: 50, unit_cost: 0.25 }] });
    await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: pla, p_entries: [{ qty: 1000, unit_cost: 0.1 }] });
    await s.rpc('register_opening_balance', {
      p_request_id: rid(), p_item_id: abelhaItem, p_entries: [{ qty: 10, layers: { material: 1.188889, operational: 0.2 } }],
    });
    const bomA = await s.rpc<number>('save_bom_draft', {
      p_bom: { variant_id: abelha, units_per_plate: 10, est_print_minutes_per_plate: 120, lines: [{ item_id: pla, qty_per_unit: 8 }] },
    });
    await s.rpc('activate_bom', { p_bom_id: bomA });
    const bom = await s.rpc<number>('save_bom_draft', {
      p_bom: { variant_id: coracao, units_per_plate: 10, est_print_minutes_per_plate: 100, lines: [{ item_id: pla, qty_per_unit: 6 }, { item_id: saquinho, qty_per_unit: 1 }] },
    });
    await s.rpc('activate_bom', { p_bom_id: bom });
  });
});

afterAll(async () => {
  await env.close();
});

describe('primeira venda da Wabee (12.3, US-6.11)', () => {
  it('2 × R$ 5,00 com custo informado de R$ 1,66 → margem R$ 6,68 (66,8%), sem movimentar estoque', async () => {
    const result = await env.as(dono, (s) =>
      s.rpc<{ order_id: number; total: number; cogs: number }>('register_historical_sale', {
        p_request_id: rid(),
        p_sale: { date: '2026-10-20', channel_id: direct, lines: [{ custom_description: 'Peça (antes do sistema)', qty: 2, unit_price: 5, unit_cost: 1.66 }] },
      }),
    );
    expect(n(result.total)).toBe(10);
    expect(n(result.cogs)).toBe(3.32);
    const o = await order(result.order_id);
    expect(o.status).toBe('ENTREGUE');
    expect(o.is_historical).toBe(true);
    expect(n(o.contribution_margin)).toBe(6.68);
    expect(n(o.received_amount)).toBe(10);
    expect(await sumCode('1.1')).toBe(10);
    expect(await sumCode('2.1')).toBe(-3.32);
    const movements = await env.admin().query(`select 1 from public.stock_movements where source_type = 'delivery'`);
    expect(movements).toEqual([]);
  });

  it('só é permitida com data anterior ao início do uso', async () => {
    await expect(
      env.as(dono, (s) =>
        s.rpc('register_historical_sale', { p_request_id: rid(), p_sale: { date: '2026-10-21', channel_id: direct, lines: [{ custom_description: 'x', qty: 1, unit_price: 5, unit_cost: 1 }] } }),
      ),
    ).rejects.toThrow(/antes de 21\/10\/2026/);
  });
});

describe('venda rápida (US-6.3)', () => {
  it('confirma, entrega e recebe numa transação: estoque, embalagem, CMV por camada e taxa da maquininha', async () => {
    const sale = await env.as(dono, (s) =>
      s.rpc<{ order_id: number }>('quick_sale', {
        p_request_id: rid(),
        p_sale: {
          channel_id: instagram, new_customer: { name: 'Maria', instagram: '@maria' },
          lines: [{ variant_id: abelha, qty: 2 }], packaging: [{ item_id: saquinho, qty: 1 }],
          payment: { account_id: bank, fee: 0.2 },
        },
      }),
    );
    const o = await order(sale.order_id);
    expect(o.status).toBe('ENTREGUE');
    expect(n(o.total)).toBe(10); // preço de referência
    expect(n(o.cogs_material)).toBe(2.38);
    expect(n(o.cogs_operational)).toBe(0.4);
    expect(n(o.cogs_total)).toBe(2.78);
    expect(n(o.packaging_cost_total)).toBe(0.25);
    expect(n(o.payment_fee_total)).toBe(0.2);
    // MC = 10 − 2,78 − 0,20 − 0,25 (RN-13)
    expect(n(o.contribution_margin)).toBe(6.77);
    expect(n((await balance(abelhaItem)).qty_on_hand)).toBe(8);
    expect(n((await balance(saquinho)).qty_on_hand)).toBe(49);
    const cash = await env.admin().one<{ amount: string; direction: string }>(`select amount, direction from public.cash_transactions where account_id = $1`, [bank]);
    expect(n(cash.amount)).toBe(9.8);
    expect(cash.direction).toBe('IN');
    expect(await sumCode('3.2')).toBe(-0.2);
    const customer = await env.admin().one<{ name: string; instagram: string }>(`select name, instagram from public.customers where id = $1`, [o.customer_id]);
    expect(customer).toEqual({ name: 'Maria', instagram: '@maria' });
  });

  it('sem saldo livre: bloqueia, oferece encomenda e nada é gravado', async () => {
    const before = await env.admin().one<{ c: number }>(`select count(*)::int c from public.sales_orders`);
    await expect(
      env.as(dono, (s) => s.rpc('quick_sale', { p_request_id: rid(), p_sale: { channel_id: direct, lines: [{ variant_id: abelha, qty: 50 }], packaging: [] } })),
    ).rejects.toThrow(/Transforme a venda em encomenda/);
    const after = await env.admin().one<{ c: number }>(`select count(*)::int c from public.sales_orders`);
    expect(after.c).toBe(before.c);
  });

  it('brinde no pedido: preço zero, sai do estoque e o custo vai para Marketing, não para o CMV (US-6.10)', async () => {
    const cmvBefore = await sumCode('2.1');
    const sale = await env.as(dono, (s) =>
      s.rpc<{ order_id: number }>('quick_sale', {
        p_request_id: rid(),
        p_sale: { channel_id: direct, lines: [{ variant_id: abelha, qty: 1, unit_price: 5 }, { variant_id: abelha, qty: 1, is_gift: true }], packaging: [] },
      }),
    );
    expect(n((await balance(abelhaItem)).qty_on_hand)).toBe(6);
    expect((await sumCode('2.1')) - cmvBefore).toBeCloseTo(-1.19, 2);
    expect(await sumCode('3.5')).toBe(-1.39);
    const o = await order(sale.order_id);
    expect(n(o.total)).toBe(5);
    expect(n(o.open_amount)).toBe(5); // sem pagamento informado: fica a receber
  });
});

describe('encomenda com sinal, reservas e produção (US-6.4, US-6.5, US-5.7)', () => {
  let orderId: number;

  it('50% de sinal + 50% na entrega; reserva o saldo livre e mostra o que falta produzir', async () => {
    const result = await env.as(dono, (s) =>
      s.rpc<{ order_id: number; status: string; missing: Array<{ missing: number }> }>('create_order', {
        p_request_id: rid(),
        p_order: {
          kind: 'ENCOMENDA', channel_id: direct, new_customer: { name: 'Escola Abelhinha', phone: '11999990000' },
          due_date: '2026-11-10', confirm: true,
          lines: [{ variant_id: abelha, qty: 8, unit_price: 4.5 }, { variant_id: coracao, qty: 3, unit_price: 4 }],
          payment_terms: [{ label: 'Sinal', pct: 0.5, due_date: '2026-10-21' }, { label: 'Na entrega', due_date: '2026-11-10' }],
        },
      }),
    );
    orderId = result.order_id;
    expect(result.status).toBe('CONFIRMADO');
    expect(result.missing.map((m) => n(m.missing))).toEqual([2, 3]); // 6 Abelhas livres reservadas; Coração sem estoque
    const insts = await env.admin().query<{ amount: string; due_date: string }>(
      `select i.amount, i.due_date::text from public.installments i join public.sales_orders o on o.receivable_id = i.receivable_id where o.id = $1 order by i.number`,
      [orderId],
    );
    expect(insts.map((i) => [n(i.amount), i.due_date])).toEqual([
      [24, '2026-10-21'],
      [24, '2026-11-10'],
    ]);
    const bal = await balance(abelhaItem);
    expect(n(bal.qty_reserved)).toBe(6);
    // Reservadas não aparecem como livres na venda rápida (US-6.5).
    await expect(
      env.as(dono, (s) => s.rpc('quick_sale', { p_request_id: rid(), p_sale: { channel_id: direct, lines: [{ variant_id: abelha, qty: 1 }], packaging: [] } })),
    ).rejects.toThrow(/insuficiente/);
    // Receita só na entrega: nada lançado ainda para este pedido.
    const entries = await env.admin().query(`select 1 from public.result_entries where source_type = 'delivery' and source_id in (select id from public.deliveries where order_id = $1)`, [orderId]);
    expect(entries).toEqual([]);
  });

  it('produzir a encomenda e liberar as peças reserva automaticamente e deixa o pedido PRONTO', async () => {
    // Abelha: devolve 2 reservas para produzir as 5 que faltam, e libera Coração por impressão.
    const job = await env.as(dono, (s) =>
      s.rpc<{ print_job_id: number }>('produce_order', { p_request_id: rid(), p_order_id: orderId, p_equipment_id: printer }),
    );
    let o = await order(orderId);
    expect(o.status).toBe('EM_PRODUCAO');
    const outs = await env.admin().query<{ id: number; variant_id: number; qty_planned: number }>(
      `select id, variant_id, qty_planned from public.print_job_outputs where print_job_id = $1 order by sort_order`,
      [job.print_job_id],
    );
    expect(outs.map((x) => [x.variant_id, x.qty_planned])).toEqual([[abelha, 2], [coracao, 3]]);
    await env.as(dono, (s) =>
      s.rpc('finish_print_job', {
        p_request_id: rid(), p_print_job_id: job.print_job_id,
        p_result: {
          actual_minutes: 60, materials: [{ item_id: pla, actual_g: 34 }],
          outputs: outs.map((x) => ({ output_id: x.id, qty_good: x.qty_planned, qty_failed: 0 })),
        },
      }),
    ).catch(async (error: Error) => {
      throw error;
    });
    o = await order(orderId);
    expect(o.status).toBe('PRONTO');
    expect(n(o.units_reserved)).toBe(11);
  });

  it('entrega reconhece receita, CMV e embalagem padrão da ficha; recebido o saldo, o pedido fecha', async () => {
    await env.as(dono, (s) => s.rpc('deliver_order', { p_request_id: rid(), p_order_id: orderId, p_delivery: { method: 'ENTREGA_PROPRIA' } }));
    const o = await order(orderId);
    expect(o.status).toBe('ENTREGUE');
    expect(n(o.packaging_cost_total)).toBe(0.75); // 3 Corações × saquinho da ficha
    const delivery = await env.admin().one<{ id: number; revenue: string }>(`select id, revenue from public.deliveries where order_id = $1`, [orderId]);
    expect(n(delivery.revenue)).toBe(48);
    expect(await sumCode('1.1', 'delivery')).toBeGreaterThanOrEqual(48);
    expect(n((await balance(abelhaItem)).qty_reserved)).toBe(0);
    const insts = await env.admin().query<{ id: number }>(
      `select i.id from public.installments i join public.sales_orders o on o.receivable_id = i.receivable_id where o.id = $1 order by i.number`,
      [orderId],
    );
    for (const inst of insts) {
      await env.as(dono, (s) => s.rpc('receive_installment', { p_request_id: rid(), p_installment_id: inst.id, p_received_on: '2026-11-10', p_account_id: bank }));
    }
    expect(n((await order(orderId)).open_amount)).toBe(0);
    expect(await env.admin().query(`select * from private.rebuild_balances()`)).toEqual([]);
  });
});

describe('cancelamento e marketplace', () => {
  beforeAll(async () => {
    // Repõe as Abelhas vendidas nos blocos anteriores (contagem de inventário).
    await env.as(dono, (s) => s.rpc('adjust_stock', { p_request_id: rid(), p_item_id: abelhaItem, p_counted_qty: 10, p_reason: 'Contagem', p_confirm_large: true }));
  });

  it('cancelar libera reservas e o sinal recebido vira devolução a pagar (US-6.8)', async () => {
    const created = await env.as(dono, (s) =>
      s.rpc<{ order_id: number }>('create_order', {
        p_request_id: rid(),
        p_order: { kind: 'ENCOMENDA', channel_id: direct, confirm: true, lines: [{ variant_id: abelha, qty: 2 }],
                   payment_terms: [{ label: 'Sinal', amount: 3, due_date: '2026-10-21' }, { label: 'Saldo' }] },
      }),
    );
    expect(n((await balance(abelhaItem)).qty_reserved)).toBe(2);
    const deposit = await env.admin().one<{ id: number }>(
      `select i.id from public.installments i join public.sales_orders o on o.receivable_id = i.receivable_id where o.id = $1 and i.number = 1`,
      [created.order_id],
    );
    await env.as(dono, (s) => s.rpc('receive_installment', { p_request_id: rid(), p_installment_id: deposit.id, p_received_on: '2026-10-21', p_account_id: bank }));
    const cancel = await env.as(dono, (s) =>
      s.rpc<{ refund_payable_id: number; deposit: number }>('cancel_order', { p_request_id: rid(), p_order_id: created.order_id, p_reason: 'Cliente desistiu' }),
    );
    expect(n(cancel.deposit)).toBe(3);
    expect(cancel.refund_payable_id).toBeTruthy();
    expect(n((await balance(abelhaItem)).qty_reserved)).toBe(0);
    const o = await order(created.order_id);
    expect(o.status).toBe('CANCELADO');
  });

  it('marketplace: vencimento no repasse e valor esperado já sem a taxa do canal (US-6.7)', async () => {
    const market = await env.as(dono, (s) =>
      s.rpc<number>('save_sales_channel', { p_channel: { name: 'Loja online', kind: 'MARKETPLACE', payout_days: 14, fee_pct: 0.2, fee_fixed: 1 } }),
    );
    const created = await env.as(dono, (s) =>
      s.rpc<{ order_id: number }>('create_order', {
        p_request_id: rid(),
        p_order: { kind: 'PRONTA_ENTREGA', channel_id: market, confirm: true, ordered_at: '2026-10-21T10:00:00-03:00', lines: [{ variant_id: abelha, qty: 2, unit_price: 10 }] },
      }),
    );
    const inst = await env.admin().one<{ amount: string; due_date: string }>(
      `select i.amount, i.due_date::text from public.installments i join public.sales_orders o on o.receivable_id = i.receivable_id where o.id = $1`,
      [created.order_id],
    );
    expect(n(inst.amount)).toBe(15); // 20 − (20% × 20 + 1)
    expect(inst.due_date).toBe('2026-11-04');
    await env.as(dono, (s) => s.rpc('deliver_order', { p_request_id: rid(), p_order_id: created.order_id, p_delivery: { method: 'MARKETPLACE', packaging: [] } }));
    expect(await sumCode('3.1', 'delivery')).toBe(-5);
  });
});

describe('correções de 22/10 (embalagem por pedido, crédito sem cliente, divisão da taxa)', () => {
  it('entrega sem embalagens informadas aplica a embalagem padrão por pedido uma única vez', async () => {
    await env.as(dono, (s) => s.rpc('save_settings', { p_settings: { default_order_packaging_item_id: saquinho } }));
    await env.as(dono, (s) => s.rpc('adjust_stock', { p_request_id: rid(), p_item_id: abelhaItem, p_counted_qty: 10, p_reason: 'Contagem', p_confirm_large: true }));
    const created = await env.as(dono, (s) =>
      s.rpc<{ order_id: number }>('create_order', {
        p_request_id: rid(),
        p_order: { kind: 'PRONTA_ENTREGA', channel_id: direct, confirm: true, lines: [{ variant_id: abelha, qty: 2, unit_price: 5 }] },
      }),
    );
    const line = await env.admin().one<{ id: number }>(`select id from public.sales_order_lines where order_id = $1`, [created.order_id]);
    const packaging = () =>
      env.admin().query<{ item_id: number; qty: string }>(`select item_id, qty from public.order_packaging where order_id = $1`, [created.order_id]);
    // Abelha não tem embalagem na ficha: só a embalagem por pedido entra.
    await env.as(dono, (s) => s.rpc('deliver_order', { p_request_id: rid(), p_order_id: created.order_id, p_delivery: { lines: [{ line_id: line.id, qty: 1 }] } }));
    expect((await packaging()).map((p) => [p.item_id, n(p.qty)])).toEqual([[saquinho, 1]]);
    await env.as(dono, (s) => s.rpc('deliver_order', { p_request_id: rid(), p_order_id: created.order_id, p_delivery: {} }));
    expect((await packaging()).map((p) => [p.item_id, n(p.qty)])).toEqual([[saquinho, 1]]);
    await env.as(dono, (s) => s.rpc('save_settings', { p_settings: { default_order_packaging_item_id: '' } }));
  });

  it('sinal recebido de pedido sem cliente não pode virar crédito', async () => {
    const created = await env.as(dono, (s) =>
      s.rpc<{ order_id: number }>('create_order', {
        p_request_id: rid(),
        p_order: {
          kind: 'ENCOMENDA', channel_id: direct, confirm: true, lines: [{ variant_id: coracao, qty: 2, unit_price: 4 }],
          payment_terms: [{ label: 'Sinal', pct: 0.5, due_date: '2026-10-21' }, { label: 'Na entrega', due_date: '2026-11-10' }],
        },
      }),
    );
    const first = await env.admin().one<{ id: number }>(
      `select i.id from public.installments i join public.sales_orders o on o.receivable_id = i.receivable_id where o.id = $1 and i.number = 1`,
      [created.order_id],
    );
    await env.as(dono, (s) => s.rpc('receive_installment', { p_request_id: rid(), p_installment_id: first.id, p_received_on: '2026-10-21', p_account_id: bank }));
    await expect(
      env.as(dono, (s) => s.rpc('cancel_order', { p_request_id: rid(), p_order_id: created.order_id, p_reason: 'Desistiu', p_deposit_action: 'CREDIT' })),
    ).rejects.toThrow(/sem cliente/);
    const refund = await env.as(dono, (s) =>
      s.rpc<{ refund_payable_id: number; deposit: number }>('cancel_order', { p_request_id: rid(), p_order_id: created.order_id, p_reason: 'Desistiu', p_deposit_action: 'REFUND' }),
    );
    expect(n(refund.deposit)).toBe(4);
    expect(refund.refund_payable_id).toBeTruthy();
    const o = await order(created.order_id);
    expect(o.canceled_at).toBeTruthy();
  });

  it('dividir a taxa combinada na mesma data em que ela começa é bloqueado', async () => {
    await expect(
      env.as(dono, (s) => s.rpc('split_operational_rate', { p_valid_from: '2026-01-01', p_energy_h: 0.5, p_depreciation_h: 0.7 })),
    ).rejects.toThrow(/precisa começar depois/);
  });
});
