import { describe, expect, it } from 'vitest';
import type { OnboardingSnapshot } from '@/data/settings';
import { detectDone, initialStep, nextStep, previousStep, STEPS, type StepKey, stepStatus, updateState } from './onboarding-logic';

const empty: OnboardingSnapshot = {
  accounts: [],
  printers: [],
  rates: [],
  itemCounts: {},
  products: 0,
  variants: 0,
  variantsWithBom: 0,
  openingPurchases: [],
  openingMovements: 0,
};

const rate = { id: 1, rate_type: 'OPERATIONAL_PER_HOUR', equipment_id: null, value: 1.2, valid_from: '2026-10-01', valid_to: null };
const printer = { id: 1, name: 'Impressora 1', kind: 'PRINTER', status: 'ATIVO', purchase_line_id: null };

describe('detectDone', () => {
  it('reconhece passos feitos pelos dados', () => {
    expect(detectDone('empresa', empty, null, {})).toBe(false);
    expect(detectDone('empresa', empty, '2026-10-01', {})).toBe(true);
    expect(detectDone('contas', { ...empty, accounts: [{ id: 1, name: 'Cartão', kind: 'CARTAO_CREDITO', owner: 'DONO', card_closing_day: 5, card_due_day: 15, active: true }] }, null, {})).toBe(false);
    expect(detectDone('contas', { ...empty, accounts: [{ id: 2, name: 'Pix', kind: 'BANCO', owner: 'EMPRESA', card_closing_day: null, card_due_day: null, active: true }] }, null, {})).toBe(true);
    expect(detectDone('itens', { ...empty, itemCounts: { COMPONENT: 3 } }, null, {})).toBe(false);
    expect(detectDone('itens', { ...empty, itemCounts: { FILAMENT: 1 } }, null, {})).toBe(true);
  });

  it('impressora exige taxa vigente e impressora (ou a escolha de cadastrá-la pela compra)', () => {
    expect(detectDone('impressora', { ...empty, printers: [printer] }, null, {})).toBe(false);
    expect(detectDone('impressora', { ...empty, rates: [rate] }, null, {})).toBe(false);
    expect(detectDone('impressora', { ...empty, rates: [rate] }, null, { completed: ['impressora'] })).toBe(true);
    expect(detectDone('impressora', { ...empty, rates: [rate], printers: [printer] }, null, {})).toBe(true);
    expect(detectDone('impressora', { ...empty, rates: [{ ...rate, valid_to: '2026-10-10' }], printers: [printer] }, null, {})).toBe(false);
  });
});

describe('stepStatus', () => {
  it('pulado só enquanto não foi feito', () => {
    expect(stepStatus('produtos', empty, null, { skipped: ['produtos'] })).toBe('skipped');
    expect(stepStatus('produtos', { ...empty, products: 2 }, null, { skipped: ['produtos'] })).toBe('done');
    expect(stepStatus('compras', empty, null, { completed: ['compras'] })).toBe('done');
    expect(stepStatus('concluir', empty, null, { completed: ['concluir'] })).toBe('pending');
  });
});

describe('navegação e estado', () => {
  it('anda entre os passos', () => {
    expect(nextStep('empresa')).toBe('contas');
    expect(nextStep('concluir')).toBeNull();
    expect(previousStep('empresa')).toBeNull();
    expect(previousStep('contas')).toBe('empresa');
  });

  it('abre no passo salvo ou no primeiro pendente', () => {
    const statuses = Object.fromEntries(STEPS.map((s) => [s.key, 'done'])) as Record<StepKey, 'done' | 'pending'>;
    statuses.itens = 'pending';
    expect(initialStep(statuses, {})).toBe('itens');
    expect(initialStep(statuses, { step: 'contas' })).toBe('contas');
    expect(initialStep(statuses, { step: 'inexistente' })).toBe('itens');
  });

  it('concluir tira dos pulados e vice-versa', () => {
    const skipped = updateState({}, { step: 'contas', skip: 'empresa' });
    expect(skipped).toEqual({ step: 'contas', completed: [], skipped: ['empresa'], done: false });
    const completed = updateState(skipped, { step: 'impressora', complete: 'empresa' });
    expect(completed).toEqual({ step: 'impressora', completed: ['empresa'], skipped: [], done: false });
    expect(updateState(completed, { step: 'concluir', done: true }).done).toBe(true);
  });
});
