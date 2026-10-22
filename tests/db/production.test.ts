import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, TestEnv } from './env';

/** Módulo 5 — produção e impressões (seção 11), com o teste de referência 11.3. */

let env: TestEnv;
let dono: string;
let producao: string;
let printer: number;
let pla: number;
let argola: number;
let abelha: number;
let coracao: number;

const rid = () => crypto.randomUUID();

async function balance(itemId: number) {
  return env.admin().one<{ qty_on_hand: string; avg_cost_total: string; avg_cost_material: string; avg_cost_operational: string; qty_reserved: string }>(
    `select * from public.stock_balances where item_id = $1`,
    [itemId],
  );
}

async function variantItem(variantId: number) {
  return (await env.admin().one<{ item_id: number }>(`select item_id from public.product_variants where id = $1`, [variantId])).item_id;
}

async function outputs(jobId: number) {
  return env.admin().query<Record<string, string | number | null>>(
    `select * from public.print_job_outputs where print_job_id = $1 order by sort_order`,
    [jobId],
  );
}

async function plan(variants: Array<[number, number]>, extra: Record<string, unknown> = {}) {
  return env.as(dono, (s) =>
    s.rpc<{ print_job_id: number; code: string; warnings: string[] }>('plan_print_job', {
      p_request_id: rid(),
      p_job: { equipment_id: printer, outputs: variants.map(([variant_id, qty_planned]) => ({ variant_id, qty_planned })), ...extra },
    }),
  );
}

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono');
  producao = await env.createMember('producao@wabee.test', 'producao');
  await env.as(dono, async (s) => {
    printer = await s.rpc<number>('save_equipment', { p_equipment: { name: 'Impressora 1' } });
    await s.rpc('create_cost_rate', { p_rate_type: 'OPERATIONAL_PER_HOUR', p_value: 1.2, p_valid_from: '2026-01-01' });
    pla = await s.rpc<number>('save_item', { p_item: { kind: 'FILAMENT', name: 'PLA preto', filament: { material: 'PLA', color_name: 'preto' } } });
    argola = await s.rpc<number>('save_item', { p_item: { kind: 'COMPONENT', name: 'Argola 25 mm' } });
    await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: pla, p_entries: [{ qty: 1000, unit_cost: 0.1 }, { qty: 1000, unit_cost: 0.1 }] });
    await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: argola, p_entries: [{ qty: 100, unit_cost: 0.3 }] });
    const pa = await s.rpc<number>('save_product', { p_product: { name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'preto', reference_price: 5 }] } });
    const pc = await s.rpc<number>('save_product', { p_product: { name: 'Chaveiro Coração', category: 'CHAVEIRO', variants: [{ name: 'preto', reference_price: 4 }] } });
    abelha = (await s.one<{ id: number }>(`select id from public.product_variants where product_id = $1`, [pa])).id;
    coracao = (await s.one<{ id: number }>(`select id from public.product_variants where product_id = $1`, [pc])).id;
    const bomA = await s.rpc<number>('save_bom_draft', {
      p_bom: { variant_id: abelha, units_per_plate: 10, est_print_minutes_per_plate: 120, lines: [{ item_id: pla, qty_per_unit: 8 }, { item_id: argola, qty_per_unit: 1 }] },
    });
    const bomC = await s.rpc<number>('save_bom_draft', {
      p_bom: { variant_id: coracao, units_per_plate: 10, est_print_minutes_per_plate: 100, lines: [{ item_id: pla, qty_per_unit: 6 }] },
    });
    await s.rpc('activate_bom', { p_bom_id: bomA });
    await s.rpc('activate_bom', { p_bom_id: bomC });
  });
});

afterAll(async () => {
  await env.close();
});

