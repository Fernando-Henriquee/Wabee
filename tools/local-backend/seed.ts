import { randomUUID } from 'node:crypto';
import type { LocalAuth } from './auth';
import type { LocalDatabase } from './db';

/**
 * Dados do AMBIENTE LOCAL. Contas fictícias, criadas somente no banco local do
 * emulador. Com --demo, inclui operações de demonstração (compras, impressões,
 * vendas) feitas pelas mesmas RPCs do app — claramente separadas de dados reais.
 */

export const LOCAL_PASSWORD = 'senha-local-123';

export const LOCAL_ACCOUNTS = [
  { email: 'dono@local.test', name: 'Dono', role: 'dono', description: 'dono — acesso total' },
  { email: 'producao@local.test', name: 'Ajudante', role: 'producao', description: 'produção — sem valores financeiros' },
  { email: 'leitura@local.test', name: 'Contador', role: 'leitura', description: 'somente leitura' },
] as const;

export async function seedLocal(db: LocalDatabase, auth: LocalAuth, options: { demo: boolean }) {
  const ids: Record<string, string> = {};
  for (const account of LOCAL_ACCOUNTS) {
    ids[account.email] = await auth.createUser(account.email, LOCAL_PASSWORD, account.name);
  }
  await db.admin(async (pg) => {
    await pg.exec(`create table if not exists local_meta.seed (key text primary key, value text not null)`);
    for (const account of LOCAL_ACCOUNTS) {
      await pg.query(`insert into public.app_members (user_id, role) values ($1, $2) on conflict (user_id) do nothing`, [ids[account.email], account.role]);
    }
    await pg.query(`update public.settings set company_name = 'Wabee (ambiente local)' where id and company_name = 'Wabee'`);
  });
  if (options.demo) await seedDemo(db, ids['dono@local.test']!);
  return { accounts: LOCAL_ACCOUNTS.map((a) => ({ ...a, password: LOCAL_PASSWORD })) };
}

