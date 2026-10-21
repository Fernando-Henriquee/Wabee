import { randomUUID } from 'node:crypto';
import type { LocalAuth } from './auth';
import type { LocalDatabase } from './db';

/**
 * Dados do AMBIENTE LOCAL. Contas e negócios fictícios, criados somente no banco
 * local do emulador. Com --demo, inclui movimentações de demonstração para explorar
 * as telas — claramente separadas de qualquer dado real.
 */

export const LOCAL_PASSWORD = 'senha-local-123';

export const LOCAL_ACCOUNTS = [
  { email: 'ana@local.test', name: 'Ana', business: 'main', role: 'owner', description: 'sócia (owner) — Magi Doces local' },
  { email: 'bia@local.test', name: 'Bia', business: 'main', role: 'owner', description: 'sócia (owner) — Magi Doces local' },
  { email: 'leitura@local.test', name: 'Leitura', business: 'main', role: 'viewer', description: 'somente leitura — Magi Doces local' },
  { email: 'outro@local.test', name: 'Outro', business: 'other', role: 'owner', description: 'outro negócio (teste de isolamento)' },
] as const;

export const LOCAL_BUSINESS_NAME = 'Magi Doces (ambiente local)';

export async function seedLocal(db: LocalDatabase, auth: LocalAuth, options: { demo: boolean }) {
  const ids: Record<string, string> = {};
  for (const account of LOCAL_ACCOUNTS) {
    ids[account.email] = await auth.createUser(account.email, LOCAL_PASSWORD, account.name);
  }

  const businesses = await db.admin(async (pg) => {
    await pg.exec(`create table if not exists local_meta.seed (key text primary key, value text not null)`);
    const existing = await pg.query<{ key: string; value: string }>('select key, value from local_meta.seed');
    const map = Object.fromEntries(existing.rows.map((row) => [row.key, row.value])) as Record<string, string>;
    for (const [key, name] of [
      ['main', LOCAL_BUSINESS_NAME],
      ['other', 'Outra Confeitaria (ambiente local)'],
    ] as const) {
      if (map[key]) continue;
      const result = await pg.query<{ id: string }>('insert into public.businesses (name) values ($1) returning id', [name]);
      const businessId = result.rows[0]!.id;
      await pg.query('select private.seed_business_defaults($1)', [businessId]);
      for (const account of LOCAL_ACCOUNTS.filter((a) => a.business === key)) {
        await pg.query(
          'insert into public.business_members (business_id, user_id, role) values ($1, $2, $3) on conflict do nothing',
          [businessId, ids[account.email], account.role],
        );
      }
      await pg.query('insert into local_meta.seed (key, value) values ($1, $2)', [key, businessId]);
      map[key] = businessId;
    }
    return map;
  });

  if (options.demo) await seedDemo(db, businesses.main!, ids['ana@local.test']!);

  return { businesses, accounts: LOCAL_ACCOUNTS.map((a) => ({ ...a, password: LOCAL_PASSWORD })) };
}

/** Movimentações de demonstração (somente ambiente local, com --demo). */
async function seedDemo(db: LocalDatabase, businessId: string, userId: string) {
  const already = await db.admin(async (pg) => (await pg.query(`select 1 from local_meta.seed where key = 'demo'`)).rows.length > 0);
  if (already) return;
  await db.asRole({ sub: userId, role: 'authenticated' }, async (pg) => {
    const today = (await pg.query<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`)).rows[0]!.d;
    const day = (offset: number) => {
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const prices: Record<string, [number, number]> = {
      'Bolo de pote': [1200, 450],
      'Torta de limão': [1500, 600],
      'Morango cravejado': [1000, 380],
      'Surpresa de uva': [900, 320],
    };
    const products: Record<string, string> = {};
    for (const [name, [price, cost]] of Object.entries(prices)) {
      const row = await pg.query<{ id: string }>(
        `update public.products set price_cents = $3, manual_unit_cost_cents = $4 where business_id = $1 and name = $2 returning id`,
        [businessId, name, price, cost],
      );
      products[name] = row.rows[0]!.id;
    }
    const customers: string[] = [];
    for (const [name, phone] of [
      ['Cliente Demo Alice', '11900000001'],
      ['Cliente Demo Bruno', '11900000002'],
      ['Cliente Demo Carla', null],
    ] as const) {
      const row = await pg.query<{ id: string }>(`insert into public.customers (business_id, name, phone, notes) values ($1, $2, $3, 'Cadastro de demonstração') returning id`, [
        businessId,
        name,
        phone,
      ]);
      customers.push(row.rows[0]!.id);
    }
    const sale = async (payload: Record<string, unknown>) => {
      const result = await pg.query<{ id: string }>(`select public.create_sale($1, $2, $3::jsonb) as id`, [businessId, randomUUID(), JSON.stringify(payload)]);
      return result.rows[0]!.id;
    };
    await sale({ customer_id: customers[0], sale_date: day(-12), due_date: day(-2), items: [{ product_id: products['Bolo de pote'], quantity: 3 }] });
    const partial = await sale({
      customer_id: customers[0],
      sale_date: day(-5),
      due_date: day(10),
      items: [{ product_id: products['Torta de limão'], quantity: 2 }, { product_id: products['Surpresa de uva'], quantity: 1 }],
    });
    await pg.query(`select public.register_payment($1, $2, 1500, $3::date, 'pix')`, [partial, randomUUID(), day(-1)]);
    await sale({ customer_id: customers[1], sale_date: day(-3), items: [{ product_id: products['Morango cravejado'], quantity: 4 }], payment: { full: true, method: 'dinheiro' } });
    await sale({ customer_id: customers[2], sale_date: day(0), due_date: day(20), items: [{ product_id: products['Bolo de pote'], quantity: 2 }] });
    await pg.query(`select public.create_purchase($1, $2, $3::jsonb)`, [
      businessId,
      randomUUID(),
      JSON.stringify({
        purchase_date: day(-6),
        description: 'Insumos (demonstração)',
        new_supplier_name: 'Fornecedor Demo',
        due_date: day(15),
        items: [
          { description: 'Leite condensado', quantity: 12, unit: 'un', unit_price_cents: 650 },
          { description: 'Morangos', quantity: 2, unit: 'kg', unit_price_cents: 2800 },
        ],
        plan: { mode: 'installments', count: 2, first_due_date: day(15) },
      }),
    ]);
    // Link de compras ligado, com chave PIX fictícia (o QR code é só de demonstração).
    await pg.query(`update public.businesses set pix_key = 'pix-demonstracao@magidoces.local', pix_city = 'Sao Paulo' where id = $1`, [businessId]);
    await pg.query(`select public.configure_storefront($1, true)`, [businessId]);
    await pg.query(`select public.create_expense($1, $2, $3::jsonb)`, [
      businessId,
      randomUUID(),
      JSON.stringify({ expense_date: day(-4), description: 'Gás (demonstração)', category: 'Gás', amount_cents: 12000, plan: { mode: 'paid', method: 'pix' } }),
    ]);
  });
  await db.admin((pg) => pg.query(`insert into local_meta.seed (key, value) values ('demo', 'yes')`));
}
