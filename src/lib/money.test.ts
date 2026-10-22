import { describe, expect, it } from 'vitest';
import { formatBRL, formatCost, formatMinutes, formatPercent, formatQty, parseDecimal, toCents } from './money';

describe('dinheiro e quantidades (US-0.8)', () => {
  it('interpreta "1.234,56" e "1234.56"', () => {
    expect(parseDecimal('1.234,56')).toBe('1234.56');
    expect(parseDecimal('1234.56')).toBe('1234.56');
    expect(parseDecimal('R$ 12,5')).toBe('12.5');
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('')).toBeNull();
  });

  it('formata em pt-BR', () => {
    expect(formatBRL(1234.56).replace(/\u00a0/g, ' ')).toBe('R$ 1.234,56');
    expect(formatQty(1234.5, 'G')).toBe('1.234,5 g');
    expect(formatQty(3, 'UN')).toBe('3 un');
    expect(formatCost('1.388889').replace(/\u00a0/g, ' ')).toBe('R$ 1,388889');
    expect(formatPercent(0.668)).toBe('66,8%');
    expect(formatMinutes(90)).toBe('1h30');
    expect(formatMinutes(45)).toBe('45 min');
  });

  it('centavos com meio para cima', () => {
    expect(toCents('10.005')).toBe(1001);
    expect(toCents('313.68')).toBe(31368);
  });
});
