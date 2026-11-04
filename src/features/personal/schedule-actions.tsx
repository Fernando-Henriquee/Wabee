import { CheckCircle2, MoreHorizontal, Pencil, RotateCcw, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { type PfScheduleRow, useSkipSchedule, useUnpaySchedule } from '@/data/personal';
import { PayDialog, ScheduleAmountDialog } from './plan-dialogs';

/** Ações de um vencimento: pagar/receber, mudar o valor, pular ou desfazer. */
export function ScheduleActions({ row, compact }: { row: PfScheduleRow; compact?: boolean }) {
  const [dialog, setDialog] = useState<'pay' | 'amount' | null>(null);
  const skip = useSkipSchedule();
  const unpay = useUnpaySchedule();
  const income = row.plan_kind === 'ENTRADA_FIXA';
  const title = row.installments_total ? `${row.plan_name} (${row.number}/${row.installments_total})` : row.plan_name;
  return (
    <div className="flex items-center gap-1">
      {row.status === 'PREVISTO' ? (
        <Button size="sm" variant="outline" onClick={() => setDialog('pay')}>
          <CheckCircle2 /> {compact ? null : income ? 'Receber' : 'Pagar'}
          {compact ? <span className="sr-only">{income ? 'Receber' : 'Pagar'}</span> : null}
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Mais ações de ${title}`}>
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          {row.status === 'PREVISTO' ? (
            <>
              <MenuItem onSelect={() => setDialog('amount')}>
                <Pencil /> Alterar o valor
              </MenuItem>
              <MenuItem onSelect={() => skip.mutate(row.id)}>
                <SkipForward /> Pular este vencimento
              </MenuItem>
            </>
          ) : (
            <MenuItem onSelect={() => unpay.mutate(row.id)}>
              <RotateCcw /> {row.status === 'PAGO' ? (income ? 'Desfazer o recebimento' : 'Desfazer o pagamento') : 'Voltar a prever'}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      {dialog === 'pay' ? <PayDialog target={{ scheduleId: row.id, name: title, amount: row.amount, dueDate: row.due_date, accountId: row.account_id, income }} open onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === 'amount' ? <ScheduleAmountDialog id={row.id} name={title} amount={row.amount} open onOpenChange={(open) => !open && setDialog(null)} /> : null}
    </div>
  );
}
