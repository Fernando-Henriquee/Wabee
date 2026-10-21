import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, type Session, TestEnv } from './env';

/** Módulo 3 — compras, recebimento, parcelas e quem pagou (seção 9) e baixas (US-7.4). */

let env: TestEnv;
let dono: string;
let bank: number;
let ownerCard: number;
let companyCard: number;
let pla: number;
let argola: number;
let alicate: number;
let supplier: number;

const rid = () => crypto.randomUUID();

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono');
  await env.as(dono, async (s) => {
    bank = await s.rpc<number>('save_payment_account', { p_account: { name: 'Conta da empresa', kind: 'BANCO', owner: 'EMPRESA', opening_balance: 1000, opening_date: '2026-01-01' } });
    ownerCard = await s.rpc<number>('save_payment_account', { p_account: { name: 'Cartão pessoal', kind: 'CARTAO_CREDITO', owner: 'DONO', card_closing_day: 5, card_due_day: 15 } });
    companyCard = await s.rpc<number>('save_payment_account', { p_account: { name: 'Cartão da empresa', kind: 'CARTAO_CREDITO', owner: 'EMPRESA', card_closing_day: 25, card_due_day: 5 } });
    pla = await s.rpc<number>('save_item', { p_item: { kind: 'FILAMENT', name: 'PLA preto', filament: { material: 'PLA', color_name: 'preto', nominal_spool_g: 1000 } } });
    argola = await s.rpc<number>('save_item', { p_item: { kind: 'COMPONENT', name: 'Argola 25 mm' } });
    alicate = await s.rpc<number>('save_item', { p_item: { kind: 'TOOL', name: 'Alicate de corte' } });
    supplier = await s.rpc<number>('save_supplier', { p_supplier: { name: 'Loja 3D' } });
  });
});

afterAll(async () => {
  await env.close();
});

async function draft(s: Session, purchase: Record<string, unknown>) {
  return s.rpc<{ purchase_id: number; installments: Array<{ due_date: string; amount: number }> }>('save_purchase_draft', { p_purchase: purchase });
}

async function code(categoryCode: string) {
  const row = await env.admin().one<{ s: string }>(
    `select coalesce(sum(e.amount), 0)::text as s from public.result_entries e join public.financial_categories c on c.id = e.category_id where c.code = $1`,
    [categoryCode],
  );
  return n(row.s);
}

describe('vencimento sugerido pelo cartão', () => {
  it('compras a partir do fechamento vão para a fatura seguinte', async () => {
    const dates = await env.as(dono, (s) =>
      s.one<Record<string, string>>(
        `select public.suggest_first_due_date($1, '2026-10-03')::text a, public.suggest_first_due_date($1, '2026-10-05')::text b,
                public.suggest_first_due_date($2, '2026-10-10')::text c, public.suggest_first_due_date($2, '2026-10-26')::text d`,
        [ownerCard, companyCard],
      ),
    );
    expect(dates).toEqual({ a: '2026-10-15', b: '2026-11-15', c: '2026-11-05', d: '2026-12-05' });
  });
});

