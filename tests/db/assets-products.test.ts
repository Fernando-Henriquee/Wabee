import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, TestEnv } from './env';

/** Módulo 2 (equipamentos e taxas) e Módulo 4 (produtos, fichas técnicas, preços). */

let env: TestEnv;
let dono: string;
let leitura: string;

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono');
  leitura = await env.createMember('leitura@wabee.test', 'leitura');
});

afterAll(async () => {
  await env.close();
});

const rid = () => crypto.randomUUID();

describe('taxas com vigência e get_rates (RN-04, RN-05, RN-06, US-2.2)', () => {
  let printer: number;
  let printer2: number;

  beforeAll(async () => {
    printer = await env.as(dono, (s) =>
      s.rpc<number>('save_equipment', {
        p_equipment: { name: 'Impressora 1', acquisition_cost: 3000, residual_value: 300, useful_life_hours: 5000, avg_power_w: 120 },
      }),
    );
    printer2 = await env.as(dono, (s) => s.rpc<number>('save_equipment', { p_equipment: { name: 'Impressora 2' } }));
  });

  it('sem nenhuma taxa: modo MISSING com zero', async () => {
    const r = await env.as(dono, (s) => s.one<{ mode: string; operational_h: string }>(`select (public.get_rates($1, '2026-10-01')).*`, [printer]));
    expect(r.mode).toBe('MISSING');
    expect(n(r.operational_h)).toBe(0);
  });

  it('taxa combinada global de R$ 1,20 vale a partir da data de início', async () => {
    await env.as(dono, (s) => s.rpc('create_cost_rate', { p_rate_type: 'OPERATIONAL_PER_HOUR', p_value: 1.2, p_valid_from: '2026-10-01' }));
    const before = await env.as(dono, (s) => s.one<{ mode: string }>(`select (public.get_rates($1, '2026-09-30')).*`, [printer]));
    const after = await env.as(dono, (s) => s.one<{ mode: string; operational_h: string }>(`select (public.get_rates($1, '2026-10-21')).*`, [printer]));
    expect(before.mode).toBe('MISSING');
    expect(after.mode).toBe('COMBINED');
    expect(n(after.operational_h)).toBe(1.2);
  });

  it('nova vigência do mesmo tipo encerra a anterior no dia anterior; sobreposição é recusada', async () => {
    await env.as(dono, (s) => s.rpc('create_cost_rate', { p_rate_type: 'OPERATIONAL_PER_HOUR', p_value: 1.5, p_valid_from: '2026-11-15' }));
    const rates = await env.admin().query<{ value: string; valid_from: string; valid_to: string | null }>(
      `select value, valid_from::text, valid_to::text from public.cost_rates where rate_type = 'OPERATIONAL_PER_HOUR' order by valid_from`,
    );
    expect(rates.map((r) => [n(r.value), r.valid_from, r.valid_to])).toEqual([
      [1.2, '2026-10-01', '2026-11-14'],
      [1.5, '2026-11-15', null],
    ]);
    const mid = await env.as(dono, (s) => s.one<{ operational_h: string }>(`select (public.get_rates($1, '2026-11-14')).*`, [printer]));
    expect(n(mid.operational_h)).toBe(1.2); // mudança no meio do mês: cada dia usa a sua taxa
    await expect(
      env.as(dono, (s) => s.rpc('create_cost_rate', { p_rate_type: 'OPERATIONAL_PER_HOUR', p_value: 2, p_valid_from: '2026-11-01' })),
    ).rejects.toThrow(/Já existe uma taxa/);
    await expect(
      env.admin().query(`insert into public.cost_rates (rate_type, value, valid_from) values ('OPERATIONAL_PER_HOUR', 9, '2026-10-05')`),
    ).rejects.toThrow(/cost_rates_no_overlap/);
  });

  it('valor de taxa usada não pode ser editado', async () => {
    await expect(env.admin().query(`update public.cost_rates set value = 9 where rate_type = 'OPERATIONAL_PER_HOUR'`)).rejects.toThrow(/nova vigência/);
  });

  it('energia + depreciação separadas: SPLIT com operacional = 0; específica do equipamento vale antes da global', async () => {
    // Energia calculada: 120 W × R$ 0,95/kWh = R$ 0,114/h (RN-04)
    await env.as(dono, (s) => s.rpc('create_cost_rate', { p_rate_type: 'ENERGY_PRICE_KWH', p_value: 0.95, p_valid_from: '2026-12-01' }));
    // Depreciação: (3.000 − 300) / 5.000 = R$ 0,54/h (RN-05)
    await env.as(dono, (s) =>
      s.rpc('create_cost_rate', { p_rate_type: 'DEPRECIATION_PER_HOUR', p_value: 0.54, p_valid_from: '2026-12-01', p_equipment_id: printer }),
    );
    const r = await env.as(dono, (s) =>
      s.one<{ mode: string; energy_h: string; depreciation_h: string; operational_h: string }>(`select (public.get_rates($1, '2026-12-10')).*`, [printer]),
    );
    expect(r.mode).toBe('SPLIT');
    expect(n(r.energy_h)).toBe(0.114);
    expect(n(r.depreciation_h)).toBe(0.54);
    expect(n(r.operational_h)).toBe(0);
    // A impressora 2 não tem potência nem depreciação própria: continua na taxa combinada.
    const other = await env.as(dono, (s) => s.one<{ mode: string; operational_h: string }>(`select (public.get_rates($1, '2026-12-10')).*`, [printer2]));
    expect(other.mode).toBe('COMBINED');
    expect(n(other.operational_h)).toBe(1.5);
  });

  it('equipamento totalmente depreciado: depreciação passa a zero', async () => {
    await env.as(dono, (s) => s.rpc('save_equipment', { p_equipment: { id: printer, name: 'Impressora 1', useful_life_hours: 5000, initial_hours: 5000, avg_power_w: 120 } }));
    const r = await env.as(dono, (s) => s.one<{ depreciation_h: string; fully_depreciated: boolean }>(`select (public.get_rates($1, '2026-12-10')).*`, [printer]));
    expect(n(r.depreciation_h)).toBe(0);
    expect(r.fully_depreciated).toBe(true);
  });

  it('dividir a taxa combinada encerra a combinada e cria as duas novas numa transação (US-2.5)', async () => {
    const result = await env.as(dono, (s) =>
      s.rpc<{ closed_rate_id: number }>('split_operational_rate', { p_valid_from: '2027-01-01', p_energy_h: 0.2, p_depreciation_h: 1.3, p_equipment_id: printer2 }),
    );
    expect(result.closed_rate_id).toBeNull(); // a combinada é global; a divisão é só da impressora 2
    const r = await env.as(dono, (s) => s.one<{ mode: string; energy_h: string; depreciation_h: string }>(`select (public.get_rates($1, '2027-01-02')).*`, [printer2]));
    expect(r.mode).toBe('SPLIT');
    expect(n(r.energy_h) + n(r.depreciation_h)).toBe(1.5);
  });
});

