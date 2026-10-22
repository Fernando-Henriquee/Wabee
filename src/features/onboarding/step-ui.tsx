import { ArrowLeft, ArrowRight, CircleCheck, SkipForward } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { StepStatus } from './onboarding-logic';

/** Ações de navegação que a página do assistente entrega a cada passo. */
export interface StepNav {
  status: StepStatus;
  /** Marca o passo como concluído e abre o próximo. */
  complete: () => void;
  /** Marca como pulado e abre o próximo. */
  skip: () => void;
  back: (() => void) | null;
  /** Salvando o progresso. */
  busy: boolean;
}

export function StepFooter({ nav, children, skipLabel = 'Pular este passo' }: { nav: StepNav; children?: ReactNode; skipLabel?: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      {nav.back ? (
        <Button variant="ghost" onClick={nav.back} disabled={nav.busy}>
          <ArrowLeft /> Voltar
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {nav.status !== 'done' ? (
          <Button variant="outline" onClick={nav.skip} disabled={nav.busy}>
            <SkipForward /> {skipLabel}
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function ContinueButton({ nav, label = 'Continuar' }: { nav: StepNav; label?: string }) {
  return (
    <Button onClick={nav.complete} loading={nav.busy}>
      {label} <ArrowRight />
    </Button>
  );
}

/** Caixa de explicação (o porquê do passo). */
export function Explain({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl bg-subtle px-3.5 py-3 text-sm leading-relaxed text-ink-soft [&_strong]:text-ink', className)}>{children}</div>;
}

export function DoneNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-success-soft px-3.5 py-2.5 text-sm text-success">
      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Contador com link (filamentos, produtos…). */
export function CountTile({ label, value, to }: { label: string; value: number; to?: string }) {
  const body = (
    <>
      <span className="num block text-2xl font-semibold text-ink">{value}</span>
      <span className="block text-xs text-muted">{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className="block min-h-16 rounded-xl border border-line bg-panel px-3 py-2.5 hover:border-ink">
      {body}
    </Link>
  ) : (
    <div className="min-h-16 rounded-xl border border-line bg-panel px-3 py-2.5">{body}</div>
  );
}