describe('rascunho, rateio e confirmação (US-3.2, US-3.3, RN-02, RN-03)', () => {
  it('rascunho não mexe em estoque nem financeiro; frete rateado com centavos na linha de maior valor', async () => {
    const result = await env.as(dono, (s) =>
      draft(s, {
        supplier_id: supplier, purchased_at: '2026-10-10', freight_total: 10, discount_total: 0, payment_method: 'PIX', payment_account_id: bank,
        lines: [
          { line_kind: 'ITEM', item_id: pla, qty: 1000, unit_price: 0.1 },
          { line_kind: 'ITEM', item_id: argola, qty: 100, unit_price: 1 },
          { line_kind: 'ITEM', item_id: alicate, qty: 1, unit_price: 100 },
        ],
      }),
    );
    const lines = await env.admin().query<{ freight_alloc: string; landed_unit_cost: string }>(
      `select freight_alloc, landed_unit_cost from public.purchase_lines where purchase_id = $1 order by sort_order`,
      [result.purchase_id],
    );
    expect(lines.map((l) => n(l.freight_alloc))).toEqual([3.34, 3.33, 3.33]);
    expect(n(lines[0]!.landed_unit_cost)).toBe(0.10334);
    expect(n(lines[1]!.landed_unit_cost)).toBe(1.0333);
    const payables = await env.admin().query(`select 1 from public.payables`);
    expect(payables).toEqual([]);
    // PIX pela conta da empresa: confirma e já paga na data da compra.
    await env.as(dono, (s) => s.rpc('confirm_purchase', { p_request_id: rid(), p_purchase_id: result.purchase_id }));
    const inst = await env.admin().one<{ status: string; paid_on: string; amount: string }>(
      `select i.status, i.paid_on::text, i.amount from public.installments i join public.payables p on p.id = i.payable_id where p.source_id = $1`,
      [result.purchase_id],
    );
    expect(inst).toMatchObject({ status: 'PAGA', paid_on: '2026-10-10' });
    expect(n(inst.amount)).toBe(310);
    const cash = await env.admin().one<{ direction: string; amount: string }>(`select direction, amount from public.cash_transactions where account_id = $1`, [bank]);
    expect(cash.direction).toBe('OUT');
    expect(n(cash.amount)).toBe(310);
    // Ferramenta pequena é despesa na compra (Q9): R$ 100 + frete 3,33.
    expect(await code('4.6')).toBe(-103.33);
  });

  it('recebimento: N carretéis viram N lotes; ferramenta entra sem valor de estoque (US-3.5)', async () => {
    const purchase = await env.admin().one<{ id: number }>(`select id from public.purchases order by id desc limit 1`);
    const lines = await env.admin().query<{ id: number }>(`select id from public.purchase_lines where purchase_id = $1 order by sort_order`, [purchase.id]);
    await env.as(dono, (s) =>
      s.rpc('receive_purchase', { p_request_id: rid(), p_purchase_id: purchase.id, p_lines: [{ line_id: lines[0]!.id, qty: 1000, spool_count: 1 }, { line_id: lines[1]!.id, qty: 40 }] }),
    );
    let status = await env.admin().one<{ status: string }>(`select status from public.purchases where id = $1`, [purchase.id]);
    expect(status.status).toBe('RECEBIDA_PARCIAL');
    await env.as(dono, (s) => s.rpc('receive_purchase', { p_request_id: rid(), p_purchase_id: purchase.id }));
    status = await env.admin().one<{ status: string }>(`select status from public.purchases where id = $1`, [purchase.id]);
    expect(status.status).toBe('RECEBIDA');
    const argolaBal = await env.admin().one<{ qty_on_hand: string; avg_cost_total: string }>(`select * from public.stock_balances where item_id = $1`, [argola]);
    expect(n(argolaBal.qty_on_hand)).toBe(100);
    expect(n(argolaBal.avg_cost_total)).toBe(1.0333);
    const tool = await env.admin().one<{ qty_on_hand: string; value_total: string }>(`select * from public.stock_balances where item_id = $1`, [alicate]);
    expect(n(tool.qty_on_hand)).toBe(1);
    expect(n(tool.value_total)).toBe(0);
  });

  it('cartão parcelado com valor à vista: juros = diferença, por parcela, no mês de vencimento (RN-03)', async () => {
    const result = await env.as(dono, (s) =>
      draft(s, {
        supplier_id: supplier, purchased_at: '2026-10-12', payment_method: 'CREDITO_PARCELADO', payment_account_id: companyCard,
        installments_count: 10, installments_total: 1100,
        lines: [{ line_kind: 'ITEM', item_id: pla, qty: 10000, unit_price: 0.1 }],
      }),
    );
    expect(result.installments).toHaveLength(10);
    expect(result.installments[0]!.due_date).toBe('2026-11-05');
    await env.as(dono, (s) => s.rpc('confirm_purchase', { p_request_id: rid(), p_purchase_id: result.purchase_id }));
    const p = await env.admin().one<{ interest_total: string; cash_price_total: string; status: string }>(`select * from public.purchases where id = $1`, [result.purchase_id]);
    expect(n(p.interest_total)).toBe(100);
    expect(n(p.cash_price_total)).toBe(1000);
    const insts = await env.admin().query<{ interest: string; principal: string; due_date: string }>(
      `select i.interest, i.principal, i.due_date::text from public.installments i join public.payables pa on pa.id = i.payable_id
       where pa.source_id = $1 order by i.number`,
      [result.purchase_id],
    );
    expect(insts.every((i) => n(i.interest) === 10 && n(i.principal) === 100)).toBe(true);
    const nov = await env.admin().one<{ s: string }>(
      `select sum(e.amount)::text s from public.result_entries e join public.financial_categories c on c.id = e.category_id
       where c.code = '5.1' and e.occurred_on between '2026-11-01' and '2026-11-30'`,
    );
    expect(n(nov.s)).toBe(-10);
  });

  it('parcelas editadas precisam somar o total', async () => {
    const result = await env.as(dono, (s) =>
      draft(s, {
        supplier_id: supplier, purchased_at: '2026-10-12', payment_method: 'BOLETO', installments_count: 2, installments_total: 200,
        custom_installments: [{ due_date: '2026-11-01', amount: 150 }, { due_date: '2026-12-01', amount: 40 }],
        lines: [{ line_kind: 'ITEM', item_id: argola, qty: 200, unit_price: 1 }],
      }).catch((e: Error) => ({ error: e.message })),
    );
    expect(JSON.stringify(result)).toMatch(/não bate com o total/);
  });
});

