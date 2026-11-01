import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Overview, ValuePath } from '../../src/data/dashboard-types';
import { n, TestEnv } from './env';

/** Módulo 8 — Visão geral, caminho do valor, DRE e caixa, com valores calculados à mão (seção 16.3). */

let env: TestEnv;
let dono: string;
let producao: string;
let bank: number;
let abelha: number;
let abelhaItem: number;

const rid = () => crypto.randomUUID();
const today = () => env.today();

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono');
  producao = await env.createMember('producao@wabee.test', 'producao');
  await env.admin().query(`update public.settings set go_live_date = '2026-10-01'`);
  await env.as(dono, async (s) => {
    bank = await s.rpc<number>('save_payment_account', { p_account: { name: 'Banco', kind: 'BANCO', owner: 'EMPRESA', opening_balance: 100, opening_date: '2026-01-01' } });
    const card = await s.rpc<number>('save_payment_account', { p_account: { name: 'Cartão pessoal', kind: 'CARTAO_CREDITO', owner: 'DONO', card_closing_day: 1, card_due_day: 10 } });
    const product = await s.rpc<number>('save_product', { p_product: { name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'amarelo', reference_price: 5 }] } });
    const v = await s.one<{ id: number; item_id: number }>(`select id, item_id from public.product_variants where product_id = $1`, [product]);
    abelha = v.id;
    abelhaItem = v.item_id;
    await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: abelhaItem, p_entries: [{ qty: 10, layers: { material: 1, operational: 0.4 } }] });
    // Investimento: compra antiga de R$ 600 em 6x paga pelo dono, 2 parcelas já pagas.
    const draft = await s.rpc<{ purchase_id: number }>('save_purchase_draft', {
      p_purchase: {
        purchased_at: '2026-08-01', payment_method: 'CREDITO_PARCELADO', payment_account_id: card, installments_count: 6,
        installments_total: 600, interest_unknown: true, is_opening: true,
        lines: [{ line_kind: 'EQUIPMENT', description: 'Impressora', qty: 1, unit_price: 600 }],
      },
    });
    await s.rpc('confirm_purchase', { p_request_id: rid(), p_purchase_id: draft.purchase_id, p_paid_count: 2 });
    const t = await s.one<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') d`);
    await s.rpc('quick_sale', {
      p_request_id: rid(),
      p_sale: { lines: [{ variant_id: abelha, qty: 3 }], packaging: [], payment: { account_id: bank }, delivered_at: `${t.d}T12:00:00-03:00` },
    });
    await s.rpc('create_expense', {
      p_request_id: rid(),
      p_expense: { description: 'Internet', category_id: (await s.one<{ id: number }>(`select id from public.financial_categories where code = '4.3'`)).id,
                   amount: 100, business_share_pct: 0.3, competence_date: t.d, due_date: t.d, paid: true, account_id: bank },
    });
  });
});

afterAll(async () => {
  await env.close();
});

