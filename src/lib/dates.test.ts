import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  describePeriod,
  endOfMonth,
  excelSerialToISO,
  formatDateBR,
  formatDateTimeBR,
  isValidISODate,
  nextDayOfMonth,
  parseDateBR,
  periodFor,
  shiftPeriod,
  startOfWeek,
  todayIn,
} from './dates';

describe('fuso horário operacional', () => {
  it('"hoje" depende do fuso do negócio', () => {
    // 19/10/2026 01:30 UTC ainda é 18/10 em São Paulo (UTC−3).
    const instant = new Date('2026-10-19T01:30:00Z');
    expect(todayIn('America/Sao_Paulo', instant)).toBe('2026-10-18');
    expect(todayIn('UTC', instant)).toBe('2026-10-19');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-10-19');
  });

  it('formata data e hora no fuso do negócio', () => {
    expect(formatDateTimeBR('2026-10-19T01:30:00Z', 'America/Sao_Paulo')).toBe('18/10/2026 22:30');
  });
});

describe('formatação e leitura DD/MM/AAAA', () => {
  it('formata', () => {
    expect(formatDateBR('2026-03-05')).toBe('05/03/2026');
    expect(formatDateBR(null)).toBe('—');
  });

  it('lê datas brasileiras e rejeita inválidas', () => {
    expect(parseDateBR('05/03/2026')).toBe('2026-03-05');
    expect(parseDateBR('5/3/26')).toBe('2026-03-05');
    expect(parseDateBR('31/02/2026')).toBeNull();
    expect(parseDateBR('2026-03-05')).toBeNull();
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });

  it('converte serial de data do Excel', () => {
    expect(excelSerialToISO(45000)).toBe('2023-03-15');
    expect(excelSerialToISO(45000.75)).toBe('2023-03-15');
    expect(excelSerialToISO(-1)).toBeNull();
  });
});

describe('aritmética de datas', () => {
  it('soma dias e meses ajustando fim de mês', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
  });

  it('semana começa na segunda-feira', () => {
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19'); // segunda
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19'); // domingo
    expect(startOfWeek('2026-10-21')).toBe('2026-10-19');
  });
});

describe('próximo dia 10 (mesma regra do banco)', () => {
  it.each([
    ['2026-10-05', 10, true, '2026-10-10'],
    ['2026-10-10', 10, true, '2026-10-10'],
    ['2026-10-10', 10, false, '2026-11-10'],
    ['2026-10-11', 10, true, '2026-11-10'],
    ['2026-12-15', 10, true, '2027-01-10'],
    ['2026-01-31', 31, false, '2026-02-28'],
    ['2028-02-15', 31, true, '2028-02-29'],
  ] as const)('%s, dia %i, inclusivo=%s → %s', (from, day, inclusive, expected) => {
    expect(nextDayOfMonth(from, day, inclusive)).toBe(expected);
  });
});

describe('períodos do dashboard', () => {
  it('dia, semana e mês', () => {
    expect(periodFor('day', '2026-10-19')).toEqual({ kind: 'day', from: '2026-10-19', to: '2026-10-19' });
    expect(periodFor('week', '2026-10-22')).toEqual({ kind: 'week', from: '2026-10-19', to: '2026-10-25' });
    expect(periodFor('month', '2026-10-22')).toEqual({ kind: 'month', from: '2026-10-01', to: '2026-10-31' });
  });

  it('navega para o período anterior/seguinte', () => {
    expect(shiftPeriod(periodFor('month', '2026-03-31'), -1)).toEqual({ kind: 'month', from: '2026-02-01', to: '2026-02-28' });
    expect(shiftPeriod(periodFor('week', '2026-10-19'), 1).from).toBe('2026-10-26');
    expect(shiftPeriod({ kind: 'custom', from: '2026-10-01', to: '2026-10-10' }, 1)).toEqual({
      kind: 'custom',
      from: '2026-10-11',
      to: '2026-10-20',
    });
  });

  it('descreve o período', () => {
    expect(describePeriod(periodFor('month', '2026-10-05'))).toBe('Outubro de 2026');
    expect(describePeriod(periodFor('week', '2026-10-19'))).toBe('19/10/2026 a 25/10/2026');
  });
});
