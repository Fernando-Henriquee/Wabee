import type { OnboardingSnapshot } from '@/data/settings';
import type { OnboardingState } from '@/features/member/member-context';

/**
 * Passos do assistente inicial, na ordem da US-0.11. Funções puras (sem React): a
 * Visão geral pode importar ONBOARDING_STEPS e pendingStepsFromState daqui.
 */
export const ONBOARDING_STEPS = [
  { key: 'empresa', title: 'Dados da empresa', short: 'Nome, início do uso e impostos' },
  { key: 'contas', title: 'Contas financeiras', short: 'Pix da empresa e cartão do dono' },
  { key: 'impressora', title: 'Impressora', short: 'A máquina que imprime as peças' },
  { key: 'taxa', title: 'Taxa operacional', short: 'Custo por hora de impressão' },
  { key: 'filamentos', title: 'Filamentos em estoque', short: 'Cadastro e o que você já tem' },
  { key: 'componentes', title: 'Componentes em estoque', short: 'Argolas, ímãs e embalagens' },
  { key: 'compras', title: 'Compras já feitas', short: 'O que foi comprado antes do sistema' },
  { key: 'canais', title: 'Canais de venda', short: 'Onde você vende e as taxas' },
] as const;

export type StepKey = (typeof ONBOARDING_STEPS)[number]['key'];
/** Tela do assistente: um passo ou o resumo final. */
export type WizardView = StepKey | 'resumo';
/** "Pular" deixa o passo pendente (listado na Visão geral). */
export type StepStatus = 'done' | 'pending';

/**
 * Estado salvo em settings.onboarding_state:
 *  - step: tela aberta por último;
 *  - completed: passos concluídos pela pessoa;
 *  - skipped: passos pulados que continuam pendentes (a Visão geral conta esta lista; ao
 *    concluir o assistente, todos os pendentes entram nela);
 *  - pending: passos ainda não feitos (calculado pelos dados; é o que a Visão geral lista);
 *  - done: assistente concluído.
 */
export type WizardState = OnboardingState & { pending?: string[] };

const KEYS = ONBOARDING_STEPS.map((s) => s.key) as StepKey[];

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === 'string' && (KEYS as string[]).includes(value);
}

export function isWizardView(value: unknown): value is WizardView {
  return value === 'resumo' || isStepKey(value);
}

export function stepIndex(key: StepKey): number {
  return KEYS.indexOf(key);
}

/** Próxima tela (depois do último passo vem o resumo). */
export function nextView(view: WizardView): WizardView {
  if (view === 'resumo') return 'resumo';
  return KEYS[stepIndex(view) + 1] ?? 'resumo';
}

export function previousView(view: WizardView): WizardView | null {
  if (view === 'resumo') return KEYS[KEYS.length - 1]!;
  const index = stepIndex(view);
  return index > 0 ? KEYS[index - 1]! : null;
}

/** Taxas por hora de máquina que contam como "taxa cadastrada" (combinada ou já dividida). */
const MACHINE_RATES = ['OPERATIONAL_PER_HOUR', 'ENERGY_PER_HOUR', 'DEPRECIATION_PER_HOUR'];

export function hasCurrentMachineRate(snapshot: Pick<OnboardingSnapshot, 'rates'>): boolean {
  return snapshot.rates.some((r) => MACHINE_RATES.includes(r.rate_type) && r.valid_to === null);
}

/** O passo já está feito pelos dados (independe de a pessoa ter clicado em "continuar"). */
export function detectDone(key: StepKey, snapshot: OnboardingSnapshot, goLiveDate: string | null): boolean {
  const count = (kind: string) => snapshot.itemCounts[kind] ?? 0;
  switch (key) {
    case 'empresa':
      return goLiveDate !== null;
    case 'contas':
      return snapshot.accounts.some((a) => a.owner === 'EMPRESA');
    case 'impressora':
      return snapshot.printers.length > 0;
    case 'taxa':
      return hasCurrentMachineRate(snapshot);
    case 'filamentos':
      return count('FILAMENT') > 0;
    case 'componentes':
      return count('COMPONENT') + count('PACKAGING') > 0;
    case 'compras':
      return snapshot.openingPurchases.length > 0;
    case 'canais':
      // Os canais já vêm cadastrados: o passo é revisar as taxas e confirmar.
      return false;
  }
}

/**
 * Feito pelos dados ou confirmado pela pessoa (ex.: "a impressora entra pela compra
 * anterior", "revisei os canais"). Pulado = pendente.
 */
export function stepStatus(key: StepKey, snapshot: OnboardingSnapshot, goLiveDate: string | null, state: WizardState): StepStatus {
  if (detectDone(key, snapshot, goLiveDate) || (state.completed ?? []).includes(key)) return 'done';
  return 'pending';
}

export function computeStatuses(snapshot: OnboardingSnapshot, goLiveDate: string | null, state: WizardState): Record<StepKey, StepStatus> {
  return Object.fromEntries(KEYS.map((key) => [key, stepStatus(key, snapshot, goLiveDate, state)])) as Record<StepKey, StepStatus>;
}

export function pendingKeys(statuses: Record<StepKey, StepStatus>): StepKey[] {
  return KEYS.filter((key) => statuses[key] !== 'done');
}

/** Tela para abrir: a pedida no endereço (?passo=), a salva, ou o primeiro passo pendente. */
export function initialView(statuses: Record<StepKey, StepStatus>, state: WizardState, requested?: string | null): WizardView {
  if (isWizardView(requested)) return requested;
  if (isWizardView(state.step) && !(state.done && state.step === 'resumo')) return state.step;
  return KEYS.find((key) => statuses[key] === 'pending') ?? 'resumo';
}

/** Novo estado depois de concluir ou pular um passo (ou concluir o assistente). */
export function updateState(
  state: WizardState,
  change: { step: WizardView; pending: StepKey[]; complete?: StepKey; skip?: StepKey; done?: boolean; skipPending?: boolean },
): WizardState {
  const completed = new Set(state.completed ?? []);
  const skipped = new Set(state.skipped ?? []);
  const pending = new Set<string>(change.pending);
  if (change.complete) {
    completed.add(change.complete);
    skipped.delete(change.complete);
    pending.delete(change.complete);
  }
  if (change.skip) {
    skipped.add(change.skip);
    completed.delete(change.skip);
    pending.add(change.skip);
  }
  // "skipped" só guarda o que continua pendente (a Visão geral conta essa lista); ao concluir o
  // assistente, tudo o que ficou pendente passa a contar como pulado.
  if (change.skipPending) for (const key of pending) skipped.add(key);
  return {
    step: change.step,
    completed: KEYS.filter((k) => completed.has(k)),
    skipped: KEYS.filter((k) => skipped.has(k) && pending.has(k)),
    pending: KEYS.filter((k) => pending.has(k)),
    done: change.done ?? state.done ?? false,
  };
}

export function samePending(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * Passos pendentes a partir do estado salvo (para a Visão geral). Antes de o assistente
 * ser aberto pela primeira vez, todos estão pendentes.
 */
export function pendingStepsFromState(state: WizardState | null | undefined): Array<(typeof ONBOARDING_STEPS)[number]> {
  const keys = state?.pending ?? (state?.done ? [] : KEYS);
  return ONBOARDING_STEPS.filter((step) => keys.includes(step.key));
}