describe('Visão geral (US-8.1)', () => {
  it('indicadores do topo batem com os valores calculados à mão', async () => {
    const d = await today();
    const from = `${d.slice(0, 7)}-01`;
    const o = await env.as(dono, (s) => s.rpc<Overview>('dashboard_overview', { p_from: from, p_to: d }));
    // Caixa: 100 + 15 (venda) − 30 (30% da internet)
    expect(n(o.cash_available)).toBe(85);
    expect(n(o.sales.current)).toBe(15);
    // Margem: 15 − 3 × 1,00 material = 12 (direto); − 3 × 0,40 operacional = 10,80
    expect(n(o.margin.direct)).toBe(12);
    expect(n(o.margin.operational)).toBe(10.8);
    expect(n(o.finished_stock.units)).toBe(7);
    expect(n(o.finished_stock.cost)).toBe(9.8);
    expect(n(o.finished_stock.sale_value)).toBe(35);
    expect(n(o.potential.potential_margin)).toBe(25.2);
    expect(n(o.investment.net_investment)).toBe(200);
    expect(n(o.payable_30d.owner)).toBeGreaterThan(0);
  });

  it('caminho do valor: cada peça numa etapa (US-8.2)', async () => {
    const d = await today();
    const path = await env.as(dono, (s) => s.rpc<ValuePath>('value_path', { p_from: `${d.slice(0, 7)}-01`, p_to: d }));
    expect(n(path.stock.pieces)).toBe(7);
    expect(n(path.reserved.pieces)).toBe(0);
    expect(n(path.received.pieces)).toBe(3);
    const fg = await env.admin().one<{ qty_on_hand: string }>(`select qty_on_hand from public.stock_balances where item_id = $1`, [abelhaItem]);
    expect(n(path.stock.pieces) + n(path.reserved.pieces)).toBe(n(fg.qty_on_hand));
  });

  it('DRE segue a estrutura 13.2 e só a parte da empresa da internet entra', async () => {
    const d = await today();
    const dre = await env.as(dono, (s) => s.rpc<{ lines: Array<{ key: string; amount: number; pct: number | null }> }>('income_statement', { p_from: `${d.slice(0, 7)}-01`, p_to: d }));
    const line = (key: string) => n(dre.lines.find((l) => l.key === key)!.amount);
    expect(line('receita_liquida')).toBe(15);
    expect(line('cmv_material')).toBe(-3);
    expect(line('cmv_operacional')).toBe(-1.2);
    expect(line('margem_contribuicao')).toBe(10.8);
    expect(line('despesas_operacionais')).toBe(-30);
    expect(line('resultado')).toBe(-19.2);
    expect(dre.lines.find((l) => l.key === 'receita_liquida')!.pct).toBe(1);
  });

  it('meta do mês: contas que vencem no mês ÷ margem de contribuição', async () => {
    type Goal = {
      margin_pct: number; margin_source: string; breakeven_revenue: number; target_revenue: number; revenue: number; result: number; remaining: number;
      expenses: { basis: number; source: string; month: number; bills: Array<{ description: string; amount: number }> };
    };
    const goal = (layer: string) => env.as(dono, (s) => s.rpc<Goal>('monthly_goal', { p_layer: layer }));
    // Compra lançada como despesa (R$ 1.200 em 12x no cartão do dono): entra inteira no DRE de hoje,
    // mas na meta só conta a parcela que vence em cada mês.
    await env.as(dono, async (s) => {
      const card = (await s.one<{ id: number }>(`select id from public.payment_accounts where name = 'Cartão pessoal'`)).id;
      const category = (await s.one<{ id: number }>(`select id from public.financial_categories where code = '4.9'`)).id;
      const draft = await s.rpc<{ purchase_id: number }>('save_purchase_draft', {
        p_purchase: {
          purchased_at: await today(), payment_method: 'CREDITO_PARCELADO', payment_account_id: card, installments_count: 12,
          installments_total: 1200, interest_unknown: true,
          lines: [{ line_kind: 'EXPENSE', expense_category_id: category, description: 'Empréstimo da impressora', qty: 1, unit_price: 1200 }],
        },
      });
      await s.rpc('confirm_purchase', { p_request_id: rid(), p_purchase_id: draft.purchase_id });
    });
    const d = await today();
    const due = await env.admin().one<{ total: string }>(
      `select coalesce(sum(amount), 0) total from public.installments
       where payable_id is not null and status <> 'CANCELADA' and due_date between date_trunc('month', $1::date)::date and (date_trunc('month', $1::date) + interval '1 month - 1 day')::date`,
      [d],
    );
    // Margem operacional 10,80 de 15 = 72%.
    let g = await goal('operational');
    expect(g.expenses.source).toBe('MES');
    expect(n(g.expenses.month)).toBe(n(due.total));
    expect(n(g.expenses.basis)).toBe(n(due.total));
    expect(n(g.expenses.basis)).toBeLessThan(1200);
    expect(g.expenses.bills.some((b) => b.description.includes('Internet'))).toBe(true);
    expect(g.margin_source).toBe('REALIZADA_90D');
    expect(n(g.margin_pct)).toBe(0.72);
    expect(n(g.breakeven_revenue)).toBe(Math.round((n(due.total) / 0.72) * 100) / 100);
    expect(n(g.revenue)).toBe(15);
    expect(n(g.result)).toBe(Math.round((10.8 - n(due.total)) * 100) / 100);
    // Valor manual e lucro desejado: (100 + 44) ÷ 72% = 200; na margem direta (80%) o equilíbrio é 125.
    await env.as(dono, (s) => s.rpc('save_settings', { p_settings: { monthly_fixed_expenses: '100', monthly_profit_target: '44' } }));
    g = await goal('operational');
    expect(g.expenses.source).toBe('MANUAL');
    expect(n(g.target_revenue)).toBe(200);
    expect(n((await goal('direct')).breakeven_revenue)).toBe(125);
    await env.as(dono, (s) => s.rpc('save_settings', { p_settings: { monthly_fixed_expenses: null, monthly_profit_target: '0' } }));
    expect((await goal('operational')).expenses.source).toBe('MES');
    await expect(env.as(producao, (s) => s.rpc('monthly_goal', { p_layer: 'operational' }))).rejects.toThrow(/permissão/);
  });

  it('análises extras: comparação, mix, entregas, carteira, retirada, alertas e resumo', async () => {
    const d = await today();
    const from = `${d.slice(0, 7)}-01`;
    type Metrics = { net_revenue: number; orders: number; units: number; avg_ticket: number; fixed_expenses: number; result: number };
    const cmp = await env.as(dono, (s) => s.rpc<{ a: Metrics; b: Metrics }>('period_compare', { p_a_from: from, p_a_to: d, p_b_from: '2026-01-01', p_b_to: '2026-01-31' }));
    expect(n(cmp.a.net_revenue)).toBe(15);
    expect(cmp.a.orders).toBe(1);
    expect(n(cmp.a.units)).toBe(3);
    expect(n(cmp.a.avg_ticket)).toBe(15);
    // Contas do período = parcelas que vencem nele (não a compra parcelada inteira).
    expect(n(cmp.a.fixed_expenses)).toBeLessThan(1200);
    expect(n(cmp.a.result)).toBe(Math.round((10.8 - n(cmp.a.fixed_expenses)) * 100) / 100);
    expect(n(cmp.b.net_revenue)).toBe(0);

    type Mix = { products: Array<{ name: string; abc: string; margin: number; is_custom: boolean }>; split: { custom: { revenue: number }; catalog: { revenue: number } } };
    const mix = await env.as(dono, (s) => s.rpc<Mix>('product_mix', { p_from: from, p_to: d }));
    expect(mix.products).toHaveLength(1);
    expect(mix.products[0]).toMatchObject({ abc: 'A', is_custom: false });
    expect(n(mix.products[0]!.margin)).toBe(10.8);
    expect(n(mix.split.catalog.revenue)).toBe(15);
    expect(n(mix.split.custom.revenue)).toBe(0);

    const stats = await env.as(dono, (s) => s.rpc<{ kinds: Record<string, { orders: number }> }>('delivery_stats', { p_from: from, p_to: d }));
    expect(stats.kinds.PRONTA_ENTREGA!.orders).toBe(1);

    const backlog = await env.as(dono, (s) => s.rpc<{ printers: number; capacity_hours: number; summary: { orders: number } }>('order_backlog', { p_days: 14 }));
    expect(backlog.summary.orders).toBe(0);
    expect(n(backlog.capacity_hours)).toBe(backlog.printers * 10 * 14);

    // Caixa 85 − reserva de 1 mês de contas; sem lucro no mês anterior, nada sugerido.
    const w = await env.as(dono, (s) => s.rpc<{ cash: number; reserve: number; cash_room: number; suggested: number }>('owner_withdrawal', {}));
    expect(n(w.cash)).toBe(85);
    const basis = (await env.as(dono, (s) => s.rpc<{ expenses: { basis: number } }>('monthly_goal', { p_layer: 'operational' }))).expenses.basis;
    expect(n(w.reserve)).toBe(n(basis));
    expect(n(w.cash_room)).toBe(Math.max(0, Math.round((85 - n(basis)) * 100) / 100));
    expect(n(w.suggested)).toBe(0);

    // Estoque total: 7 chaveiros × R$ 1,40 (material 1,00 + operacional 0,40).
    const stock = await env.as(dono, (s) => s.rpc<{ total: number; by_kind: Array<{ kind: string; value: number }>; finished: { units: number; free: number } }>('stock_value', {}));
    expect(n(stock.total)).toBe(9.8);
    expect(stock.by_kind.find((k) => k.kind === 'FINISHED_GOOD')!.value).toBeDefined();
    expect(n(stock.finished.units)).toBe(7);
    expect(n(stock.finished.free)).toBe(7);

    const insights = await env.as(dono, (s) => s.rpc<Array<{ kind: string }>>('dashboard_insights', {}));
    expect(insights.some((a) => a.kind === 'margin_low')).toBe(false);

    const week = await env.as(dono, (s) => s.rpc<{ current: Metrics; best_product: { name: string } }>('weekly_summary', {}));
    expect(n(week.current.net_revenue)).toBe(15);
    expect(week.best_product.name).toContain('Abelha');
    await expect(env.as(producao, (s) => s.rpc('owner_withdrawal', {}))).rejects.toThrow(/permissão/);
  });

  it('caixa projetado separa as parcelas pagas pelo dono (US-7.10)', async () => {
    const proj = await env.as(dono, (s) => s.rpc<{ months: Array<{ outflows: number; owner_paid: number }> }>('cash_projection', { p_months: 6 }));
    expect(proj.months).toHaveLength(6);
    expect(proj.months.every((m) => n(m.outflows) === 0)).toBe(true);
    expect(proj.months.reduce((sum, m) => sum + n(m.owner_paid), 0)).toBeGreaterThan(0);
  });

  it('alertas e "agora na impressora" funcionam para a produção, sem valores', async () => {
    const alerts = await env.as(producao, (s) => s.rpc<Array<{ kind: string }>>('dashboard_alerts', {}));
    expect(alerts.every((a) => a.kind !== 'installment')).toBe(true);
    const now = await env.as(producao, (s) => s.rpc<{ printing: unknown[] }>('now_printing', {}));
    expect(now.printing).toEqual([]);
    await expect(env.as(producao, (s) => s.rpc('dashboard_overview', { p_from: '2026-10-01', p_to: '2026-10-31' }))).rejects.toThrow(/permissão/);
    const items = await env.as(producao, (s) => s.query<{ qty_on_hand: string; avg_cost_total: string | null }>(`select qty_on_hand, avg_cost_total from public.v_items where id = $1`, [abelhaItem]));
    expect(n(items[0]!.qty_on_hand)).toBe(7);
    expect(items[0]!.avg_cost_total).toBeNull();
  });

  it('integridade do estoque e fechamento de mês (US-7.12)', async () => {
    const check = await env.as(dono, (s) => s.rpc<{ ok: boolean }>('check_stock_integrity', {}));
    expect(check.ok).toBe(true);
    await env.as(dono, (s) => s.rpc('close_month', { p_month: '2026-09-01' }));
    await expect(
      env.as(dono, (s) => s.rpc('register_stock_issue', { p_request_id: rid(), p_item_id: abelhaItem, p_type: 'LOSS', p_qty: 1, p_reason: 'teste', p_occurred_at: '2026-09-15T12:00:00-03:00' })),
    ).rejects.toThrow(/está fechado/);
    await env.as(dono, (s) => s.rpc('reopen_month', { p_month: '2026-09-01', p_reason: 'Correção' }));
    const audit = await env.admin().query(`select 1 from public.audit_logs where action in ('CLOSE_MONTH', 'REOPEN_MONTH')`);
    expect(audit).toHaveLength(2);
  });
});

