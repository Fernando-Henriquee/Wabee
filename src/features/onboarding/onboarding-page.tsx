import { CircleCheck, ListChecks, Lock } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type OnboardingSnapshot, useOnboardingSnapshot, useSaveOnboardingState } from '@/data/settings';
import { useMember } from '@/features/member/member-context';
import { BackLink } from '@/features/settings/bits';
import { cn } from '@/lib/cn';
import {
  computeStatuses,
  initialView,
  nextView,
  ONBOARDING_STEPS,
  pendingKeys,
  previousView,
  samePending,
  type StepKey,
  type StepStatus,
  stepIndex,
  updateState,
  type WizardState,
  type WizardView,
} from './onboarding-logic';
import type { StepNav } from './step-ui';
import { StepChannels, StepComponents, StepFilaments, StepPurchases, StepSummary } from './steps-guides';
import { StepAccounts, StepCompany, StepPrinter, StepRate } from './steps-setup';

/** Assistente de configuração inicial (US-0.11): passos com progresso salvo em settings.onboarding_state. */
export function OnboardingPage() {
  const { can } = useMember();
  const allowed = can('settings');
  const snapshot = useOnboardingSnapshot(allowed);
  if (!allowed) {
    return (
      <Page>
        <PageHeader back={<BackLink />} title="Configuração inicial" />
        <EmptyState icon={<Lock />} title="Sem permissão" description="Só o perfil Dono faz a configuração inicial." />
      </Page>
    );
  }
  if (snapshot.isError) return <Page><ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} /></Page>;
  if (!snapshot.data) return <Page><LoadingBlock /></Page>;
  return <Wizard snapshot={snapshot.data} />;
}

const STATUS_LABELS: Record<StepStatus, string> = { done: 'feito', pending: 'pendente' };
const TOTAL = ONBOARDING_STEPS.length;

function StatusIcon({ status, label, active }: { status: StepStatus; label: ReactNode; active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ring-1 ring-inset',
        status === 'done' ? 'bg-success-soft text-success ring-success/30' : 'bg-panel text-muted ring-line-strong',
        active && 'bg-ink text-brand-fg ring-ink',
      )}
    >
      {status === 'done' && !active ? <CircleCheck className="size-4" /> : label}
    </span>
  );
}

