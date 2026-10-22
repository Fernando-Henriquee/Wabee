import type { OnboardingSnapshot } from '@/data/settings';
import type { OnboardingState } from '@/features/member/member-context';

/** Passos do assistente inicial (US-0.11). A ordem é a sugerida para colocar a Wabee no ar. */
export const STEPS = [
  { key: 'empresa', title: 'Empresa', short: 'Nome, início do uso e impostos' },
  { key: 'contas', title: 'Contas', short: 'Pix da empresa e cartão do dono' },
  { key: 'impressora', title: 'Impressora e taxa', short: 'Custo por hora de impressão' },
  { key: 'itens', title: 'Filamentos e itens', short: 'O que você usa para produzir' },
  { key: 'produtos', title: 'Produtos e fichas', short: 'O que você vende e como é feito' },
  { key: 'compras', title: 'Compras anteriores', short: 'O que já foi comprado no cartão' },
  { key: 'estoque', title: 'Saldo inicial', short: 'O que já existe no estoque' },
  { key: 'concluir', title: 'Concluir', short: 'Revisar e começar a usar' },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];
export type StepStatus = 'done' | 'skipped' | 'pending';

const KEYS = STEPS.map((s) => s.key) as StepKey[];

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === 'string' && (KEYS as string[]).includes(value);
}

export function stepIndex(key: StepKey): number {
  return KEYS.indexOf(key);
}

export function nextStep(key: StepKey): StepKey | null {
  return KEYS[stepIndex(key) + 1] ?? null;
}

export function previousStep(key: StepKey): StepKey | null {
  const index = stepIndex(key);
  return index > 0 ? KEYS[index - 1]! : null;
}

/** Taxas por hora de máquina que contam como "taxa cadastrada" (combinada ou já dividida). */
const MACHINE_RATES = ['OPERATIONAL_PER_HOUR', 'ENERGY_PER_HOUR', 'DEPRECIATION_PER_HOUR'];

export function hasCurrentMachineRate(snapshot: Pick<OnboardingSnapshot, 'rates'>): boolean {
  return snapshot.rates.some((r) => MACHINE_RATES.includes(r.rate_type) && r.valid_to === null);
}

/** O passo já está feito pelos dados (independe de a pessoa ter clicado em "continuar"). */
export function detectDone(key: StepKey, snapshot: OnboardingSnapshot, goLiveDate: string | null, state: OnboardingState): boolean {
  switch (key) {
    case 'empresa':
      return goLiveDate !== null;
    case 'contas':
      return snapshot.accounts.some((a) => a.owner === 'EMPRESA');
    case 'impressora':
      // Sem impressora ainda, vale a escolha "ela entra pela compra anterior" (passo marcado como concluído).
      return hasCurrentMachineRate(snapshot) && (snapshot.printers.length > 0 || (state.completed ?? []).includes('impressora'));
    case 'itens':
      return (snapshot.itemCounts.FILAMENT ?? 0) > 0;
    case 'produtos':
      return snapshot.products > 0;
    case 'compras':
      return snapshot.openingPurchases.length > 0;
    case 'estoque':
      return snapshot.openingMovements > 0;
    case 'concluir':
      return state.done === true;
  }
}

export function stepStatus(key: StepKey, snapshot: OnboardingSnapshot, goLiveDate: string | null, state: OnboardingState): StepStatus {
  if (detectDone(key, snapshot, goLiveDate, state)) return 'done';
  if (key !== 'impressora' && key !== 'concluir' && (state.completed ?? []).includes(key)) return 'done';
  if ((state.skipped ?? []).includes(key)) return 'skipped';
  return 'pending';
}

/** Passo para abrir: o salvo, ou o primeiro ainda pendente. */
export function initialStep(statuses: Record<StepKey, StepStatus>, state: OnboardingState): StepKey {
  if (isStepKey(state.step)) return state.step;
  return KEYS.find((key) => statuses[key] === 'pending') ?? 'concluir';
}

/** Novo estado depois de concluir, pular ou abrir um passo. */
export function updateState(state: OnboardingState, change: { step: StepKey; complete?: StepKey; skip?: StepKey; done?: boolean }): OnboardingState {
  const completed = new Set(state.completed ?? []);
  const skipped = new Set(state.skipped ?? []);
  if (change.complete) {
    completed.add(change.complete);
    skipped.delete(change.complete);
  }
  if (change.skip) {
    skipped.add(change.skip);
    completed.delete(change.skip);
  }
  return {
    step: change.step,
    completed: KEYS.filter((k) => completed.has(k)),
    skipped: KEYS.filter((k) => skipped.has(k)),
    done: change.done ?? state.done ?? false,
  };
}