describe('Fluxo de caixa realizado (US-7.10)', () => {
  interface Flow {
    opening: number;
    opened_in_period: number;
    closing: number;
    buckets: Array<{ inflows: number; outflows: number }>;
  }

  it('saldo no fim bate com o saldo das contas, inclusive conta aberta no período', async () => {
    const d = await today();
    const wallet = await env.as(dono, (s) =>
      s.rpc<number>('save_payment_account', { p_account: { name: 'Carteira', kind: 'DINHEIRO', owner: 'EMPRESA', opening_balance: 50, opening_date: d } }),
    );
    await env.as(dono, (s) => s.rpc('transfer_between_accounts', { p_request_id: rid(), p_from_account_id: bank, p_to_account_id: wallet, p_amount: 20, p_occurred_on: d }));
    const balances = await env.as(dono, (s) => s.query<{ id: number; balance: string }>(`select id, balance from public.v_payment_accounts where owner = 'EMPRESA'`));
    const total = balances.reduce((sum, b) => sum + n(b.balance), 0);

    const all = await env.as(dono, (s) => s.rpc<Flow>('cash_flow', { p_from: `${d.slice(0, 4)}-01-01`, p_to: d, p_grain: 'month' }));
    expect(n(all.closing)).toBeCloseTo(total, 2);
    expect(n(all.opened_in_period)).toBe(150);

    // Só a carteira: o saldo inicial de 50 entra como conta aberta no período e a transferência como entrada.
    const one = await env.as(dono, (s) => s.rpc<Flow>('cash_flow', { p_from: `${d.slice(0, 7)}-01`, p_to: d, p_account_id: wallet }));
    expect(n(one.opening)).toBe(0);
    expect(n(one.opened_in_period)).toBe(50);
    expect(n(one.buckets[0]!.inflows)).toBe(20);
    expect(n(one.closing)).toBe(70);
    expect(n(balances.find((b) => b.id === wallet)!.balance)).toBe(70);
  });
});