describe('produtos, variações e fichas técnicas (US-4.1 a US-4.5)', () => {
  let product: number;
  let amarelo: number;
  let pla: number;
  let argola: number;
  let saquinho: number;

  beforeAll(async () => {
    await env.as(dono, async (s) => {
      pla = await s.rpc<number>('save_item', { p_item: { kind: 'FILAMENT', name: 'PLA preto', filament: { material: 'PLA', color_name: 'preto' } } });
      argola = await s.rpc<number>('save_item', { p_item: { kind: 'COMPONENT', name: 'Argola 25 mm' } });
      saquinho = await s.rpc<number>('save_item', { p_item: { kind: 'PACKAGING', name: 'Saquinho kraft' } });
      await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: pla, p_entries: [{ qty: 1000, unit_cost: 0.1 }] });
      await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: argola, p_entries: [{ qty: 100, unit_cost: 0.3 }] });
      await s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: saquinho, p_entries: [{ qty: 100, unit_cost: 0.25 }] });
    });
  });

  it('cria uma variação por cor, com SKU e item de produto pronto vinculado', async () => {
    product = await env.as(dono, (s) =>
      s.rpc<number>('save_product', {
        p_product: { name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'amarelo', reference_price: 5 }, { name: 'preto' }] },
      }),
    );
    const variants = await env.admin().query<{ id: number; sku: string; kind: string; item_name: string }>(
      `select v.id, v.sku, i.kind, i.name as item_name from public.product_variants v join public.items i on i.id = v.item_id
       where v.product_id = $1 order by v.id`,
      [product],
    );
    expect(variants.map((v) => v.sku)).toEqual(['PRD-ABELHA-AMA', 'PRD-ABELHA-PRE']);
    expect(variants.every((v) => v.kind === 'FINISHED_GOOD')).toBe(true);
    expect(variants[0]!.item_name).toBe('Chaveiro Abelha — amarelo');
    amarelo = variants[0]!.id;
  });

  it('produto pronto não é cadastrado como item avulso', async () => {
    await expect(env.as(dono, (s) => s.rpc('save_item', { p_item: { kind: 'FINISHED_GOOD', name: 'X' } }))).rejects.toThrow(/variação do produto/);
  });

  it('ficha: momento padrão por tipo de linha e custo estimado por camada (US-4.2, US-4.4)', async () => {
    const bom = await env.as(dono, (s) =>
      s.rpc<number>('save_bom_draft', {
        p_bom: {
          variant_id: amarelo,
          units_per_plate: 6,
          est_print_minutes_per_plate: 90,
          lines: [
            { item_id: pla, qty_per_unit: 8, waste_pct: 0.125 },
            { item_id: argola, qty_per_unit: 1 },
            { item_id: saquinho, qty_per_unit: 1 },
          ],
        },
      }),
    );
    const lines = await env.admin().query<{ line_kind: string; consumed_at: string }>(
      `select line_kind, consumed_at from public.bom_lines where bom_version_id = $1 order by sort_order`,
      [bom],
    );
    expect(lines).toEqual([
      { line_kind: 'FILAMENT_MODEL', consumed_at: 'PRODUCTION' },
      { line_kind: 'COMPONENT', consumed_at: 'ASSEMBLY' },
      { line_kind: 'PACKAGING', consumed_at: 'DELIVERY' },
    ]);
    await env.as(dono, (s) => s.rpc('activate_bom', { p_bom_id: bom }));
    const estimate = await env.as(dono, (s) => s.rpc<Record<string, number | string | boolean>>('estimate_bom_cost', { p_bom_id: bom, p_on: '2026-10-21' }));
    // 8 g × 1,125 × 0,10 = 0,90 + argola 0,30 = 1,20 de material; 15 min × R$ 1,20/h = 0,30 operacional.
    expect(n(estimate.material)).toBe(1.2);
    expect(n(estimate.operational)).toBe(0.3);
    expect(n(estimate.packaging)).toBe(0.25);
    expect(n(estimate.total_production)).toBe(1.5);
    expect(n(estimate.machine_minutes)).toBe(15);
    expect(estimate.rate_mode).toBe('COMBINED');
  });

  it('editar a ficha ativa cria rascunho versão +1; ativar arquiva a anterior (US-4.3)', async () => {
    const active = await env.admin().one<{ id: number }>(`select id from public.bom_versions where variant_id = $1 and status = 'ATIVA'`, [amarelo]);
    await expect(env.as(dono, (s) => s.rpc('save_bom_draft', { p_bom: { id: active.id, units_per_plate: 8 } }))).rejects.toThrow(/rascunho/);
    const draft = await env.as(dono, (s) => s.rpc<number>('copy_bom', { p_bom_id: active.id }));
    await env.as(dono, (s) => s.rpc('save_bom_draft', { p_bom: { id: draft, units_per_plate: 8 } }));
    const before = await env.admin().query<{ version: number; status: string }>(`select version, status from public.bom_versions where variant_id = $1 order by version`, [amarelo]);
    expect(before).toEqual([{ version: 1, status: 'ATIVA' }, { version: 2, status: 'RASCUNHO' }]);
    await env.as(dono, (s) => s.rpc('activate_bom', { p_bom_id: draft }));
    const after = await env.admin().query<{ version: number; status: string }>(`select version, status from public.bom_versions where variant_id = $1 order by version`, [amarelo]);
    expect(after).toEqual([{ version: 1, status: 'ARQUIVADA' }, { version: 2, status: 'ATIVA' }]);
  });

  it('prévia do custo sem salvar (US-4.4)', async () => {
    const preview = await env.as(dono, (s) =>
      s.rpc<Record<string, number>>('preview_bom_cost', {
        p_bom: { units_per_plate: 1, est_print_minutes_per_plate: 60, lines: [{ item_id: pla, line_kind: 'FILAMENT_MODEL', qty_per_unit: 10 }] },
      }),
    );
    expect(n(preview.material)).toBe(1);
    expect(n(preview.operational)).toBe(1.2);
  });

  it('preço sugerido (RN-17) e margem por canal (US-4.5)', async () => {
    await env.as(dono, (s) => s.query(`update public.settings set margin_target_pct = 0.30`).catch(() => undefined));
    await env.admin().query(`update public.settings set margin_target_pct = 0.30`);
    const pricing = await env.as(dono, (s) =>
      s.rpc<{ channels: Array<{ channel_name: string; price: number; suggested_price: number; contribution_margin: number }> }>('variant_pricing', {
        p_variant_id: amarelo,
        p_on: '2026-10-21',
      }),
    );
    const direct = pricing.channels.find((c) => c.channel_name === 'Venda direta')!;
    // Ficha v2: 8 un/mesa → 11,25 min/un → R$ 0,225 operacional; material 1,20; embalagem 0,25.
    // p = (1,425 + 0,25) / (1 − 0,30) = 2,39
    expect(n(direct.suggested_price)).toBe(2.39);
    expect(n(direct.price)).toBe(5);
    expect(n(direct.contribution_margin)).toBe(3.33);
  });

  it('margem alvo impossível com as taxas → sem preço sugerido', async () => {
    const channel = await env.as(dono, (s) =>
      s.rpc<number>('save_sales_channel', { p_channel: { name: 'Canal caro', kind: 'MARKETPLACE', fee_pct: 0.6, payment_fee_pct: 0.1 } }),
    );
    const pricing = await env.as(dono, (s) => s.rpc<{ channels: Array<{ channel_id: number; suggested_price: number | null }> }>('variant_pricing', { p_variant_id: amarelo }));
    expect(pricing.channels.find((c) => c.channel_id === channel)!.suggested_price).toBeNull();
  });

  it('novo preço de canal cria vigência e encerra a anterior', async () => {
    const direct = await env.admin().one<{ id: number }>(`select id from public.sales_channels where name = 'Venda direta'`);
    await env.as(dono, (s) => s.rpc('set_channel_price', { p_variant_id: amarelo, p_channel_id: direct.id, p_price: 6, p_valid_from: '2026-10-01' }));
    await env.as(dono, (s) => s.rpc('set_channel_price', { p_variant_id: amarelo, p_channel_id: direct.id, p_price: 7, p_valid_from: '2026-11-01' }));
    const prices = await env.admin().query<{ price: string; valid_to: string | null }>(
      `select price, valid_to::text from public.channel_prices where variant_id = $1 order by valid_from`,
      [amarelo],
    );
    expect(prices.map((p) => [n(p.price), p.valid_to])).toEqual([
      [6, '2026-10-31'],
      [7, null],
    ]);
  });

  it('leitura consulta custos mas não altera', async () => {
    const pricing = await env.as(leitura, (s) => s.rpc<{ channels: unknown[] }>('variant_pricing', { p_variant_id: amarelo }));
    expect(pricing.channels.length).toBeGreaterThan(0);
    await expect(env.as(leitura, (s) => s.rpc('save_product', { p_product: { name: 'X' } }))).rejects.toThrow(/permissão/);
  });
});