function Wizard({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const { settings } = useMember();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<WizardState>(() => settings.onboarding_state ?? {});
  const statuses = useMemo(() => computeStatuses(snapshot, settings.go_live_date, state), [snapshot, settings.go_live_date, state]);
  const [view, setView] = useState<WizardView>(() => initialView(statuses, state, params.get('passo')));
  const save = useSaveOnboardingState();
  const alreadyDone = settings.onboarding_state?.done === true;
  const pending = pendingKeys(statuses);

  // Mantém a lista de pendentes da Visão geral em dia com os dados (cadastros feitos fora do assistente).
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || samePending(state.pending, pending)) return;
    synced.current = true;
    save.mutate(updateState(state, { step: (state.step as WizardView | undefined) ?? view, pending }));
  }, [state, pending, view, save]);

  // ?passo= vale só para abrir; depois a navegação é interna.
  useEffect(() => {
    if (!params.has('passo')) return;
    const next = new URLSearchParams(params);
    next.delete('passo');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const open = (next: WizardView) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Conclui ou pula o passo atual: salva o progresso e abre o próximo. */
  const advance = (change: { complete?: StepKey; skip?: StepKey }) => {
    const next = nextView(view);
    const updated = updateState(state, { step: next, pending, ...change });
    setState(updated);
    open(next);
    save.mutate(updated);
  };

  const finish = () => {
    const updated = updateState(state, { step: 'resumo', pending, done: true, skipPending: true });
    save.mutate(updated, {
      onSuccess: () => {
        setState(updated);
        toast.success(pending.length ? 'Configuração concluída. Os passos pendentes ficam na Visão geral.' : 'Configuração concluída. Bom trabalho!');
        navigate('/');
      },
    });
  };

  const prev = previousView(view);
  const nav: StepNav = {
    status: view === 'resumo' ? 'done' : statuses[view],
    complete: () => (view === 'resumo' ? finish() : advance({ complete: view })),
    skip: () => (view === 'resumo' ? undefined : advance({ skip: view })),
    back: prev ? () => open(prev) : null,
    busy: save.isPending,
  };

  const index = view === 'resumo' ? TOTAL : stepIndex(view);
  const doneCount = TOTAL - pending.length;

  let body: ReactNode;
  switch (view) {
    case 'empresa':
      body = <StepCompany nav={nav} />;
      break;
    case 'contas':
      body = <StepAccounts nav={nav} snapshot={snapshot} />;
      break;
    case 'impressora':
      body = <StepPrinter nav={nav} snapshot={snapshot} />;
      break;
    case 'taxa':
      body = <StepRate nav={nav} snapshot={snapshot} />;
      break;
    case 'filamentos':
      body = <StepFilaments nav={nav} snapshot={snapshot} />;
      break;
    case 'componentes':
      body = <StepComponents nav={nav} snapshot={snapshot} />;
      break;
    case 'compras':
      body = <StepPurchases nav={nav} snapshot={snapshot} />;
      break;
    case 'canais':
      body = <StepChannels nav={nav} />;
      break;
    case 'resumo':
      body = <StepSummary nav={nav} statuses={statuses} onOpen={open} alreadyDone={alreadyDone} />;
      break;
  }

  const sideItems: Array<{ key: WizardView; title: string; status: StepStatus; label: ReactNode; caption: string }> = [
    ...ONBOARDING_STEPS.map((s, i) => ({ key: s.key, title: s.title, status: statuses[s.key], label: i + 1, caption: STATUS_LABELS[statuses[s.key]] })),
    { key: 'resumo', title: 'Resumo', status: alreadyDone ? 'done' : 'pending', label: <ListChecks className="size-4" />, caption: alreadyDone ? 'concluído' : 'concluir' },
  ];

  const title = view === 'resumo' ? 'Resumo' : `${index + 1}. ${ONBOARDING_STEPS[index]!.title}`;
  const description = view === 'resumo' ? 'Revise e conclua' : ONBOARDING_STEPS[index]!.short;

  return (
    <Page className="max-w-5xl">
      <PageHeader
        back={<BackLink />}
        title="Configuração inicial"
        description="Um passo a passo para colocar a Wabee no ar. O progresso fica salvo; passos pulados ficam pendentes na Visão geral."
      />

      {/* Celular: progresso e atalhos para os passos. */}
      <div className="mb-4 lg:hidden">
        <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-ink">{view === 'resumo' ? 'Resumo' : `Passo ${index + 1} de ${TOTAL}`}</span>
          <span className="text-xs text-muted">
            {doneCount} de {TOTAL} feitos
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL} aria-valuenow={doneCount} aria-label="Passos feitos">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / TOTAL) * 100}%` }} />
        </div>
        <ol className="-mx-1 mt-2 flex gap-0.5 overflow-x-auto px-1 pb-1" aria-label="Passos">
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => open(s.key)}
                aria-current={s.key === view ? 'step' : undefined}
                aria-label={`${i + 1}. ${s.title} (${STATUS_LABELS[statuses[s.key]]})`}
                className="grid size-10 place-items-center rounded-full"
              >
                <StatusIcon status={statuses[s.key]} label={i + 1} active={s.key === view} />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => open('resumo')} aria-current={view === 'resumo' ? 'step' : undefined} aria-label="Resumo" className="grid size-10 place-items-center rounded-full">
              <StatusIcon status={alreadyDone ? 'done' : 'pending'} label={<ListChecks className="size-4" />} active={view === 'resumo'} />
            </button>
          </li>
        </ol>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Passos da configuração" className="hidden lg:block">
          <div className="sticky top-6 space-y-3">
            <div>
              <div className="mb-1.5 flex justify-between text-xs text-muted">
                <span>Progresso</span>
                <span>
                  {doneCount} de {TOTAL}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / TOTAL) * 100}%` }} />
              </div>
            </div>
            <ol className="space-y-0.5">
              {sideItems.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => open(item.key)}
                    aria-current={item.key === view ? 'step' : undefined}
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-subtle', item.key === view && 'bg-panel shadow-[var(--shadow-card)] ring-1 ring-line')}
                  >
                    <StatusIcon status={item.status} label={item.label} active={item.key === view} />
                    <span className="min-w-0">
                      <span className={cn('block truncate text-sm', item.key === view ? 'font-semibold text-ink' : 'text-ink-soft')}>{item.title}</span>
                      <span className="block truncate text-xs text-muted">{item.caption}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <Card className="min-w-0">
          <CardHeader
            title={title}
            description={description}
            actions={view !== 'resumo' ? <Badge tone={statuses[view] === 'done' ? 'success' : 'warning'}>{STATUS_LABELS[statuses[view]]}</Badge> : null}
          />
          <div key={view}>{body}</div>
        </Card>
      </div>
    </Page>
  );
}
