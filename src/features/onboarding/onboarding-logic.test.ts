import { describe, expect, it } from 'vitest';
import type { OnboardingSnapshot } from '@/data/settings';
import {
  computeStatuses,
  detectDone,
  initialView,
  nextView,
  ONBOARDING_STEPS,
  pendingKeys,
  pendingStepsFromState,
  previousView,
  samePending,
  stepStatus,
  updateState,
} from './onboarding-logic';

const empty: OnboardingSnapshot = {
  accounts: [],
  printers: [],
  rates: [],
  itemCounts: {},
  itemsWithStock: {},
  products: 0,
  variants: 0,
  variantsWithBom: 0,
  openingPurchases: [],
  openingMovements: 0,
};

const rate = { id: 1, rate_type: 'OPERATIONAL_PER_HOUR', equipment_id: null, value: 1.2, valid_from: '2026-10-01', valid_to: null };
const printer = { id: 1, name: 'Impressora 1', kind: 'PRINTER', status: 'ATIVO', purchase_line_id: null };

describe('ordem da US-0.11', () => {
  it('segue empresa → contas → impressora → taxa → filamentos → componentes → compras → canais', () => {
    expect(ONBOARDING_STEPS.map((s) => s.key)).toEqual(['empresa', 'contas', 'impressora', 'taxa', 'filamentos', 'componentes', 'compras', 'canais']);
  });
});

describe('detectDone', () => {
  it('reconhece passos feitos pelos dados', () => {
    expect(detectDone('empresa', empty, null)).toBe(false);
    expect(detectDone('empresa', empty, '2026-10-01')).toBe(true);
    expect(detectDone('contas', { ...empty, accounts: [{ id: 1, name: 'Cartão', kind: 'CARTAO_CREDITO', owner: 'DONO', card_closing_day: 5, card_due_day: 15, active: true }] }, null)).toBe(false);
    expect(detectDone('contas', { ...empty, accounts: [{ id: 2, name: 'Pix', kind: 'BANCO', owner: 'EMPRESA', card_closing_day: null, card_due_day: null, active: true }] }, null)).toBe(true);
    expect(detectDone('impressora', { ...empty, printers: [printer] }, null)).toBe(true);
    expect(detectDone('taxa', { ...empty, rates: [rate] }, null)).toBe(true);
    expect(detectDone('taxa', { ...empty, rates: [{ ...rate, valid_to: '2026-10-10' }] }, null)).toBe(false);
    expect(detectDone('filamentos', { ...empty, itemCounts: { COMPONENT: 3 } }, null)).toBe(false);
    expect(detectDone('filamentos', { ...empty, itemCounts: { FILAMENT: 1 } }, null)).toBe(true);
    expect(detectDone('componentes', { ...empty, itemCounts: { PACKAGING: 1 } }, null)).toBe(true);
    expect(detectDone('canais', empty, null)).toBe(false);
  });
});

describe('stepStatus', () => {
  it('pular deixa pendente; concluir pela pessoa vale (impressora pela compra, canais revisados)', () => {
    expect(stepStatus('compras', empty, null, { skipped: ['compras'] })).toBe('pending');
    expect(stepStatus('impressora', empty, null, { completed: ['impressora'] })).toBe('done');
    expect(stepStatus('canais', empty, null, { completed: ['canais'] })).toBe('done');
  });
});

describe('navegação e estado', () => {
  it('anda entre os passos e termina no resumo', () => {
    expect(nextView('empresa')).toBe('contas');
    expect(nextView('canais')).toBe('resumo');
    expect(previousView('empresa')).toBeNull();
    expect(previousView('resumo')).toBe('canais');
  });

  it('abre no passo pedido, no salvo ou no primeiro pendente', () => {
    const statuses = computeStatuses({ ...empty, accounts: [{ id: 2, name: 'Pix', kind: 'BANCO', owner: 'EMPRESA', card_closing_day: null, card_due_day: null, active: true }] }, '2026-10-01', {});
    expect(initialView(statuses, {})).toBe('impressora');
    expect(initialView(statuses, { step: 'compras' })).toBe('compras');
    expect(initialView(statuses, { step: 'compras' }, 'taxa')).toBe('taxa');
    expect(initialView(statuses, { step: 'inexistente' }, 'xyz')).toBe('impressora');
  });

  it('pular inclui nos pendentes; concluir tira', () => {
    const skipped = updateState({}, { step: 'contas', pending: ['contas'], skip: 'empresa' });
    expect(skipped).toEqual({ step: 'contas', completed: [], skipped: ['empresa'], pending: ['empresa', 'contas'], done: false });
    const completed = updateState(skipped, { step: 'impressora', pending: ['empresa', 'contas'], complete: 'empresa' });
    expect(completed).toEqual({ step: 'impressora', completed: ['empresa'], skipped: [], pending: ['contas'], done: false });
    expect(updateState(completed, { step: 'resumo', pending: [], done: true }).done).toBe(true);
    // Pulado e depois feito fora do assistente: sai de "skipped" na próxima sincronização.
    expect(updateState(skipped, { step: 'contas', pending: ['contas'] }).skipped).toEqual([]);
    // Ao concluir, o que ficou pendente conta como pulado (alerta da Visão geral).
    expect(updateState({}, { step: 'resumo', pending: ['taxa', 'compras'], done: true, skipPending: true })).toEqual({
      step: 'resumo',
      completed: [],
      skipped: ['taxa', 'compras'],
      pending: ['taxa', 'compras'],
      done: true,
    });
  });

  it('lista os pendentes para a Visão geral', () => {
    expect(pendingStepsFromState(undefined)).toHaveLength(8);
    expect(pendingStepsFromState({ done: true })).toHaveLength(0);
    expect(pendingStepsFromState({ pending: ['taxa', 'canais'] }).map((s) => s.title)).toEqual(['Taxa operacional', 'Canais de venda']);
    expect(pendingKeys(computeStatuses(empty, null, { completed: ['canais'] }))).not.toContain('canais');
    expect(samePending(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(samePending(undefined, [])).toBe(false);
  });
});
