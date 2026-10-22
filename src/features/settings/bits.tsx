import { ArrowLeft, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';

export function BackLink({ to = '/configuracoes', children = 'Configurações' }: { to?: string; children?: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-8 items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4" /> {children}
    </Link>
  );
}

/** Tela sem permissão para o perfil atual. */
export function NoAccess({ title, description = 'Só o perfil Dono altera as configurações.' }: { title: string; description?: string }) {
  return (
    <Page>
      <PageHeader back={<BackLink />} title={title} />
      <EmptyState icon={<Lock />} title="Sem permissão" description={description} />
    </Page>
  );
}

export function Section({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className={cn('grid grid-cols-1 gap-4 p-4 sm:grid-cols-2', className)}>{children}</div>
    </Card>
  );
}

/** Opção liga/desliga com explicação. Linha inteira clicável (alvo de toque ≥ 40 px). */
export function ToggleRow({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-subtle/60', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-line-strong accent-brand" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-snug text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** Grupo de opções exclusivas em cartões (regime tributário, perfil de acesso…). */
export function ChoiceCards<T extends string>({
  name,
  value,
  onChange,
  options,
  legend,
  className,
  columns = 3,
}: {
  columns?: 2 | 3;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; description?: ReactNode; disabled?: boolean }>;
  legend: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="mb-1.5 text-sm font-medium text-ink-soft">{legend}</legend>
      <div className={cn('grid grid-cols-1 gap-2', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
              value === option.value ? 'border-ink bg-accent-soft/60' : 'border-line hover:bg-subtle/60',
              option.disabled && 'cursor-not-allowed opacity-55',
            )}
          >
            <input
              type="radio"
              name={name}
              className="mt-0.5 size-4 shrink-0 accent-brand"
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{option.label}</span>
              {option.description ? <span className="mt-0.5 block text-xs leading-snug text-muted">{option.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}
