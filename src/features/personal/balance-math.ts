import type { PfAccountKind } from '@/data/personal';

/** O que a pessoa digita para uma conta: no cartão é quanto ela DEVE (positivo); nas demais, o saldo. */
export function balanceToInput(kind: PfAccountKind, balance: number): number {
  const value = kind === 'CARTAO' ? -balance : balance;
  return Math.round(value * 100) / 100 || 0;
}

/** Saldo a gravar (`target` do ajuste) a partir do que foi digitado. */
export function inputToTarget(kind: PfAccountKind, typed: number): number {
  const value = kind === 'CARTAO' ? -typed : typed;
  return Math.round(value * 100) / 100 || 0;
}

/** Limite que ainda resta no cartão: limite menos o que se deve (crédito a favor não aumenta o limite). */
export function remainingLimit(limit: number, balance: number): number {
  return limit - Math.max(-balance, 0);
}
