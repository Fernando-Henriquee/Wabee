import { type InputHTMLAttributes, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDecimal, parseDecimal, toNumber } from '@/lib/money';
import { Input } from './input';

interface DecimalInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Valor decimal canônico ("1234.56") ou null (vazio). */
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Casas decimais aceitas (2 para dinheiro, 6 para custo unitário, 3 para quantidade). */
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

function display(value: string | null, decimals: number, fixed: boolean) {
  if (value === null || value === '') return '';
  return fixed
    ? formatDecimal(value, decimals)
    : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: decimals }).format(toNumber(value));
}

/** Campo numérico em pt-BR: aceita "12,5", "1.234,56"; guarda texto decimal canônico. */
export function DecimalInput({ value, onValueChange, decimals = 2, prefix, suffix, className, onBlur, onFocus, ...props }: DecimalInputProps) {
  // Em edição mostramos o texto digitado; fora dele, o valor formatado.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? display(value, decimals, prefix === 'R$' && decimals === 2);
  return (
    <div className="relative">
      {prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">{prefix}</span> : null}
      <Input
        inputMode="decimal"
        autoComplete="off"
        className={cn('num text-right', prefix && 'pl-9', suffix && 'pr-10', className)}
        value={shown}
        onFocus={(event) => {
          setDraft(shown);
          onFocus?.(event);
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d.,-]/g, '');
          setDraft(next);
          onValueChange(next.trim() === '' ? null : parseDecimal(next, decimals));
        }}
        onBlur={(event) => {
          setDraft(null);
          onBlur?.(event);
        }}
        {...props}
      />
      {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">{suffix}</span> : null}
    </div>
  );
}

/** Dinheiro (R$, 2 casas). */
export function MoneyInput(props: Omit<DecimalInputProps, 'decimals' | 'prefix'>) {
  return <DecimalInput decimals={2} prefix="R$" {...props} />;
}

/** Percentual digitado como "12,5" (%), guardado como fração "0.125". */
export function PercentInput({ value, onValueChange, ...props }: Omit<DecimalInputProps, 'decimals' | 'suffix'>) {
  const pct = value === null || value === '' ? null : String(Math.round(toNumber(value) * 1_000_000) / 10_000);
  return (
    <DecimalInput
      decimals={2}
      suffix="%"
      value={pct}
      onValueChange={(next) => onValueChange(next === null ? null : String(Math.round(toNumber(next) * 10_000) / 1_000_000))}
      {...props}
    />
  );
}
