import { describe, expect, it } from 'vitest';
import { auditObjectHref, auditSummary, describeChanges, formatAuditValue } from './audit-format';

describe('describeChanges', () => {
  it('reconhece antes/depois de uma alteração de cadastro', () => {
    const shape = describeChanges({ name: { antes: 'A', depois: 'B' }, updated_at: { antes: 'x', depois: 'y' }, active: { antes: true, depois: false } });
    expect(shape).toEqual({
      kind: 'diff',
      rows: [
        { field: 'name', before: 'A', after: 'B' },
        { field: 'active', before: true, after: false },
      ],
    });
  });

  it('reconhece o registro criado e esconde campos vazios', () => {
    const shape = describeChanges({ depois: { id: 3, name: 'Shopee', notes: null, updated_at: '2026-10-22T10:00:00Z' } });
    expect(shape).toEqual({ kind: 'snapshot', rows: [{ field: 'id', value: 3 }, { field: 'name', value: 'Shopee' }] });
  });

  it('cai para JSON quando o formato é livre', () => {
    expect(describeChanges({ valor: 10, estornos: [1, 2] })).toEqual({ kind: 'json', value: { valor: 10, estornos: [1, 2] } });
    expect(describeChanges([1, 2])).toEqual({ kind: 'json', value: [1, 2] });
  });

  it('trata vazio', () => {
    expect(describeChanges({})).toEqual({ kind: 'empty' });
    expect(describeChanges(null)).toEqual({ kind: 'empty' });
  });
});

describe('formatAuditValue', () => {
  it('formata valores em pt-BR', () => {
    expect(formatAuditValue(null)).toBe('—');
    expect(formatAuditValue(true)).toBe('Sim');
    expect(formatAuditValue(0.125, 'fee_pct')).toBe('12,5%');
    expect(formatAuditValue(1234.5)).toBe('1.234,5');
    expect(formatAuditValue('2026-10-22')).toBe('22/10/2026');
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('auditSummary', () => {
  it('usa o resumo da operação quando existe', () => {
    expect(auditSummary({ summary: 'Compra confirmada', action: 'UPDATE', model_label: 'purchase', object_ref: 'CMP-1', changes: {} })).toBe('Compra confirmada');
  });

  it('gera um resumo a partir dos campos alterados', () => {
    expect(
      auditSummary({ summary: null, action: 'UPDATE', model_label: 'sales_channel', object_ref: 'Shopee', changes: { payout_days: { antes: 14, depois: 30 } } }),
    ).toBe('Alterou dias para receber em “Shopee”');
    expect(auditSummary({ summary: null, action: 'CREATE', model_label: 'item', object_ref: 'FIL-PLA-001', changes: { depois: {} } })).toBe(
      'Novo cadastro: Item de estoque “FIL-PLA-001”',
    );
  });
});

describe('auditObjectHref', () => {
  it('aponta para a tela do objeto', () => {
    expect(auditObjectHref({ model_label: 'item', object_id: 7 })).toBe('/estoque/itens/7');
    expect(auditObjectHref({ model_label: 'settings', object_id: null })).toBe('/configuracoes/empresa');
    expect(auditObjectHref({ model_label: 'transfer', object_id: 2 })).toBeNull();
  });
});
