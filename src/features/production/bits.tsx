import { Minus, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFieldControl } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Money } from '@/components/shared/money';
import { formatDateTimeBR } from '@/lib/dates';
import { formatMinutes } from '@/lib/money';
import { type EquipmentStatus, EQUIPMENT_STATUS_LABELS, JOB_STATUS_LABELS, OUTPUT_STATUS_LABELS, type OutputStatus, type PrintJobRow, type PrintJobStatus } from '@/data/production';
import { cn } from '@/lib/cn';
import { splitMinutes } from './helpers';

const JOB_TONES: Record<PrintJobStatus, Tone> = {
  PLANEJADA: 'neutral',
  IMPRIMINDO: 'accent',
  CONCLUIDA: 'success',
  FALHOU: 'danger',
  CANCELADA: 'neutral',
  ESTORNADA: 'warning',
};

export function JobStatusBadge({ status, className }: { status: PrintJobStatus; className?: string }) {
  return (
    <Badge tone={JOB_TONES[status]} className={className}>
      {status === 'IMPRIMINDO' ? <span className="size-1.5 animate-pulse rounded-full bg-accent-ink" aria-hidden /> : null}
      {JOB_STATUS_LABELS[status]}
    </Badge>
  );
}

export function OutputStatusBadge({ status }: { status: OutputStatus | null }) {
  if (!status) return null;
  return <Badge tone={status === 'LIBERADA' ? 'success' : 'info'}>{OUTPUT_STATUS_LABELS[status]}</Badge>;
}

export function EquipmentStatusBadge({ status }: { status: EquipmentStatus }) {
  return <Badge tone={status === 'ATIVO' ? 'success' : status === 'MANUTENCAO' ? 'warning' : 'neutral'}>{EQUIPMENT_STATUS_LABELS[status]}</Badge>;
}

/** Barra de andamento da impressão (decorrido ÷ estimado). */
export function JobProgress({ elapsed, estimated, className }: { elapsed: number | null; estimated: number; className?: string }) {
  const pct = estimated > 0 && elapsed !== null ? Math.min(1, elapsed / estimated) : 0;
  const late = estimated > 0 && elapsed !== null && elapsed > estimated;
  return (
    <span
      className={cn('block h-2 w-full overflow-hidden rounded-full bg-subtle', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      aria-label="Andamento da impressão"
    >
      <span className={cn('block h-full rounded-full', late ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct * 100}%` }} />
    </span>
  );
}

const boxClass = 'h-11 w-full text-center text-base num';

/**
 * Duração em horas + minutos (dois campos numéricos, teclado numérico no celular).
 * Guarda o total em minutos.
 */
export function DurationInput({
  value,
  onChange,
  className,
  disabled,
  ...rest
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}) {
  const a11y = useFieldControl(rest);
  const parts = splitMinutes(value);
  const [draft, setDraft] = useState<{ field: 'h' | 'm'; text: string } | null>(null);
  const shown = (field: 'h' | 'm') => (draft?.field === field ? draft.text : parts ? String(parts[field]) : '');
  const update = (field: 'h' | 'm', text: string) => {
    const clean = text.replace(/\D/g, '').slice(0, 4);
    setDraft({ field, text: clean });
    const h = field === 'h' ? clean : parts ? String(parts.h) : '';
    const m = field === 'm' ? clean : parts ? String(parts.m) : '';
    if (h === '' && m === '') return onChange(null);
    onChange(Number(h || 0) * 60 + Number(m || 0));
  };
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative flex-1">
        <Input
          id={a11y.id}
          aria-describedby={a11y['aria-describedby']}
          aria-invalid={a11y['aria-invalid']}
          aria-label="Horas"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          className={cn(boxClass, 'pr-7')}
          value={shown('h')}
          onFocus={(e) => {
            setDraft({ field: 'h', text: shown('h') });
            e.target.select();
          }}
          onChange={(e) => update('h', e.target.value)}
          onBlur={() => setDraft(null)}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">h</span>
      </div>
      <div className="relative flex-1">
        <Input
          aria-label="Minutos"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          className={cn(boxClass, 'pr-10')}
          value={shown('m')}
          onFocus={(e) => {
            setDraft({ field: 'm', text: shown('m') });
            e.target.select();
          }}
          onChange={(e) => update('m', e.target.value)}
          onBlur={() => setDraft(null)}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">min</span>
      </div>
    </div>
  );
}

/** Quantidade inteira com botões grandes de − e + (alvo de toque de 44px). */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  max,
  label,
  className,
  size = 'md',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));
  const [draft, setDraft] = useState<string | null>(null);
  const box = size === 'sm' ? 'size-9' : 'size-11';
  return (
    <div className={cn('inline-flex items-center gap-1', className)} role="group" aria-label={label}>
      <Button type="button" variant="outline" className={cn(box, 'px-0')} aria-label={`Diminuir ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        <Minus />
      </Button>
      <Input
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        className={cn(size === 'sm' ? 'h-9 w-12' : 'h-11 w-14', 'num px-1 text-center text-base font-semibold')}
        value={draft ?? String(value)}
        onFocus={(e) => {
          setDraft(String(value));
          e.target.select();
        }}
        onChange={(e) => {
          const clean = e.target.value.replace(/\D/g, '').slice(0, 5);
          setDraft(clean);
          if (clean !== '') onChange(clamp(Number(clean)));
        }}
        onBlur={() => setDraft(null)}
      />
      <Button type="button" variant="outline" className={cn(box, 'px-0')} aria-label={`Aumentar ${label}`} disabled={max !== undefined && value >= max} onClick={() => onChange(clamp(value + 1))}>
        <Plus />
      </Button>
    </div>
  );
}

/** Grupo de opções em "pílulas" (escolha única), bom para o toque. */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-9 rounded-full border px-3 text-sm font-medium transition-colors',
            value === option.value ? 'border-ink bg-ink text-brand-fg' : 'border-line-strong bg-panel text-ink-soft hover:bg-subtle',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Info({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

/** Aviso destacado (alerta de material, regra de cálculo…). */
export function Notice({ tone = 'info', icon, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: ReactNode; children: ReactNode; className?: string }) {
  const tones = {
    info: 'border-info/25 bg-info-soft text-info',
    warning: 'border-warning/30 bg-warning-soft text-warning',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    success: 'border-success/25 bg-success-soft text-success',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0', tones[tone], className)}>
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Cartão de impressão na lista do celular (histórico). */
export function JobMobileCard({ job, showCosts, timeZone }: { job: PrintJobRow; showCosts: boolean; timeZone: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {job.code} <JobStatusBadge status={job.status} />
        </p>
        <p className="truncate text-xs text-muted">{job.outputs_summary}</p>
        <p className="text-xs text-muted">
          {formatDateTimeBR(job.finished_at ?? job.created_at, timeZone)} · {job.equipment_name}
        </p>
      </div>
      {job.status !== 'CANCELADA' ? (
        <div className="text-right text-xs">
          <p className="num text-sm font-semibold">
            {job.qty_good}
            {job.qty_failed > 0 ? <span className="text-danger"> / {job.qty_failed}</span> : null}
          </p>
          <p className="num text-muted">{formatMinutes(job.actual_minutes)}</p>
          {showCosts ? <Money value={job.cost_total} className="text-muted" /> : null}
        </div>
      ) : null}
    </div>
  );
}