describe('compras anteriores ao sistema pagas pelo dono (US-3.6, RN-19)', () => {
  it('R$ 5.646,19 em 18x no cartão pessoal: 30 parcelas no total, pagas pelo dono viram aporte', async () => {
    await env.admin().query(`update public.settings set go_live_date = '2026-10-20'`);
    const first = await env.as(dono, (s) =>
      draft(s, {
        supplier_id: supplier, purchased_at: '2026-06-10', payment_method: 'CREDITO_PARCELADO', payment_account_id: ownerCard,
        installments_count: 18, installments_total: 5646.19, interest_unknown: true, is_opening: true, manually_allocated: true,
        lines: [
          { line_kind: 'EQUIPMENT', description: 'Impressora 3D', qty: 1, unit_price: 4646.19 },
          { line_kind: 'ITEM', item_id: pla, qty: 10000, unit_price: 0.1 },
        ],
      }),
    );
    const second = await env.as(dono, (s) =>
      draft(s, {
        supplier_id: supplier, purchased_at: '2026-07-10', payment_method: 'CREDITO_PARCELADO', payment_account_id: ownerCard,
        installments_count: 12, installments_total: 2863.11, interest_unknown: true, is_opening: true,
        lines: [{ line_kind: 'ITEM', item_id: argola, qty: 1, unit_price: 2863.11 }],
      }),
    );
    await env.as(dono, (s) => s.rpc('confirm_purchase', { p_request_id: rid(), p_purchase_id: first.purchase_id, p_paid_count: 4 }));
    await env.as(dono, (s) => s.rpc('confirm_purchase', { p_request_id: rid(), p_purchase_id: second.purchase_id, p_paid_count: 3 }));
    const insts = await env.admin().query<{ amount: string; payer: string; status: string; paid_on: string | null; due_date: string }>(
      `select i.amount, i.payer, i.status, i.paid_on::text, i.due_date::text from public.installments i join public.payables p on p.id = i.payable_id
       where p.source_id in ($1, $2) order by p.id, i.number`,
      [first.purchase_id, second.purchase_id],
    );
    expect(insts).toHaveLength(30);
    expect(insts.every((i) => i.payer === 'DONO')).toBe(true);
    expect(n(insts[0]!.amount)).toBe(313.68);
    expect(n(insts[17]!.amount)).toBe(313.63);
    expect(n(insts[29]!.amount)).toBe(238.62);
    expect(insts.filter((i) => i.status === 'PAGA')).toHaveLength(7);
    expect(insts.filter((i) => i.status === 'PAGA').every((i) => i.paid_on === i.due_date)).toBe(true);
    const owner = await env.admin().one<{ s: string; c: number }>(
      `select sum(amount)::text s, count(*)::int c from public.owner_movements where kind = 'CAPITAL_CONTRIBUTION'`,
    );
    expect(owner.c).toBe(7);
    expect(n(owner.s)).toBe(4 * 313.68 + 3 * 238.59);
    // Pago pelo dono não sai do caixa da empresa.
    const cash = await env.admin().query(`select 1 from public.cash_transactions where source_type = 'installment_payment' and account_id <> $1`, [bank]);
    expect(cash).toEqual([]);
    // Interesse não informado: juros zero e compra marcada.
    const p = await env.admin().one<{ interest_unknown: boolean; interest_total: string }>(`select * from public.purchases where id = $1`, [first.purchase_id]);
    expect(p.interest_unknown).toBe(true);
    expect(n(p.interest_total)).toBe(0);
  });

  it('recebimento da compra antiga registra o que resta hoje e cria o equipamento com o valor da linha', async () => {
    const purchase = await env.admin().one<{ id: number }>(`select id from public.purchases where purchased_at = '2026-06-10'`);
    const lines = await env.admin().query<{ id: number; line_kind: string }>(`select id, line_kind from public.purchase_lines where purchase_id = $1 order by sort_order`, [purchase.id]);
    const before = await env.admin().one<{ qty_on_hand: string }>(`select qty_on_hand from public.stock_balances where item_id = $1`, [pla]);
    await env.as(dono, (s) =>
      s.rpc('receive_purchase', {
        p_request_id: rid(), p_purchase_id: purchase.id,
        p_lines: [
          { line_id: lines[0]!.id, equipment: { name: 'Impressora 1', useful_life_hours: 5000, avg_power_w: 120, initial_hours: 300 } },
          { line_id: lines[1]!.id, spools: [850, 1000] },
        ],
      }),
    );
    const eq = await env.admin().one<{ acquisition_cost: string; initial_hours: string; purchase_line_id: number }>(
      `select acquisition_cost, initial_hours, purchase_line_id from public.equipment where name = 'Impressora 1'`,
    );
    expect(n(eq.acquisition_cost)).toBe(4646.19);
    expect(n(eq.initial_hours)).toBe(300);
    const after = await env.admin().one<{ qty_on_hand: string }>(`select qty_on_hand from public.stock_balances where item_id = $1`, [pla]);
    expect(n(after.qty_on_hand) - n(before.qty_on_hand)).toBe(1850);
    const status = await env.admin().one<{ status: string }>(`select status from public.purchases where id = $1`, [purchase.id]);
    expect(status.status).toBe('RECEBIDA');
    const opening = await env.admin().query(`select 1 from public.stock_movements where source_type = 'purchase' and source_id = $1 and type = 'OPENING'`, [purchase.id]);
    expect(opening).toHaveLength(2);
  });
});

