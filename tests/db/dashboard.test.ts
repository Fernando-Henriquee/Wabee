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
