import { describe, expect, it } from 'vitest';
import type { BomLineRow, CostRateRow } from '@/data/production';
import { bomFilamentGrams, bomMinutes, describeProgress, elapsedMinutes, formatWhen, gramsUntilFailure, latestRate, splitByWeight, splitMinutes } from './helpers';

function line(partial: Partial<BomLineRow>): BomLineRow {
  return {
    id: 1,
    bom_version_id: 1,
    item_id: 10,
    sku: 'X',
    item_name: 'PLA',
    item_kind: 'FILAMENT',
    unit: 'G',
    color_hex: null,
    line_kind: 'FILAMENT_MODEL',
    qty_per_unit: 8,
    waste_pct: 0.05,
    consumed_at: 'PRODUCTION',
    sort_order: 0,
    ...partial,
  };
}

describe('produção — prévias', () => {
  it('minutos decorridos desde o início, nunca negativos', () => {
    const start = '2026-10-22T09:00:00-03:00';
    expect(elapsedMinutes(start, new Date('2026-10-22T10:30:00-03:00').getTime())).toBe(90);
    expect(elapsedMinutes(start, new Date('2026-10-22T08:00:00-03:00').getTime())).toBe(0);
    expect(elapsedMinutes(null)).toBeNull();
  });

  it('divide minutos em h + min', () => {
    expect(splitMinutes(90)).toEqual({ h: 1, m: 30 });
    expect(splitMinutes(45)).toEqual({ h: 0, m: 45 });
    expect(splitMinutes(null)).toBeNull();
  });

  it('gramas pela ficha: qty × g/un × (1 + desperdício), só filamento da produção', () => {
    const lines = [
      line({ item_id: 2, qty_per_unit: 8, waste_pct: 0.05 }),
      line({ id: 2, item_id: 3, line_kind: 'COMPONENT', consumed_at: 'ASSEMBLY', qty_per_unit: 1, waste_pct: 0 }),
      line({ id: 3, bom_version_id: 2, item_id: 1, qty_per_unit: 6, waste_pct: 0.05 }),
    ];
    // Exemplo da seção 11.3: 6 Abelhas (8 g) + 4 Corações (6 g), 5% de desperdício.
    expect(bomFilamentGrams(lines, [{ bomId: 1, qty: 6 }, { bomId: 2, qty: 4 }, { bomId: null, qty: 3 }])).toEqual([
      { item_id: 2, grams: '50.4' },
      { item_id: 1, grams: '25.2' },
    ]);
  });

  it('minutos pela ficha: qty ÷ por mesa × minutos por mesa', () => {
    const abelha = { active_bom_id: 1, units_per_plate: 10, est_print_minutes_per_plate: 140 };
    const coracao = { active_bom_id: 2, units_per_plate: 12, est_print_minutes_per_plate: 120 };
    const semFicha = { active_bom_id: null, units_per_plate: null, est_print_minutes_per_plate: null };
    expect(bomMinutes([abelha, coracao, semFicha], [6, 4, 5])).toBe(124);
  });

  it('rateio de gramas por peso: soma exata, restante na última', () => {
    expect(splitByWeight('80', [50.4, 25.2])).toEqual(['53.3', '26.7']);
    expect(splitByWeight('10', [0, 0, 0])).toEqual(['3.3', '3.3', '3.4']);
    expect(splitByWeight('7', [])).toEqual([]);
  });

  it('gramas até a falha proporcionais ao tempo (máx. o previsto)', () => {
    expect(gramsUntilFailure(100, 30, 120)).toBe('25');
    expect(gramsUntilFailure(100, 300, 120)).toBe('100');
    expect(gramsUntilFailure(100, 0, 120)).toBe('0');
  });

  it('descreve o andamento', () => {
    expect(describeProgress(70, 120)).toBe('1h10 de 2h · faltam ~50 min');
    expect(describeProgress(130, 120)).toBe('2h10 · 10 min além do previsto');
  });

  it('data relativa no fuso da empresa', () => {
    expect(formatWhen('2026-10-22T14:35:00-03:00', '2026-10-22')).toBe('hoje 14:35');
    expect(formatWhen('2026-10-21T09:05:00-03:00', '2026-10-22')).toBe('ontem 09:05');
    expect(formatWhen('2026-10-19T10:30:00-03:00', '2026-10-22')).toBe('19/10 10:30');
  });

  it('vigência atual de um tipo e escopo', () => {
    const base: CostRateRow = {
      id: 1,
      rate_type: 'OPERATIONAL_PER_HOUR',
      equipment_id: null,
      equipment_name: null,
      value: 1.2,
      valid_from: '2026-08-23',
      valid_to: null,
      source: 'MANUAL',
      calc_params: {},
      notes: null,
      created_at: '',
      is_current: true,
      used_by_jobs: 1,
    };
    const rates = [base, { ...base, id: 2, valid_from: '2026-01-01', valid_to: '2026-08-22' }, { ...base, id: 3, equipment_id: 5 }];
    expect(latestRate(rates, 'OPERATIONAL_PER_HOUR', null)?.id).toBe(1);
    expect(latestRate(rates, 'OPERATIONAL_PER_HOUR', 5)?.id).toBe(3);
    expect(latestRate(rates, 'ENERGY_PER_HOUR', null)).toBeUndefined();
  });
});
