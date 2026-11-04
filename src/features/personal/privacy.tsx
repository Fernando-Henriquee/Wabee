import { Eye, EyeOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatBRL } from '@/lib/money';
import { PRIVACY_KEY, PrivacyContext, usePrivacy } from './privacy-context';

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(PRIVACY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setHidden((current) => {
      try {
        window.localStorage.setItem(PRIVACY_KEY, current ? '0' : '1');
      } catch {
        // armazenamento indisponível: vale só nesta visita
      }
      return !current;
    });
  return <PrivacyContext.Provider value={{ hidden, toggle }}>{children}</PrivacyContext.Provider>;
}

/** Valor em reais, oculto quando a pessoa ativou a privacidade. */
export function PMoney({ value, className, signed }: { value: number | string | null | undefined; className?: string; signed?: boolean }) {
  const { hidden } = usePrivacy();
  if (value === null || value === undefined || value === '') return <span className={className}>—</span>;
  const n = Number(value);
  const text = formatBRL(Math.abs(n));
  const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
  return (
    <span className={cn('num whitespace-nowrap', className)} aria-label={hidden ? 'valor oculto' : undefined}>
      {hidden ? 'R$ •••' : `${sign}${text}`}
    </span>
  );
}

export function PrivacyToggle() {
  const { hidden, toggle } = usePrivacy();
  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-pressed={hidden} aria-label={hidden ? 'Mostrar valores' : 'Ocultar valores'} title={hidden ? 'Mostrar valores' : 'Ocultar valores'}>
      {hidden ? <EyeOff /> : <Eye />}
    </Button>
  );
}
