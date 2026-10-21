import { cloneElement, createContext, isValidElement, type ReactElement, type ReactNode, useContext, useId } from 'react';
import { cn } from '@/lib/cn';

interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

/**
 * Atributos de acessibilidade do campo atual. Os controles (Input, Select, Textarea…)
 * os usam como padrão, mesmo quando há um Controller do react-hook-form no meio.
 */
const FieldContext = createContext<FieldControlProps | null>(null);

export function useFieldControl<T extends { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: unknown; 'aria-required'?: unknown }>(props: T): T {
  const field = useContext(FieldContext);
  if (!field) return props;
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': props['aria-describedby'] ?? field['aria-describedby'],
    'aria-invalid': props['aria-invalid'] ?? field['aria-invalid'],
    'aria-required': props['aria-required'] ?? field['aria-required'],
  };
}

interface FieldProps {
  label: ReactNode;
  /** Controle (Input, Select, MoneyInput…). Recebe id, aria-describedby e aria-invalid. */
  children: ReactElement<Record<string, unknown>>;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  labelClassName?: string;
}

/** Rótulo + controle + ajuda + erro, com associação acessível (label/for, aria-describedby). */
export function Field({ label, children, hint, error, required, className, labelClassName }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const controlId = (isValidElement(children) && (children.props.id as string | undefined)) || id;
  const a11y: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required || undefined,
  };
  const control = isValidElement(children) ? cloneElement(children, { ...a11y }) : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className={cn('text-sm font-medium text-ink-soft', labelClassName)}>
        {label}
        {required ? <span className="ml-0.5 text-danger" aria-hidden>*</span> : null}
      </label>
      <FieldContext.Provider value={a11y}>{control}</FieldContext.Provider>
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
