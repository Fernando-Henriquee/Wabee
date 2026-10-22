import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestEnv } from './env';

/** Toda view v_* precisa abrir para os três perfis (funções usadas nelas exigem EXECUTE de quem consulta). */

let env: TestEnv;
const users: Record<string, string> = {};

beforeAll(async () => {
  env = await TestEnv.create();
  for (const role of ['dono', 'producao', 'leitura'] as const) users[role] = await env.createMember(`${role}@wabee.test`, role);
  await env.as(users.dono!, async (s) => {
    const filament = await s.rpc<number>('save_item', { p_item: { kind: 'FILAMENT', name: 'PLA amarelo', filament: { material: 'PLA', brand: 'X', color_name: 'amarelo', color_hex: '#f5b800' } } });
    const product = await s.rpc<number>('save_product', { p_product: { name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'amarelo', reference_price: 5 }] } });
    const variant = await s.one<{ id: number }>(`select id from public.product_variants where product_id = $1`, [product]);
    const bom = await s.rpc<number>('save_bom_draft', {
      p_bom: { variant_id: variant.id, units_per_plate: 10, est_print_minutes_per_plate: 140, lines: [{ item_id: filament, qty_per_unit: 8 }] },
    });
    await s.rpc('activate_bom', { p_bom_id: bom });
  });
});

afterAll(async () => {
  await env.close();
});

describe('views de leitura', () => {
  it('todas as views v_* abrem para dono, produção e leitura', async () => {
    const views = await env.admin().query<{ viewname: string }>(`select viewname from pg_views where schemaname = 'public' and viewname like 'v\\_%' order by 1`);
    expect(views.length).toBeGreaterThan(20);
    const failures: string[] = [];
    for (const [role, id] of Object.entries(users)) {
      for (const { viewname } of views) {
        try {
          await env.as(id, (s) => s.query(`select * from public.${viewname} limit 5`));
        } catch (error) {
          failures.push(`${role} → ${viewname}: ${(error as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('ficha ativa mostra gramas por unidade', async () => {
    const row = await env.as(users.producao!, (s) => s.one<{ grams_per_unit: string }>(`select grams_per_unit from public.v_bom_versions`));
    expect(Number(row.grams_per_unit)).toBe(8);
  });
});
