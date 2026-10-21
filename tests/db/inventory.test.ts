import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, type Session, TestEnv } from './env';

/**
 * Módulo 1 — itens e estoque (seção 7) e utilitários da fundação (US-0.8).
 * Cada critério de aceite da especificação vira pelo menos um teste.
 */

let env: TestEnv;
let dono: string;
let producao: string;
let leitura: string;

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono', 'Dono');
  producao = await env.createMember('producao@wabee.test', 'producao', 'Ajudante');
  leitura = await env.createMember('contador@wabee.test', 'leitura', 'Contador');
});

afterAll(async () => {
  await env.close();
});

const rid = () => crypto.randomUUID();

async function createFilament(s: Session, color: string, brand = 'Marca X', material = 'PLA') {
  return s.rpc<number>('save_item', {
    p_item: { kind: 'FILAMENT', name: `${material} ${color} — ${brand}`, filament: { material, brand, color_name: color, color_hex: '#111111' } },
  });
}

async function balance(itemId: number) {
  return env.admin().one<{ qty_on_hand: string; avg_cost_total: string; avg_cost_material: string; value_total: string; qty_reserved: string }>(
    `select * from public.stock_balances where item_id = $1`,
    [itemId],
  );
}

describe('utilitários (US-0.8)', () => {
  it('split_amount reproduz as parcelas reais da Wabee (RN-25)', async () => {
    const a = await env.admin().one<{ r: string[] }>(`select private.split_amount(5646.19, 18)::text[] as r`);
    expect(a.r.slice(0, 17).every((v) => v === '313.68')).toBe(true);
    expect(a.r[17]).toBe('313.63');
    const b = await env.admin().one<{ r: string[] }>(`select private.split_amount(2863.11, 12)::text[] as r`);
    expect(b.r.slice(0, 11).every((v) => v === '238.59')).toBe(true);
    expect(b.r[11]).toBe('238.62');
  });

  it('split_amount sempre soma o total (propriedade)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 50_000_000 }), fc.integer({ min: 1, max: 48 }), async (cents, parts) => {
        const total = (cents / 100).toFixed(2);
        const row = await env.admin().one<{ s: string; c: number }>(
          `select sum(x)::text as s, count(*)::int as c from unnest(private.split_amount($1::numeric, $2)) x`,
          [total, parts],
        );
        expect(Number(row.s).toFixed(2)).toBe(total);
        expect(row.c).toBe(parts);
      }),
      { numRuns: 60 },
    );
  });

  it('allocate_money manda a diferença de centavos para a linha de maior valor (RN-02)', async () => {
    const row = await env.admin().one<{ r: string[] }>(`select private.allocate_money(10, array[1, 1, 1]::numeric[])::text[] as r`);
    expect(row.r).toEqual(['3.34', '3.33', '3.33']);
    const row2 = await env.admin().one<{ r: string[] }>(`select private.allocate_money(10, array[1, 2, 1]::numeric[])::text[] as r`);
    expect(row2.r).toEqual(['2.50', '5.00', '2.50']);
  });

  it('numeração anual consecutiva por tipo (RN-28)', async () => {
    const first = await env.admin().one<{ n: string }>(`select private.next_doc_number('TST', '2026-05-01') as n`);
    const second = await env.admin().one<{ n: string }>(`select private.next_doc_number('TST', '2026-12-31') as n`);
    const other = await env.admin().one<{ n: string }>(`select private.next_doc_number('TST', '2027-01-01') as n`);
    expect(first.n).toBe('TST-2026-0001');
    expect(second.n).toBe('TST-2026-0002');
    expect(other.n).toBe('TST-2027-0001');
  });
});