/** Operações de demonstração (somente ambiente local, com --demo). */
async function seedDemo(db: LocalDatabase, userId: string) {
  const already = await db.admin(async (pg) => (await pg.query(`select 1 from local_meta.seed where key = 'demo'`)).rows.length > 0);
  if (already) return;
  await db.asRole({ sub: userId, role: 'authenticated' }, async (pg) => {
    const one = async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0]!;
    const call = async <T = unknown>(fn: string, args: Record<string, unknown>) => {
      const names = Object.keys(args);
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
      const values = names.map((n) => {
        const v = args[n];
        return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) && v.some((x) => typeof x === 'object') ? JSON.stringify(v) : v;
      });
      return (await pg.query<{ r: T }>(sql, values)).rows[0]!.r;
    };
    const today = (await one<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`)).d;
    const day = (offset: number) => {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    await call('save_settings', { p_settings: { go_live_date: day(-20) } });
    const bank = await call<number>('save_payment_account', { p_account: { name: 'Pix da empresa', kind: 'CARTEIRA', owner: 'EMPRESA', opening_balance: 150, opening_date: day(-20) } });
    const card = await call<number>('save_payment_account', { p_account: { name: 'Cartão pessoal', kind: 'CARTAO_CREDITO', owner: 'DONO', card_closing_day: 5, card_due_day: 15 } });
    await call('save_payment_account', { p_account: { name: 'Dinheiro em espécie', kind: 'DINHEIRO', owner: 'EMPRESA' } });
    await call('create_cost_rate', { p_rate_type: 'OPERATIONAL_PER_HOUR', p_value: 1.2, p_valid_from: day(-60) });
    const supplier = await call<number>('save_supplier', { p_supplier: { name: 'Loja 3D (demonstração)', kind: 'LOJA_ONLINE' } });
    const plaPreto = await call<number>('save_item', { p_item: { kind: 'FILAMENT', name: 'PLA preto — Demo', filament: { material: 'PLA', brand: 'Demo', color_name: 'preto', color_hex: '#1b1b1b', empty_spool_tare_g: 200 } } });
    const plaAmarelo = await call<number>('save_item', { p_item: { kind: 'FILAMENT', name: 'PLA amarelo — Demo', filament: { material: 'PLA', brand: 'Demo', color_name: 'amarelo', color_hex: '#f5b800', empty_spool_tare_g: 200 }, min_qty: 500 } });
    const argola = await call<number>('save_item', { p_item: { kind: 'COMPONENT', name: 'Argola 25 mm', min_qty: 20, reorder_qty: 100 } });
    const saquinho = await call<number>('save_item', { p_item: { kind: 'PACKAGING', name: 'Saquinho kraft' } });
    await call('save_item', { p_item: { kind: 'TOOL', name: 'Alicate de corte', tool: { condition: 'BOA', acquisition_value: 35 } } });
    await call('save_settings', { p_settings: { default_order_packaging_item_id: saquinho } });

    // Compra anterior ao sistema, paga no cartão pessoal (aporte do dono).
    const opening = await call<{ purchase_id: number }>('save_purchase_draft', {
      p_purchase: {
        supplier_id: supplier, purchased_at: day(-50), payment_method: 'CREDITO_PARCELADO', payment_account_id: card, installments_count: 10,
        installments_total: 3000, interest_unknown: true, is_opening: true, manually_allocated: true,
        lines: [
          { line_kind: 'EQUIPMENT', description: 'Impressora 3D (demonstração)', qty: 1, unit_price: 2600 },
          { line_kind: 'ITEM', item_id: plaPreto, qty: 2000, unit_price: 0.1 },
          { line_kind: 'ITEM', item_id: plaAmarelo, qty: 2000, unit_price: 0.1 },
        ],
      },
    });
    await call('confirm_purchase', { p_request_id: randomUUID(), p_purchase_id: opening.purchase_id, p_paid_count: 1 });
    const lines = (await pg.query<{ id: number; line_kind: string; item_id: number | null }>(`select id, line_kind, item_id from public.purchase_lines where purchase_id = $1 order by sort_order`, [opening.purchase_id])).rows;
    await call('receive_purchase', {
      p_request_id: randomUUID(), p_purchase_id: opening.purchase_id,
      p_lines: [
        { line_id: lines[0]!.id, equipment: { name: 'Impressora 1', useful_life_hours: 5000, avg_power_w: 120, initial_hours: 120, maintenance_interval_hours: 300 } },
        { line_id: lines[1]!.id, spools: [640, 1000] },
        { line_id: lines[2]!.id, spools: [380, 1000] },
      ],
      p_received_at: `${day(-20)}T10:00:00-03:00`,
    });
    const printer = (await one<{ id: number }>(`select id from public.equipment where name = 'Impressora 1'`)).id;

    // Componentes comprados no Pix da empresa.
    const comp = await call<{ purchase_id: number }>('save_purchase_draft', {
      p_purchase: { supplier_id: supplier, purchased_at: day(-15), payment_method: 'PIX', payment_account_id: bank, freight_total: 12,
        lines: [{ line_kind: 'ITEM', item_id: argola, qty: 200, unit_price: 0.24 }, { line_kind: 'ITEM', item_id: saquinho, qty: 100, unit_price: 0.18 }] },
    });
    await call('confirm_and_receive_purchase', { p_request_id: randomUUID(), p_purchase_id: comp.purchase_id });

    // Produtos e fichas.
    const abelhaP = await call<number>('save_product', { p_product: { name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'amarelo', reference_price: 5 }] } });
    const coracaoP = await call<number>('save_product', { p_product: { name: 'Chaveiro Coração', category: 'CHAVEIRO', variants: [{ name: 'preto', reference_price: 4 }] } });
    const abelha = (await one<{ id: number }>(`select id from public.product_variants where product_id = $1`, [abelhaP])).id;
    const coracao = (await one<{ id: number }>(`select id from public.product_variants where product_id = $1`, [coracaoP])).id;
    const bomA = await call<number>('save_bom_draft', { p_bom: { variant_id: abelha, units_per_plate: 10, est_print_minutes_per_plate: 140,
      lines: [{ item_id: plaAmarelo, qty_per_unit: 8, waste_pct: 0.05 }, { item_id: argola, qty_per_unit: 1 }, { item_id: saquinho, qty_per_unit: 1 }] } });
    const bomC = await call<number>('save_bom_draft', { p_bom: { variant_id: coracao, units_per_plate: 12, est_print_minutes_per_plate: 120,
      lines: [{ item_id: plaPreto, qty_per_unit: 6, waste_pct: 0.05 }] } });
    await call('activate_bom', { p_bom_id: bomA });
    await call('activate_bom', { p_bom_id: bomC });

    // Uma impressão concluída (com falha) e uma em andamento.
    const job = await call<{ print_job_id: number }>('plan_print_job', { p_request_id: randomUUID(), p_job: { equipment_id: printer, planned_for: `${day(-3)}T09:00:00-03:00`,
      outputs: [{ variant_id: abelha, qty_planned: 6 }, { variant_id: coracao, qty_planned: 4 }] } });
    await call('start_print_job', { p_request_id: randomUUID(), p_print_job_id: job.print_job_id, p_started_at: `${day(-3)}T09:00:00-03:00` });
    const outs = (await pg.query<{ id: number }>(`select id from public.print_job_outputs where print_job_id = $1 order by sort_order`, [job.print_job_id])).rows;
    await call('finish_print_job', { p_request_id: randomUUID(), p_print_job_id: job.print_job_id, p_result: {
      finished_at: `${day(-3)}T10:30:00-03:00`, actual_minutes: 90,
      materials: [{ item_id: plaAmarelo, actual_g: 52 }, { item_id: plaPreto, actual_g: 28 }],
      outputs: [{ output_id: outs[0]!.id, qty_good: 5, qty_failed: 1, failure_reason: 'DESCOLOU_MESA' }, { output_id: outs[1]!.id, qty_good: 4, qty_failed: 0 }] } });
    await call('record_post_process', { p_request_id: randomUUID(), p_output_id: outs[0]!.id, p_minutes: 10, p_kind: 'MONTAGEM' });
    await call('release_output', { p_request_id: randomUUID(), p_output_id: outs[0]!.id });
    const running = await call<{ print_job_id: number }>('plan_print_job', { p_request_id: randomUUID(), p_job: { equipment_id: printer, outputs: [{ variant_id: coracao, qty_planned: 12 }] } });
    await call('start_print_job', { p_request_id: randomUUID(), p_print_job_id: running.print_job_id });

    // Vendas.
    const instagram = (await one<{ id: number }>(`select id from public.sales_channels where name = 'Instagram / WhatsApp'`)).id;
    await call('register_historical_sale', { p_request_id: randomUUID(), p_sale: { date: day(-25), lines: [{ custom_description: 'Peça (antes do sistema)', qty: 2, unit_price: 5, unit_cost: 1.66 }] } });
    await call('quick_sale', { p_request_id: randomUUID(), p_sale: { channel_id: instagram, new_customer: { name: 'Cliente Demo Ana', instagram: '@ana.demo' },
      lines: [{ variant_id: abelha, qty: 2 }], payment: { account_id: bank }, delivered_at: `${day(-1)}T15:00:00-03:00` } });
    await call('create_order', { p_request_id: randomUUID(), p_order: { kind: 'ENCOMENDA', confirm: true, new_customer: { name: 'Escola Demo', phone: '11999990000' },
      due_date: day(6), lines: [{ variant_id: coracao, qty: 10, unit_price: 3.5 }],
      payment_terms: [{ label: 'Sinal', pct: 0.5, due_date: today }, { label: 'Na entrega', due_date: day(6) }] } });
    await call('create_expense', { p_request_id: randomUUID(), p_expense: { description: 'Internet (demonstração)',
      category_id: (await one<{ id: number }>(`select id from public.financial_categories where code = '4.3'`)).id,
      amount: 100, business_share_pct: 0.3, competence_date: day(-5), due_date: day(5), payer: 'EMPRESA' } });
  });
  await db.admin((pg) => pg.query(`insert into local_meta.seed (key, value) values ('demo', 'yes')`));
}
