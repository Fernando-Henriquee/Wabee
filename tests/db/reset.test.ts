import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestEnv } from './env';

/** Reset do sistema: apaga a operação e os produtos/itens; mantém configurações e cadastros base. */

let env: TestEnv;
let dono: string;
let leitura: string;

const rid = () => crypto.randomUUID();

/** Tabelas que o reset mantém; todas as outras do schema public precisam ficar vazias. */
const KEPT = [
  'app_members', 'profiles', 'settings', 'sales_channels', 'sales_channel_fees', 'cost_rates', 'financial_categories',
  'equipment', 'suppliers', 'customers', 'payment_accounts',
];

async function count(table: string) {
  const row = await env.admin().one<{ c: number }>(`select count(*)::int c from public.${table}`);
  return row.c;
}

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono');
  leitura = await env.createMember('leitura@wabee.test', 'leitura');
  await env.admin().query(`update public.settings set go_live_date = '2026-10-21', onboarding_state = '{"done": true}'`);
  await env.as(dono, async (s) => {
    await s.rpc('save_payment_account', { p_account: { name: 'Pix da empresa', kind: 'CARTEIRA', owner: 'EMPRESA' } });
    await s.rpc('save_supplier', { p_supplier: { name: 'Loja de filamentos', kind: 'LOJA_ONLINE' } });
    await s.rpc('save_customer', { p_customer: { name: 'Maria' } });
    await s.rpc('save_equipment', { p_equipment: { name: 'Impressora 1' } });
    await s.rpc('create_cost_rate', { p_rate_type: 'OPERATIONAL_PER_HOUR', p_value: 1.2, p_valid_from: '2026-01-01' });
    const product = await s.rpc<number>('save_product', { p_product: { name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'amarelo', reference_price: 5 }] } });
    const v = await s.one<{ id: number; item_id: number }>(`select id, item_id from public.product_variants where product_id = $1`, [product]);
    await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: v.item_id, p_entries: [{ qty: 10, layers: { material: 1, operational: 0.2 } }] });
    const direct = (await s.one<{ id: number }>(`select id from public.sales_channels where name = 'Venda direta'`)).id;
    await s.rpc('quick_sale', { p_request_id: rid(), p_sale: { channel_id: direct, lines: [{ variant_id: v.id, qty: 2, unit_price: 5 }], packaging: [] } });
  });
});

afterAll(async () => {
  await env.close();
});

describe('reset do sistema', () => {
  it('só o dono pode resetar, e só com a frase de confirmação', async () => {
    await expect(env.as(leitura, (s) => s.rpc('reset_system', { p_confirm: 'APAGAR TUDO' }))).rejects.toThrow();
    await expect(env.as(dono, (s) => s.rpc('reset_system', { p_confirm: 'apagar' }))).rejects.toThrow(/APAGAR TUDO/);
    expect(await count('sales_orders')).toBeGreaterThan(0);
  });

  it('apaga operação, produtos e itens e mantém configurações e cadastros base', async () => {
    const keptBefore = Object.fromEntries(await Promise.all(KEPT.map(async (t) => [t, await count(t)] as const)));
    await env.as(dono, (s) => s.rpc('reset_system', { p_confirm: 'APAGAR TUDO' }));

    const tables = await env.admin().query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    );
    for (const { table_name } of tables) {
      if (KEPT.includes(table_name)) {
        expect(await count(table_name), table_name).toBe(keptBefore[table_name]);
      } else if (table_name === 'audit_logs') {
        // Só o registro do próprio reset.
        const logs = await env.admin().query<{ object_ref: string }>(`select object_ref from public.audit_logs`);
        expect(logs).toEqual([{ object_ref: 'reset' }]);
      } else {
        expect(await count(table_name), table_name).toBe(0);
      }
    }

    const settings = await env.admin().one<{ go_live_date: string | null; onboarding_state: unknown }>(`select go_live_date, onboarding_state from public.settings`);
    expect(settings).toEqual({ go_live_date: null, onboarding_state: {} });
  });

  it('a numeração recomeça e o sistema volta a operar normalmente', async () => {
    await env.admin().query(`update public.settings set go_live_date = '2026-10-21'`);
    const order = await env.as(dono, async (s) => {
      const product = await s.rpc<number>('save_product', { p_product: { name: 'Vaso', category: 'DECORACAO', variants: [{ name: 'branco', reference_price: 20 }] } });
      const v = await s.one<{ id: number; item_id: number }>(`select id, item_id from public.product_variants where product_id = $1`, [product]);
      await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: v.item_id, p_entries: [{ qty: 3, layers: { material: 5 } }] });
      const direct = (await s.one<{ id: number }>(`select id from public.sales_channels where name = 'Venda direta'`)).id;
      return s.rpc<{ order_id: number }>('quick_sale', { p_request_id: rid(), p_sale: { channel_id: direct, lines: [{ variant_id: v.id, qty: 1, unit_price: 20 }], packaging: [] } });
    });
    const row = await env.admin().one<{ number: string }>(`select number from public.sales_orders where id = $1`, [order.order_id]);
    expect(row.number).toMatch(/-0001$/);
  });
});