describe('cadastro de itens (US-1.1, US-1.2)', () => {
  it('gera SKU no padrão e sugere densidade do material', async () => {
    const id = await env.as(dono, (s) => createFilament(s, 'preto'));
    const item = await env.admin().one<{ sku: string; unit: string; density_g_cm3: string }>(
      `select i.sku, i.unit, f.density_g_cm3 from public.items i join public.filament_specs f on f.item_id = i.id where i.id = $1`,
      [id],
    );
    expect(item.sku).toBe('FIL-PLA-PRT-001');
    expect(item.unit).toBe('G');
    expect(n(item.density_g_cm3)).toBe(1.24);
    const argola = await env.as(dono, (s) => s.rpc<number>('save_item', { p_item: { kind: 'COMPONENT', name: 'Argola 25 mm' } }));
    const sku = await env.admin().one<{ sku: string }>(`select sku from public.items where id = $1`, [argola]);
    expect(sku.sku).toBe('CMP-ARG-25-001');
  });

  it('avisa duplicidade de material, marca e cor', async () => {
    await expect(env.as(dono, (s) => createFilament(s, 'Preto'))).rejects.toThrow(/Já existe o filamento/);
  });

  it('bloqueia mudar tipo ou unidade de item com movimentações', async () => {
    const id = await env.as(dono, (s) => s.rpc<number>('save_item', { p_item: { kind: 'CONSUMABLE', name: 'Álcool isopropílico', unit: 'ML' } }));
    await env.as(dono, (s) => s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: id, p_entries: [{ qty: 500, unit_cost: 0.04 }] }));
    await expect(
      env.as(dono, (s) => s.rpc('save_item', { p_item: { id, kind: 'CONSUMABLE', name: 'Álcool', unit: 'UN' } })),
    ).rejects.toThrow(/tipo e a unidade não podem mudar/);
  });

  it('só o dono cadastra; leitura e produção recebem erro de permissão', async () => {
    await expect(env.as(leitura, (s) => s.rpc('save_item', { p_item: { kind: 'COMPONENT', name: 'Ímã 6mm' } }))).rejects.toThrow(/permissão/);
    await expect(env.as(producao, (s) => s.rpc('save_item', { p_item: { kind: 'COMPONENT', name: 'Ímã 6mm' } }))).rejects.toThrow(/permissão/);
  });
});

