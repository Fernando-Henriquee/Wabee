import { cn } from '@/lib/cn';

interface SegmentedProps<T extends string> {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** Escolha entre poucas opções (alvos de toque de 40 px no celular). */
export function Segmented<T extends string>({ value, options, onChange, label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full rounded-lg border border-line bg-subtle p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-10 flex-1 whitespace-nowrap rounded-md px-3 sm:h-9 text-sm font-medium text-muted transition-colors hover:text-ink',
            value === option.value && 'bg-panel text-ink shadow-sm',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