describe('teste de referência 11.3', () => {
  let job: number;

  it('planejamento preenche gramas e minutos pela ficha e verifica materiais (US-5.1, US-5.2)', async () => {
    const preview = await env.as(dono, (s) =>
      s.rpc<{ est_minutes: number; materials: Array<{ item_id: number; needed_g: number }>; components: Array<{ needed: number }>; cost: { total: number } }>(
        'preview_print_job',
        { p_job: { equipment_id: printer, outputs: [{ variant_id: abelha, qty_planned: 6 }, { variant_id: coracao, qty_planned: 4 }] } },
      ),
    );
    expect(n(preview.est_minutes)).toBe(112); // 6/10 × 120 + 4/10 × 100
    expect(n(preview.materials[0]!.needed_g)).toBe(72);
    expect(n(preview.components[0]!.needed)).toBe(6);
    const planned = await plan([[abelha, 6], [coracao, 4]]);
    job = planned.print_job_id;
    expect(planned.code).toMatch(/^IMP-\d{4}-0001$/);
    // Planejar não mexe no estoque.
    expect(n((await balance(pla)).qty_on_hand)).toBe(2000);
  });

  it('iniciar marca a impressora como ocupada (US-5.3)', async () => {
    const started = await env.as(dono, (s) => s.rpc<{ expected_end: string }>('start_print_job', { p_request_id: rid(), p_print_job_id: job }));
    expect(started.expected_end).toBeTruthy();
    const other = await plan([[coracao, 1]]);
    await expect(env.as(dono, (s) => s.rpc('start_print_job', { p_request_id: rid(), p_print_job_id: other.print_job_id }))).rejects.toThrow(/já está imprimindo/);
    await env.as(dono, (s) => s.rpc('cancel_print_job', { p_request_id: rid(), p_print_job_id: other.print_job_id }));
  });

  it('finalizar: 80 g, 90 min, 5 Abelhas boas + 1 falha, 4 Corações → custos da tabela 11.3', async () => {
    const outs = await outputs(job);
    const result = await env.as(dono, (s) =>
      s.rpc<{ cost_total: number; cost_scrap: number; released: unknown[] }>('finish_print_job', {
        p_request_id: rid(),
        p_print_job_id: job,
        p_result: {
          actual_minutes: 90,
          materials: [{ item_id: pla, actual_g: 80 }],
          outputs: [
            { output_id: outs[0]!.id, qty_good: 5, qty_failed: 1, failure_reason: 'DESCOLOU_MESA' },
            { output_id: outs[1]!.id, qty_good: 4, qty_failed: 0 },
          ],
        },
      }),
    );
    expect(n(result.cost_total)).toBe(9.8);
    expect(n(result.cost_scrap)).toBe(1.09);
    const j = await env.admin().one<Record<string, string>>(`select * from public.print_jobs where id = $1`, [job]);
    expect([n(j.cost_material), n(j.cost_operational), n(j.cost_total), j.status, j.rate_mode]).toEqual([8, 1.8, 9.8, 'CONCLUIDA', 'COMBINED']);

    const [a, c] = await outputs(job);
    expect(n(a!.alloc_material)).toBe(5.333333);
    expect(n(a!.alloc_operational)).toBe(1.2);
    expect(n(c!.alloc_material)).toBe(2.666667);
    expect(n(c!.alloc_operational)).toBe(0.6);
    expect(n(a!.allocation_share)).toBeCloseTo(0.666667, 6);
    // Custo unitário de impressão.
    expect(Number(((n(a!.alloc_material) + n(a!.alloc_operational)) / 6).toFixed(6))).toBe(1.088889);
    expect(Number(((n(c!.alloc_material) + n(c!.alloc_operational)) / 4).toFixed(6))).toBe(0.816667);
    // Soma alocada = custo da impressão; boas + falhas = custo da impressão.
    const allocated = n(a!.alloc_material) + n(a!.alloc_operational) + n(c!.alloc_material) + n(c!.alloc_operational);
    expect(allocated.toFixed(6)).toBe('9.800000');
    const good = [a!, c!].reduce((sum, o) => sum + n(o.good_material) + n(o.good_operational), 0);
    expect((good + n(a!.scrap_cost) + n(c!.scrap_cost)).toFixed(6)).toBe('9.800000');
    expect(n(a!.scrap_cost)).toBe(1.088889);
    // Saldo de PLA reduzido em 80 g.
    expect(n((await balance(pla)).qty_on_hand)).toBe(1920);
    // Coração (sem acabamento na ficha) entrou direto no estoque a R$ 0,816667.
    expect(c!.status).toBe('LIBERADA');
    const coracaoBal = await balance(await variantItem(coracao));
    expect(n(coracaoBal.qty_on_hand)).toBe(4);
    expect(n(coracaoBal.avg_cost_total)).toBe(0.816667);
    // Abelha (argola na montagem) aguarda acabamento.
    expect(a!.status).toBe('AGUARDANDO_ACABAMENTO');
    expect(n((await balance(await variantItem(abelha))).qty_on_hand)).toBe(0);
    // Custo de falhas no DRE do mês.
    const scrap = await env.admin().one<{ s: string }>(
      `select sum(amount)::text s from public.result_entries e join public.financial_categories c on c.id = e.category_id where c.code = '2.6'`,
    );
    expect(n(scrap.s)).toBe(-1.09);
  });

  it('liberação da Abelha + argola → 5 Abelhas a R$ 1,388889 (material 1,188889 + operacional 0,20)', async () => {
    const [a] = await outputs(job);
    await env.as(dono, (s) => s.rpc('release_output', { p_request_id: rid(), p_output_id: a!.id }));
    const bal = await balance(await variantItem(abelha));
    expect(n(bal.qty_on_hand)).toBe(5);
    expect(n(bal.avg_cost_total)).toBe(1.388889);
    expect(n(bal.avg_cost_material)).toBe(1.188889);
    expect(n(bal.avg_cost_operational)).toBe(0.2);
    expect(n((await balance(argola)).qty_on_hand)).toBe(95);
    expect(await env.admin().query(`select * from private.rebuild_balances()`)).toEqual([]);
  });
});