describe('razão de estoque (seção 7.1)', () => {
  let pla: number;

  beforeAll(async () => {
    pla = await env.as(dono, (s) => createFilament(s, 'amarelo'));
  });

  it('RN-01: 400 g a R$ 0,10 + carretel de 1.000 g a R$ 0,12 → R$ 0,114286/g', async () => {
    await env.as(dono, (s) => s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: pla, p_entries: [{ qty: 400, unit_cost: 0.1 }] }));
    // Entrada de compra simulada direto pelo serviço central (o módulo de compras usa o mesmo caminho).
    await env.admin().query(`select private.receive_stock($1, 1000, 'PURCHASE_RECEIPT', now(), row(0.12,0,0,0,0)::private.cost_layers, 'test', null)`, [pla]);
    const b = await balance(pla);
    expect(n(b.qty_on_hand)).toBe(1400);
    expect(n(b.avg_cost_total)).toBe(0.114286);
    expect(n(b.value_total)).toBe(160);
  });

  it('não aceita um segundo saldo inicial (orienta o ajuste)', async () => {
    await expect(
      env.as(dono, (s) => s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: pla, p_entries: [{ qty: 10 }] })),
    ).rejects.toThrow(/já tem saldo inicial/);
  });

  it('saída divide o consumo entre carretéis, começando pelo aberto (US-1.6)', async () => {
    const result = await env.as(dono, (s) =>
      s.rpc<{ movement_ids: number[] }>('register_stock_issue', {
        p_request_id: rid(), p_item_id: pla, p_type: 'LOSS', p_qty: 500, p_reason: 'Umidade na ponta do carretel',
      }),
    );
    expect(result.movement_ids).toHaveLength(2);
    const lots = await env.admin().query<{ qty_remaining: string; status: string }>(
      `select qty_remaining, status from public.stock_lots where item_id = $1 order by id`,
      [pla],
    );
    expect(lots.map((l) => [n(l.qty_remaining), l.status])).toEqual([
      [0, 'ESGOTADO'],
      [900, 'ABERTO'],
    ]);
    const b = await balance(pla);
    expect(n(b.qty_on_hand)).toBe(900);
    expect(n(b.avg_cost_total)).toBe(0.114286); // saída não altera o custo médio
    const loss = await env.admin().one<{ s: string }>(
      `select sum(amount)::text as s from public.result_entries e join public.financial_categories c on c.id = e.category_id where c.code = '2.7'`,
    );
    expect(n(loss.s)).toBeCloseTo(-57.14, 2);
  });

  it('bloqueia saída acima do saldo livre (RN-20) e mostra o disponível', async () => {
    await expect(
      env.as(dono, (s) => s.rpc('register_stock_issue', { p_request_id: rid(), p_item_id: pla, p_type: 'LOSS', p_qty: 5000, p_reason: 'teste' })),
    ).rejects.toThrow(/disponível 900 g/);
  });

  it('estorno recria o movimento inverso com o mesmo custo e só uma vez (US-1.12, RN-21)', async () => {
    const issue = await env.as(dono, (s) =>
      s.rpc<{ movement_ids: number[] }>('register_stock_issue', {
        p_request_id: rid(), p_item_id: pla, p_type: 'GIFT', p_qty: 100, p_reason: 'Brinde para cliente fiel',
      }),
    );
    expect(n((await balance(pla)).qty_on_hand)).toBe(800);
    await env.as(dono, (s) => s.rpc('reverse_movement', { p_request_id: rid(), p_movement_id: issue.movement_ids[0], p_reason: 'Lançado errado' }));
    const b = await balance(pla);
    expect(n(b.qty_on_hand)).toBe(900);
    expect(n(b.avg_cost_total)).toBe(0.114286);
    await expect(
      env.as(dono, (s) => s.rpc('reverse_movement', { p_request_id: rid(), p_movement_id: issue.movement_ids[0], p_reason: 'De novo' })),
    ).rejects.toThrow(/já foi estornada/);
    const marketing = await env.admin().one<{ s: string }>(
      `select coalesce(sum(amount), 0)::text as s from public.result_entries e join public.financial_categories c on c.id = e.category_id where c.code = '3.5'`,
    );
    expect(n(marketing.s)).toBe(0); // brinde lançado e estornado
  });

  it('uso pessoal vira retirada em bens do dono, não despesa (US-1.9)', async () => {
    await env.as(dono, (s) => s.rpc('register_stock_issue', { p_request_id: rid(), p_item_id: pla, p_type: 'PERSONAL_USE', p_qty: 50, p_reason: 'Peça para casa' }));
    const owner = await env.admin().one<{ kind: string; amount: string; direction: string }>(
      `select kind, amount, direction from public.owner_movements order by id desc limit 1`,
    );
    expect(owner).toMatchObject({ kind: 'GOODS_WITHDRAWAL', direction: 'EMPRESA_PARA_DONO' });
    expect(n(owner.amount)).toBeCloseTo(5.71, 2);
  });

  it('pesagem: restante = peso bruto − tara; diferença acima de 10% pede confirmação (US-1.7)', async () => {
    await env.as(dono, (s) =>
      s.rpc('save_item', {
        p_item: { id: pla, kind: 'FILAMENT', name: 'PLA amarelo — Marca X', filament: { material: 'PLA', brand: 'Marca X', color_name: 'amarelo', empty_spool_tare_g: 200 } },
      }),
    );
    const lot = await env.admin().one<{ id: number; qty_remaining: string }>(
      `select id, qty_remaining from public.stock_lots where item_id = $1 and qty_remaining > 0`,
      [pla],
    );
    expect(n(lot.qty_remaining)).toBe(850);
    await expect(
      env.as(dono, (s) => s.rpc('adjust_stock', { p_request_id: rid(), p_item_id: pla, p_lot_id: lot.id, p_counted_qty: null, p_gross_weight_g: 900, p_reason: 'pesagem' })),
    ).rejects.toThrow(/passa de 10%/);
    const result = await env.as(dono, (s) =>
      s.rpc<{ diff: number }>('adjust_stock', {
        p_request_id: rid(), p_item_id: pla, p_lot_id: lot.id, p_counted_qty: null, p_gross_weight_g: 1010, p_reason: 'pesagem',
      }),
    );
    expect(n(result.diff)).toBe(-40);
    expect(n((await balance(pla)).qty_on_hand)).toBe(810);
  });

  it('idempotência: o mesmo formulário enviado duas vezes grava uma vez só', async () => {
    const key = rid();
    const first = await env.as(dono, (s) => s.rpc<{ movement_ids: number[] }>('register_stock_issue', { p_request_id: key, p_item_id: pla, p_type: 'LOSS', p_qty: 10, p_reason: 'duplo clique' }));
    const second = await env.as(dono, (s) => s.rpc<{ movement_ids: number[] }>('register_stock_issue', { p_request_id: key, p_item_id: pla, p_type: 'LOSS', p_qty: 10, p_reason: 'duplo clique' }));
    expect(second).toEqual(first);
    expect(n((await balance(pla)).qty_on_hand)).toBe(800);
  });

  it('o razão é imutável e o cache bate com o razão (rebuild_balances)', async () => {
    await expect(env.admin().query(`update public.stock_movements set qty = 1 where item_id = $1`, [pla])).rejects.toThrow(/imutável/);
    await expect(env.admin().query(`delete from public.stock_movements where item_id = $1`, [pla])).rejects.toThrow(/imutável/);
    expect(await env.admin().query(`select * from private.rebuild_balances()`)).toEqual([]);
  });

  it('custo de referência quando não se sabe o custo do filamento (US-1.3)', async () => {
    const branco = await env.as(dono, (s) => createFilament(s, 'branco'));
    await env.as(dono, (s) => s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: branco, p_entries: [{ qty: 750 }, { qty: 1000 }] }));
    const lots = await env.admin().query<{ reference_cost: boolean; unit_cost_in: string }>(`select reference_cost, unit_cost_in from public.stock_lots where item_id = $1`, [branco]);
    expect(lots).toHaveLength(2);
    expect(lots.every((l) => l.reference_cost && n(l.unit_cost_in) === 0.1)).toBe(true);
    expect(n((await balance(branco)).value_total)).toBe(175);
  });
});

