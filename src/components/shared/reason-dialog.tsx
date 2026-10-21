import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';

interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<unknown>;
  children?: ReactNode;
}

/** Confirmação de operação destrutiva com motivo obrigatório (fica na auditoria). */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, reasonLabel = 'Motivo', onConfirm, children }: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('');
        onOpenChange(next);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      confirmDisabled={reason.trim().length < 3}
      onConfirm={() => onConfirm(reason.trim())}
    >
      <div className="space-y-3">
        {children}
        <Field label={reasonLabel} required hint="Fica registrado no histórico.">
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
