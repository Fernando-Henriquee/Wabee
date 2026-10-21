import { type InputHTMLAttributes, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDecimalBR, parseBRL, parseQuantity } from '@/lib/money';
import { Input } from './input';

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Valor em centavos (null = vazio). */
  value: number | null;
  onValueChange: (cents: number | null) => void;
}

/** Campo de valor em reais: aceita "12,5", "1.234,56"; guarda centavos inteiros. */
export function MoneyInput({ value, onValueChange, className, onBlur, onFocus, ...props }: MoneyInputProps) {
  // Enquanto o campo está em edição mostramos o texto digitado; fora dele, o valor formatado.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : formatDecimalBR(value));

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        className={cn('num pl-9 text-right', className)}
        value={shown}
        onFocus={(event) => {
          setDraft(shown);
          onFocus?.(event);
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d.,-]/g, '');
          setDraft(next);
          onValueChange(next.trim() === '' ? null : parseBRL(next));
        }}
        onBlur={(event) => {
          setDraft(null);
          onBlur?.(event);
        }}
        {...props}
      />
    </div>
  );
}

interface QuantityInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null;
  onValueChange: (value: number | null) => void;
}

function quantityText(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

/** Quantidade com até 3 casas decimais, vírgula decimal. */
export function QuantityInput({ value, onValueChange, className, ...props }: QuantityInputProps) {
  const [draft, setDraft] = useState(quantityText(value));
  // Se o valor mudou por fora (ex.: botões + e −), o texto digitado deixa de valer.
  const shown = parseQuantity(draft) === value ? draft : quantityText(value);
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      className={cn('num text-right', className)}
      value={shown}
      onChange={(event) => {
        const next = event.target.value.replace(/[^\d,.]/g, '');
        setDraft(next);
        onValueChange(parseQuantity(next));
      }}
      {...props}
    />
  );
}