describe('propriedade do razão (seção 16.3)', () => {
  it('qualquer sequência válida mantém saldo ≥ 0, saldo = soma do razão e custo médio ≥ 0', async () => {
    const item = await env.as(dono, (s) => s.rpc<number>('save_item', { p_item: { kind: 'COMPONENT', name: `Ímã propriedade` } }));
    const op = fc.oneof(
      fc.record({ kind: fc.constant('in' as const), qty: fc.integer({ min: 1, max: 500 }), cost: fc.integer({ min: 0, max: 5000 }) }),
      fc.record({ kind: fc.constant('out' as const), qty: fc.integer({ min: 1, max: 400 }) }),
      fc.record({ kind: fc.constant('adjust' as const), qty: fc.integer({ min: 0, max: 800 }) }),
      fc.record({ kind: fc.constant('reverse' as const) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 12 }), async (ops) => {
        for (const o of ops) {
          if (o.kind === 'in') {
            // Entrada de compra direto pelo serviço central (como o recebimento de compras faz).
            await env.admin().query(
              `select private.receive_stock($1, $2, 'PURCHASE_RECEIPT', now(), row($3::numeric / 1000, 0, 0, 0, 0)::private.cost_layers, 'test', null)`,
              [item, o.qty, o.cost],
            );
            continue;
          }
          await env
            .as(dono, async (s) => {
              if (o.kind === 'out') {
                await s.rpc('register_stock_issue', { p_request_id: rid(), p_item_id: item, p_type: 'LOSS', p_qty: o.qty, p_reason: 'propriedade' });
              } else if (o.kind === 'adjust') {
                await s.rpc('adjust_stock', { p_request_id: rid(), p_item_id: item, p_counted_qty: o.qty, p_reason: 'contagem', p_confirm_large: true });
              } else {
                const last = await s.query<{ id: number }>(
                  `select m.id from public.stock_movements m where m.item_id = $1 and m.source_type in ('stock_issue', 'stock_adjustment') and m.type <> 'REVERSAL'
                     and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id) order by m.id desc limit 1`,
                  [item],
                );
                if (last[0]) await s.rpc('reverse_movement', { p_request_id: rid(), p_movement_id: last[0].id, p_reason: 'propriedade' });
              }
            })
            .catch((error: Error) => {
              // Saídas acima do saldo são recusadas (RN-20) — esperado.
              if (!/insuficiente/.test(error.message)) throw error;
            });
        }
        const b = await balance(item);
        const sum = await env.admin().one<{ s: string }>(`select coalesce(sum(qty), 0)::text as s from public.stock_movements where item_id = $1`, [item]);
        expect(n(b.qty_on_hand)).toBeGreaterThanOrEqual(0);
        expect(n(b.qty_on_hand)).toBe(n(sum.s));
        expect(n(b.avg_cost_total)).toBeGreaterThanOrEqual(0);
        expect(await env.admin().query(`select * from private.rebuild_balances() where item_id = $1`, [item])).toEqual([]);
      }),
      { numRuns: 15 },
    );
  });
});

