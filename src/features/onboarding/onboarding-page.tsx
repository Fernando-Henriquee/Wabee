import { CircleCheck, Lock, SkipForward } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type OnboardingSnapshot, useOnboardingSnapshot, useSaveOnboardingState } from '@/data/settings';
import { type OnboardingState, useMember } from '@/features/member/member-context';
import { BackLink } from '@/features/settings/bits';
import { cn } from '@/lib/cn';
import { initialStep, nextStep, previousStep, STEPS, type StepKey, type StepStatus, stepIndex, stepStatus, updateState } from './onboarding-logic';
import type { StepNav } from './step-ui';
import { StepFinish, StepItems, StepOpening, StepProducts, StepPurchases } from './steps-guides';
import { StepAccounts, StepCompany, StepPrinter } from './steps-setup';

/** Assistente de configuração inicial (US-0.11): passos com progresso salvo em settings.onboarding_state. */
export function OnboardingPage() {
  const { can } = useMember();
  const allowed = can('settings');
  const snapshot = useOnboardingSnapshot(allowed);
  if (!allowed) {
    return (
      <Page>
        <PageHeader title="Configuração inicial" />
        <EmptyState icon={<Lock />} title="Sem permissão" description="Só o perfil Dono faz a configuração inicial." />
      </Page>
    );
  }
  if (snapshot.isError) return <Page><ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} /></Page>;
  if (!snapshot.data) return <Page><LoadingBlock /></Page>;
  return <Wizard snapshot={snapshot.data} />;
}

const STATUS_LABELS: Record<StepStatus, string> = { done: 'feito', skipped: 'pulado', pending: 'pendente' };

function StatusIcon({ status, index, active }: { status: StepStatus; index: number; active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ring-1 ring-inset',
        status === 'done' ? 'bg-success-soft text-success ring-success/30' : status === 'skipped' ? 'bg-warning-soft text-warning ring-warning/30' : 'bg-panel text-muted ring-line-strong',
        active && 'bg-ink text-brand-fg ring-ink',
      )}
    >
      {status === 'done' && !active ? <CircleCheck className="size-4" /> : status === 'skipped' && !active ? <SkipForward className="size-3.5" /> : index + 1}
    </span>
  );
}

function Wizard({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const { settings } = useMember();
  const navigate = useNavigate();
  const [state, setState] = useState<OnboardingState>(() => settings.onboarding_state ?? {});
  const statuses = useMemo(
    () => Object.fromEntries(STEPS.map((s) => [s.key, stepStatus(s.key, snapshot, settings.go_live_date, state)])) as Record<StepKey, StepStatus>,
    [snapshot, settings.go_live_date, state],
  );
  const [current, setCurrent] = useState<StepKey>(() => initialStep(statuses, state));
  const save = useSaveOnboardingState();
  const alreadyDone = settings.onboarding_state?.done === true;

  const go = (key: StepKey, change: { complete?: StepKey; skip?: StepKey } = {}) => {
    const next = updateState(state, { step: key, ...change });
    setState(next);
    setCurrent(key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    save.mutate(next);
  };

  const finish = () => {
    const next = updateState(state, { step: 'concluir', complete: 'concluir', done: true });
    save.mutate(next, {
      onSuccess: () => {
        setState(next);
        toast.success('Configuração concluída. Bom trabalho!');
        navigate('/');
      },
    });
  };

  const prev = previousStep(current);
  const nav: StepNav = {
    status: statuses[current],
    complete: () => (current === 'concluir' ? finish() : go(nextStep(current) ?? 'concluir', { complete: current })),
    skip: () => go(nextStep(current) ?? 'concluir', { skip: current }),
    back: prev ? () => go(prev) : null,
    busy: save.isPending,
  };

  const index = stepIndex(current);
  const step = STEPS[index]!;
  const doneCount = STEPS.filter((s) => s.key !== 'concluir' && statuses[s.key] === 'done').length;
  const total = STEPS.length - 1;

  let body: ReactNode;
  switch (current) {
    case 'empresa':
      body = <StepCompany nav={nav} />;
      break;
    case 'contas':
      body = <StepAccounts nav={nav} snapshot={snapshot} />;
      break;
    case 'impressora':
      body = <StepPrinter nav={nav} snapshot={snapshot} />;
      break;
    case 'itens':
      body = <StepItems nav={nav} snapshot={snapshot} />;
      break;
    case 'produtos':
      body = <StepProducts nav={nav} snapshot={snapshot} />;
      break;
    case 'compras':
      body = <StepPurchases nav={nav} snapshot={snapshot} />;
      break;
    case 'estoque':
      body = <StepOpening nav={nav} snapshot={snapshot} />;
      break;
    case 'concluir':
      body = <StepFinish nav={nav} statuses={statuses} onOpen={(key) => go(key)} alreadyDone={alreadyDone} />;
      break;
  }

  return (
    <Page className="max-w-5xl">
      <PageHeader
        back={
          <BackLink />
        }
        title="Configuração inicial"
        description="Um passo a passo para colocar a Wabee no ar. O progresso fica salvo: dá para parar e continuar depois."
      />

      {/* Celular: progresso e atalhos para os passos. */}
      <div className="mb-4 lg:hidden">
        <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-ink">
            Passo {index + 1} de {STEPS.length}
          </span>
          <span className="text-xs text-muted">
            {doneCount} de {total} feitos
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} aria-label="Passos feitos">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / total) * 100}%` }} />
        </div>
        <ol className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Passos">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => go(s.key)}
                aria-current={s.key === current ? 'step' : undefined}
                aria-label={`${i + 1}. ${s.title} (${STATUS_LABELS[statuses[s.key]]})`}
                className="grid size-10 place-items-center rounded-full"
              >
                <StatusIcon status={statuses[s.key]} index={i} active={s.key === current} />
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Passos da configuração" className="hidden lg:block">
          <div className="sticky top-6 space-y-3">
            <div>
              <div className="mb-1.5 flex justify-between text-xs text-muted">
                <span>Progresso</span>
                <span>
                  {doneCount} de {total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / total) * 100}%` }} />
              </div>
            </div>
            <ol className="space-y-0.5">
              {STEPS.map((s, i) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => go(s.key)}
                    aria-current={s.key === current ? 'step' : undefined}
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-subtle', s.key === current && 'bg-panel shadow-[var(--shadow-card)] ring-1 ring-line')}
                  >
                    <StatusIcon status={statuses[s.key]} index={i} active={s.key === current} />
                    <span className="min-w-0">
                      <span className={cn('block truncate text-sm', s.key === current ? 'font-semibold text-ink' : 'text-ink-soft')}>{s.title}</span>
                      <span className="block truncate text-xs text-muted">{STATUS_LABELS[statuses[s.key]]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <Card className="min-w-0">
          <CardHeader
            title={`${index + 1}. ${step.title}`}
            description={step.short}
            actions={
              current !== 'concluir' ? (
                <Badge tone={statuses[current] === 'done' ? 'success' : statuses[current] === 'skipped' ? 'warning' : 'neutral'}>{STATUS_LABELS[statuses[current]]}</Badge>
              ) : null
            }
          />
          <div key={current}>{body}</div>
        </Card>
      </div>
    </Page>
  );
}