describe('baixa de parcelas (US-7.4)', () => {
  let open: Array<{ id: number; amount: string }>;

  beforeAll(async () => {
    open = await env.admin().query<{ id: number; amount: string }>(
      `select i.id, i.amount from public.installments i join public.payables p on p.id = i.payable_id
       join public.purchases c on c.id = p.source_id where c.payment_account_id = $1 and i.status = 'ABERTA' order by i.due_date, i.id`,
      [companyCard],
    );
  });

  it('empresa paga pela conta: saída de caixa; pago a mais = juros/multa por atraso', async () => {
    await env.as(dono, (s) => s.rpc('pay_installment', { p_request_id: rid(), p_installment_id: open[0]!.id, p_paid_on: '2026-11-07', p_account_id: bank, p_amount: 112.5 }));
    expect(await code('5.2')).toBe(-2.5);
    const tx = await env.admin().one<{ amount: string }>(`select amount from public.cash_transactions where installment_id = $1`, [open[0]!.id]);
    expect(n(tx.amount)).toBe(112.5);
  });

  it('pago a menos mantendo saldo: o restante vira nova parcela em aberto; estorno reincorpora', async () => {
    const result = await env.as(dono, (s) =>
      s.rpc<{ remainder_installment_id: number }>('pay_installment', {
        p_request_id: rid(), p_installment_id: open[1]!.id, p_paid_on: '2026-12-05', p_account_id: bank, p_amount: 60, p_remainder: 'SALDO',
      }),
    );
    const rest = await env.admin().one<{ amount: string; status: string }>(`select amount, status from public.installments where id = $1`, [result.remainder_installment_id]);
    expect(n(rest.amount)).toBe(50);
    expect(rest.status).toBe('ABERTA');
    await env.as(dono, (s) => s.rpc('reverse_installment_payment', { p_request_id: rid(), p_installment_id: open[1]!.id, p_reason: 'Valor errado' }));
    const back = await env.admin().one<{ amount: string; status: string }>(`select amount, status from public.installments where id = $1`, [open[1]!.id]);
    expect(n(back.amount)).toBe(110);
    expect(back.status).toBe('ABERTA');
    const cash = await env.admin().one<{ s: string }>(
      `select coalesce(sum(case direction when 'IN' then amount else -amount end), 0)::text s from public.cash_transactions where installment_id = $1`,
      [open[1]!.id],
    );
    expect(n(cash.s)).toBe(0);
  });

  it('conta do dono força pagador = dono (RN-19)', async () => {
    const result = await env.as(dono, (s) =>
      s.rpc<{ payer: string; owner_movement_id: number; cash_transaction_id: number | null }>('pay_installment', {
        p_request_id: rid(), p_installment_id: open[2]!.id, p_paid_on: '2027-01-05', p_account_id: ownerCard, p_payer: 'EMPRESA',
      }),
    );
    expect(result.payer).toBe('DONO');
    expect(result.cash_transaction_id).toBeNull();
    expect(result.owner_movement_id).toBeTruthy();
  });

  it('fatura do cartão: várias parcelas baixadas juntas', async () => {
    const res = await env.as(dono, (s) =>
      s.rpc<{ payments: unknown[] }>('pay_installments', { p_request_id: rid(), p_installment_ids: [open[3]!.id, open[4]!.id], p_paid_on: '2027-02-05', p_account_id: bank }),
    );
    expect(res.payments).toHaveLength(2);
  });
});

