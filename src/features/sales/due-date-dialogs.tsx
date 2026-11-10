import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSetOrderDueDate, useSetReceivableDueDate } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { addDays, isValidISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';

function DatePresets({ today, onChange }: { today: string; onChange: (date: string) => void }) {
  const presets = [
    { label: 'Hoje', days: 0 },
    { label: 'Amanhã', days: 1 },
    { label: '1 semana', days: 7 },
    { label: '15 dias', days: 15 },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => (
        <Button key={p.days} type="button" size="sm" variant="outline" onClick={() => onChange(addDays(today, p.days))}>
          {p.label}
        </Button>
      ))}
    </div>
  );
}

function DateDialog({
  title,
  description,
  fieldLabel,
  hint,
  required,
  initial,
  saving,
  onSubmit,
  onOpenChange,
  error,
}: {
  title: string;
  description: string;
  fieldLabel: string;
  hint?: string;
  required?: boolean;
  initial: string;
  saving: boolean;
  onSubmit: (date: string) => void;
  onOpenChange: (open: boolean) => void;
  error: string | null;
}) {
  const { today } = useMember();
  const [date, setDate] = useState(initial);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={() => onSubmit(date)} loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={fieldLabel} hint={hint} required={required}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
          </Field>
          <DatePresets today={today()} onChange={setDate} />
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Corrige o prazo de entrega de um pedido já confirmado. */
export function OrderDueDateDialog({ orderId, number, current, onOpenChange }: { orderId: number; number: string; current: string | null; onOpenChange: (open: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useSetOrderDueDate(() => onOpenChange(false));
  return (
    <DateDialog
      title="Prazo de entrega"
      description={`Pedido ${number}. Dá para corrigir a data a qualquer momento antes da entrega.`}
      fieldLabel="Entregar até"
      hint="Em branco: o pedido fica sem prazo."
      initial={current ?? ''}
      saving={save.isPending}
      error={error}
      onOpenChange={onOpenChange}
      onSubmit={(date) => {
        setError(null);
        if (date && !isValidISODate(date)) return setError('Data inválida.');
        save.mutate({ orderId, date: date || null }, { onError: (e) => setError(describeError(e)) });
      }}
    />
  );
}

/** Corrige o vencimento de uma parcela a receber em aberto. */
export function ReceivableDueDateDialog({ installmentId, label, current, onOpenChange }: { installmentId: number; label: string; current: string; onOpenChange: (open: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useSetReceivableDueDate(() => onOpenChange(false));
  return (
    <DateDialog
      title="Vencimento do pagamento"
      description={label}
      fieldLabel="Vence em"
      required
      initial={current}
      saving={save.isPending}
      error={error}
      onOpenChange={onOpenChange}
      onSubmit={(date) => {
        setError(null);
        if (!isValidISODate(date)) return setError('Informe uma data de vencimento válida.');
        save.mutate({ installmentId, date }, { onError: (e) => setError(describeError(e)) });
      }}
    />
  );
}