describe('acabamento, falhas e estorno', () => {
  it('trabalho do pós-processamento entra na camada trabalho; reprovadas vão para falhas (US-5.6, RN-09)', async () => {
    await env.as(dono, (s) => s.rpc('create_cost_rate', { p_rate_type: 'LABOR_PER_HOUR', p_value: 30, p_valid_from: '2026-01-01' }));
    const planned = await plan([[abelha, 4]]);
    const [o] = await outputs(planned.print_job_id);
    await env.as(producao, (s) =>
      s.rpc('finish_print_job', {
        p_request_id: rid(), p_print_job_id: planned.print_job_id,
        p_result: { actual_minutes: 60, materials: [{ item_id: pla, actual_g: 40 }], outputs: [{ output_id: o!.id, qty_good: 4, qty_failed: 0 }] },
      }),
    );
    await env.as(producao, (s) => s.rpc('record_post_process', { p_request_id: rid(), p_output_id: o!.id, p_minutes: 6, p_kind: 'MONTAGEM' }));
    await env.as(producao, (s) =>
      s.rpc('release_output', { p_request_id: rid(), p_output_id: o!.id, p_qty_approved: 3, p_reject_reason: 'Argola torta', p_rejected_assembled: true }),
    );
    const [after] = await outputs(planned.print_job_id);
    expect(after!.qty_released).toBe(3);
    expect(after!.qty_rejected).toBe(1);
    // 6 min × R$ 30/h = R$ 3,00 ÷ 3 aprovadas = R$ 1,00 por unidade na camada trabalho.
    expect(n(after!.unit_labor)).toBe(1);
    // 40 g × 0,10 = 4,00 + 1 h × 1,20 = 1,20 → 1,30 por peça; argola 0,30.
    expect(n(after!.unit_material)).toBe(1.3);
    expect(n(after!.unit_operational)).toBe(0.3);
    expect(n(after!.scrap_cost)).toBe(1.3);
    // 3 argolas montadas nas aprovadas + 1 perdida na reprovada.
    expect(n((await balance(argola)).qty_on_hand)).toBe(91);
  });

  it('falha total: filamento baixado e todo o custo vai para falhas; replanejar cria nova impressão (US-5.5)', async () => {
    const planned = await plan([[coracao, 5]]);
    const before = n((await balance(pla)).qty_on_hand);
    const result = await env.as(producao, (s) =>
      s.rpc<{ cost_scrap: number }>('fail_print_job', {
        p_request_id: rid(), p_print_job_id: planned.print_job_id,
        p_result: { actual_minutes: 30, materials: [{ item_id: pla, actual_g: 12 }], failure_reason: 'ENTUPIMENTO' },
      }),
    );
    expect(n(result.cost_scrap)).toBe(1.8); // 12 g × 0,10 + 0,5 h × 1,20
    expect(n((await balance(pla)).qty_on_hand)).toBe(before - 12);
    const job = await env.admin().one<{ status: string; failure_reason: string }>(`select status, failure_reason from public.print_jobs where id = $1`, [planned.print_job_id]);
    expect(job).toEqual({ status: 'FALHOU', failure_reason: 'ENTUPIMENTO' });
    const replanned = await env.as(producao, (s) => s.rpc<{ print_job_id: number }>('replan_print_job', { p_request_id: rid(), p_print_job_id: planned.print_job_id }));
    const copy = await env.admin().one<{ status: string; replanned_from_id: number }>(`select status, replanned_from_id from public.print_jobs where id = $1`, [replanned.print_job_id]);
    expect(copy).toEqual({ status: 'PLANEJADA', replanned_from_id: planned.print_job_id });
  });

  it('sem filamento suficiente, nada é gravado e a tela mostra o item em falta (US-5.4)', async () => {
    const planned = await plan([[coracao, 2]]);
    const [o] = await outputs(planned.print_job_id);
    await expect(
      env.as(dono, (s) =>
        s.rpc('finish_print_job', {
          p_request_id: rid(), p_print_job_id: planned.print_job_id,
          p_result: { actual_minutes: 20, materials: [{ item_id: pla, actual_g: 99999 }], outputs: [{ output_id: o!.id, qty_good: 2, qty_failed: 0 }] },
        }),
      ),
    ).rejects.toThrow(/Saldo insuficiente de "PLA preto/);
    const job = await env.admin().one<{ status: string }>(`select status from public.print_jobs where id = $1`, [planned.print_job_id]);
    expect(job.status).toBe('PLANEJADA');
  });

  it('estorno: bloqueado se as peças já saíram; liberado, reverte tudo numa transação (US-5.10)', async () => {
    const planned = await plan([[coracao, 3]]);
    const [o] = await outputs(planned.print_job_id);
    const plaBefore = n((await balance(pla)).qty_on_hand);
    const item = await variantItem(coracao);
    const fgBefore = n((await balance(item)).qty_on_hand);
    await env.as(dono, (s) =>
      s.rpc('finish_print_job', {
        p_request_id: rid(), p_print_job_id: planned.print_job_id,
        p_result: { actual_minutes: 30, materials: [{ item_id: pla, actual_g: 18 }], outputs: [{ output_id: o!.id, qty_good: 3, qty_failed: 0 }] },
      }),
    );
    // Saem do estoque 5 Corações (mais que as 4 de antes): as peças desta impressão não estão mais livres.
    await env.as(dono, (s) => s.rpc('register_stock_issue', { p_request_id: rid(), p_item_id: item, p_type: 'GIFT', p_qty: fgBefore + 1, p_reason: 'Brindes da feira' }));
    await expect(env.as(dono, (s) => s.rpc('reverse_print_job', { p_request_id: rid(), p_print_job_id: planned.print_job_id, p_reason: 'Lançada errada' }))).rejects.toThrow(
      /já foram entregues ou reservadas/,
    );
    const gift = await env.admin().one<{ id: number }>(`select id from public.stock_movements where item_id = $1 and type = 'GIFT' order by id desc limit 1`, [item]);
    await env.as(dono, (s) => s.rpc('reverse_movement', { p_request_id: rid(), p_movement_id: gift.id, p_reason: 'Brinde não aconteceu' }));
    await env.as(dono, (s) => s.rpc('reverse_print_job', { p_request_id: rid(), p_print_job_id: planned.print_job_id, p_reason: 'Lançada errada' }));
    expect(n((await balance(pla)).qty_on_hand)).toBe(plaBefore);
    expect(n((await balance(item)).qty_on_hand)).toBe(fgBefore);
    const job = await env.admin().one<{ status: string }>(`select status from public.print_jobs where id = $1`, [planned.print_job_id]);
    expect(job.status).toBe('ESTORNADA');
    expect(await env.admin().query(`select * from private.rebuild_balances()`)).toEqual([]);
  });

  it('estorno bloqueado quando peças da impressão foram vendidas, mesmo com estoque reposto por outra impressão (RN-21)', async () => {
    const item = await variantItem(coracao);
    const finish = async (jobId: number, qty: number) => {
      const [o] = await outputs(jobId);
      await env.as(dono, (s) =>
        s.rpc('finish_print_job', {
          p_request_id: rid(), p_print_job_id: jobId,
          p_result: { actual_minutes: 20, materials: [{ item_id: pla, actual_g: qty * 6 }], outputs: [{ output_id: o!.id, qty_good: qty, qty_failed: 0 }] },
        }),
      );
    };
    const before = n((await balance(item)).qty_on_hand);
    const first = await plan([[coracao, 3]]);
    await finish(first.print_job_id, 3);
    // Vende tudo o que havia antes + 2 peças desta impressão.
    const direct = await env.admin().one<{ id: number }>(`select id from public.sales_channels where name = 'Venda direta'`);
    const sale = await env.as(dono, (s) =>
      s.rpc<{ order_id: number }>('quick_sale', { p_request_id: rid(), p_sale: { channel_id: direct.id, lines: [{ variant_id: coracao, qty: before + 2, unit_price: 4 }], packaging: [] } }),
    );
    const number = (await env.admin().one<{ number: string }>(`select number from public.sales_orders where id = $1`, [sale.order_id])).number;
    // Outra impressão repõe o estoque: há saldo livre, mas as peças da primeira já foram entregues.
    const second = await plan([[coracao, 5]]);
    await finish(second.print_job_id, 5);
    await expect(
      env.as(dono, (s) => s.rpc('reverse_print_job', { p_request_id: rid(), p_print_job_id: first.print_job_id, p_reason: 'Lançada errada' })),
    ).rejects.toThrow(new RegExp(`entregues em ${number}`));
    // A segunda não teve peças vendidas depois dela: pode ser estornada.
    await env.as(dono, (s) => s.rpc('reverse_print_job', { p_request_id: rid(), p_print_job_id: second.print_job_id, p_reason: 'Lançada errada' }));
    expect(await env.admin().query(`select * from private.rebuild_balances()`)).toEqual([]);
  });

  it('falhas absorvidas pelas peças boas quando configurado (absorb_scrap_cost)', async () => {
    await env.admin().query(`update public.settings set absorb_scrap_cost = true`);
    const planned = await plan([[coracao, 4]]);
    const [o] = await outputs(planned.print_job_id);
    await env.as(dono, (s) =>
      s.rpc('finish_print_job', {
        p_request_id: rid(), p_print_job_id: planned.print_job_id,
        p_result: { actual_minutes: 60, materials: [{ item_id: pla, actual_g: 28 }], outputs: [{ output_id: o!.id, qty_good: 2, qty_failed: 2, failure_reason: 'UMIDADE' }] },
      }),
    );
    const [after] = await outputs(planned.print_job_id);
    expect(n(after!.scrap_cost)).toBe(0);
    expect(n(after!.unit_total)).toBe(2); // (2,80 + 1,20) ÷ 2 boas
    await env.admin().query(`update public.settings set absorb_scrap_cost = false`);
  });
});

describe('perfil Produção (US-0.3)', () => {
  it('vê as impressões sem valores e não acessa as tabelas de custo', async () => {
    const jobs = await env.as(producao, (s) => s.query<{ code: string; cost_total: string | null; qty_planned: number }>(`select code, cost_total, qty_planned from public.v_print_jobs`));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.cost_total === null)).toBe(true);
    const outs = await env.as(producao, (s) => s.query<{ unit_total: string | null }>(`select unit_total from public.v_print_job_outputs`));
    expect(outs.every((o) => o.unit_total === null)).toBe(true);
    expect(await env.as(producao, (s) => s.query(`select * from public.print_jobs`))).toEqual([]);
    const preview = await env.as(producao, (s) =>
      s.rpc<{ cost: unknown }>('preview_print_job', { p_job: { equipment_id: printer, outputs: [{ variant_id: coracao, qty_planned: 1 }] } }),
    );
    expect(preview.cost).toBeNull();
  });

  it('dono vê os valores nas mesmas views', async () => {
    const jobs = await env.as(dono, (s) => s.query<{ cost_total: string | null }>(`select cost_total from public.v_print_jobs where status = 'CONCLUIDA'`));
    expect(jobs.every((j) => j.cost_total !== null)).toBe(true);
  });

  it('produção não estorna impressão (só o dono)', async () => {
    const job = await env.admin().one<{ id: number }>(`select id from public.print_jobs where status = 'CONCLUIDA' order by id limit 1`);
    await expect(env.as(producao, (s) => s.rpc('reverse_print_job', { p_request_id: rid(), p_print_job_id: job.id, p_reason: 'teste' }))).rejects.toThrow(/permissão/);
  });
});
