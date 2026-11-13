import { describe, expect, it } from 'vitest';
import { balanceToInput, inputToTarget, remainingLimit } from './balance-math';

describe('balance-math', () => {
  it('no cartão, digita-se o que deve (positivo) e grava-se o saldo negativo', () => {
    expect(balanceToInput('CARTAO', -1250.5)).toBe(1250.5);
    expect(inputToTarget('CARTAO', 1250.5)).toBe(-1250.5);
  });

  it('nas demais contas o valor é o próprio saldo', () => {
    expect(balanceToInput('CONTA', 300)).toBe(300);
    expect(inputToTarget('CARTEIRA', -20)).toBe(-20);
  });

  it('zero não vira -0', () => {
    expect(Object.is(inputToTarget('CARTAO', 0), 0)).toBe(true);
    expect(Object.is(balanceToInput('CARTAO', 0), 0)).toBe(true);
  });

  it('limite restante desconta a dívida e ignora crédito a favor', () => {
    expect(remainingLimit(5000, -1200)).toBe(3800);
    expect(remainingLimit(5000, 80)).toBe(5000);
    expect(remainingLimit(1000, -1500)).toBe(-500);
  });
});