describe('cancelamento (US-3.8)', () => {
  it('com recebimento ativo é bloqueado; estornado o recebimento, cancela e gera reembolso do que foi pago', async () => {
    const result = await env.as(dono, (s) =>
      draft(s, { supplier_id: supplier, purchased_at: '2026-10-15', payment_method: 'PIX', payment_account_id: bank, lines: [{ line_kind: 'ITEM', item_id: argola, qty: 10, unit_price: 2 }] }),
    );
    await env.as(dono, (s) => s.rpc('confirm_and_receive_purchase', { p_request_id: rid(), p_purchase_id: result.purchase_id }));
    await expect(env.as(dono, (s) => s.rpc('cancel_purchase', { p_request_id: rid(), p_purchase_id: result.purchase_id, p_reason: 'Devolvida' }))).rejects.toThrow(
      /Estorne antes os recebimentos/,
    );
    const receipt = await env.admin().one<{ id: number }>(`select id from public.receipts where purchase_id = $1`, [result.purchase_id]);
    await env.as(dono, (s) => s.rpc('reverse_receipt', { p_request_id: rid(), p_receipt_id: receipt.id, p_reason: 'Devolvida ao fornecedor' }));
    const cancel = await env.as(dono, (s) => s.rpc<{ refund_receivable_id: number }>('cancel_purchase', { p_request_id: rid(), p_purchase_id: result.purchase_id, p_reason: 'Devolvida' }));
    expect(cancel.refund_receivable_id).toBeTruthy();
    const refund = await env.admin().one<{ total: string }>(`select total from public.receivables where id = $1`, [cancel.refund_receivable_id]);
    expect(n(refund.total)).toBe(20);
    expect(await env.admin().query(`select * from private.rebuild_balances()`)).toEqual([]);
  });
});