describe('fechamento de mês (RN-22)', () => {
  it('mês fechado recusa operação com data dentro dele', async () => {
    const item = await env.as(dono, (s) => s.rpc<number>('save_item', { p_item: { kind: 'PACKAGING', name: 'Saquinho kraft' } }));
    await env.admin().query(`insert into public.month_closes (month, status) values ('2026-01-01', 'FECHADO')`);
    await expect(
      env.as(dono, (s) =>
        s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: item, p_entries: [{ qty: 10, unit_cost: 0.5 }], p_occurred_at: '2026-01-15T12:00:00-03:00' }),
      ),
    ).rejects.toThrow(/está fechado/);
  });
});

describe('segurança básica', () => {
  it('toda tabela tem RLS e anon não acessa nada', async () => {
    const rows = await env.admin().query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it('produção não lê tabelas com valores financeiros', async () => {
    const rows = await env.as(producao, (s) => s.query(`select * from public.stock_balances`));
    expect(rows).toEqual([]);
    const lancamentos = await env.as(producao, (s) => s.query(`select * from public.result_entries`));
    expect(lancamentos).toEqual([]);
  });

  it('auditoria registra cadastros e operações', async () => {
    const rows = await env.admin().query<{ action: string; model_label: string }>(`select action, model_label from public.audit_logs`);
    expect(rows.some((r) => r.action === 'CREATE' && r.model_label === 'item')).toBe(true);
    expect(rows.some((r) => r.action === 'REVERSE' && r.model_label === 'stock_movement')).toBe(true);
    await expect(env.admin().query(`update public.audit_logs set summary = 'x'`)).rejects.toThrow(/imutável/);
  });
});

describe('privilégios (com e sem "expose new tables")', () => {
  it('anon não tem privilégio algum em tabelas públicas e authenticated só lê', async () => {
    const anon = await env.admin().query(
      `select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`,
    );
    expect(anon).toEqual([]);
    const writes = await env.admin().query(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'`,
    );
    expect(writes).toEqual([]);
  });

  it('anon não executa RPCs e authenticated não executa funções internas', async () => {
    await expect(env.anon((s) => s.rpc('save_item', { p_item: { kind: 'COMPONENT', name: 'x' } }))).rejects.toThrow(/permission denied/);
    await expect(env.as(dono, (s) => s.query(`select private.next_doc_number('X')`))).rejects.toThrow(/permission denied/);
  });
});

describe('formatação brasileira nas mensagens', () => {
  it('fmt_num e fmt_money', async () => {
    const row = await env.admin().one<Record<string, string>>(
      `select private.fmt_num(1234.5) a, private.fmt_num(400) b, private.fmt_num(-0.125) c, private.fmt_money(1234.5) d, private.fmt_money(0) e`,
    );
    expect(row).toEqual({ a: '1.234,5', b: '400', c: '-0,125', d: 'R$ 1.234,50', e: 'R$ 0,00' });
  });
});
