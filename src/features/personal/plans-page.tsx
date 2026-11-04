import { ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type PfPlan, PLAN_KIND_LABELS, usePfPlans, usePfSchedule } from '@/data/personal';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addDays, diffInDays, formatDateBR } from '@/lib/dates';
import { PlanFormDialog } from './plan-dialogs';
import { PMoney } from './privacy';
import { ScheduleActions } from './schedule-actions';

const short = (iso: string) => formatDateBR(iso).slice(0, 5);

/** Parcelas e contas: o que vence nos próximos dias e os cadastros (contas fixas, parcelados, financiamentos). */
export function PlansPage() {
  const { today: todayFn } = useMember();
  const today = todayFn();
  const navigate = useNavigate();
  const plans = usePfPlans();
  const horizon = addDays(today, 60);
  const schedule = usePfSchedule({ to: horizon });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PfPlan | null>(null);

  const upcoming = useMemo(() => (schedule.data ?? []).filter((r) => r.status === 'PREVISTO'), [schedule.data]);
  const grouped = useMemo(() => {
    const active = (plans.data ?? []).filter((p) => p.status === 'ATIVO');
    return {
      active,
      closed: (plans.data ?? []).filter((p) => p.status === 'ENCERRADO'),
    };
  }, [plans.data]);

  const open = (plan: PfPlan) => (plan.kind === 'PARCELADO' || plan.kind === 'FINANCIAMENTO' ? navigate(`/pessoal/parcelas/${plan.id}`) : setEditing(plan));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Tudo o que vence entra no seu limite do dia antes de você gastar.</p>
        <Button onClick={() => setCreating(true)}>
          <Plus /> Novo cadastro
        </Button>
      </div>

      <Card>
        <CardHeader title="Próximos vencimentos" description="Os próximos 60 dias, incluindo o que está atrasado." />
        {schedule.isError ? (
          <div className="p-4"><ErrorState error={schedule.error} /></div>
        ) : !schedule.data ? (
          <div className="p-4"><LoadingBlock rows={3} /></div>
        ) : upcoming.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nada a vencer. Cadastre suas contas fixas, parcelas e financiamentos para ver aqui.</p>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((r) => {
              const days = diffInDays(r.due_date, today);
              const income = r.plan_kind === 'ENTRADA_FIXA';
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {r.plan_name}
                      {r.installments_total ? <span className="text-muted"> {r.number}/{r.installments_total}</span> : null}
                      {income ? <Badge tone="success" className="ml-1.5">entrada</Badge> : null}
                    </p>
                    <p className={cn('text-xs', days < 0 && !income ? 'font-medium text-danger' : 'text-muted')}>
                      {days < 0 ? `${income ? 'Prevista' : 'Atrasada'} desde ${short(r.due_date)}` : days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : short(r.due_date)}
                    </p>
                  </div>
                  <PMoney value={r.amount} className={cn('text-sm font-semibold', income && 'text-success')} />
                  <ScheduleActions row={r} compact />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Cadastros" description="Contas fixas, entradas, compras parceladas e financiamentos." />
        {plans.isError ? (
          <div className="p-4"><ErrorState error={plans.error} /></div>
        ) : !plans.data ? (
          <div className="p-4"><LoadingBlock rows={3} /></div>
        ) : grouped.active.length === 0 ? (
          <EmptyState
            title="Nenhum cadastro"
            description="Comece pelo salário e pelas contas que se repetem todo mês. Depois cadastre parcelas e financiamentos."
            className="m-4"
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus /> Novo cadastro
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {grouped.active.map((p) => (
              <PlanRow key={p.id} plan={p} onOpen={() => open(p)} />
            ))}
          </ul>
        )}
        {grouped.closed.length > 0 ? (
          <details className="border-t border-line">
            <summary className="cursor-pointer px-4 py-2.5 text-sm text-muted">Encerrados ({grouped.closed.length})</summary>
            <ul className="divide-y divide-line">
              {grouped.closed.map((p) => (
                <PlanRow key={p.id} plan={p} onOpen={() => open(p)} />
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <PlanFormDialog open={creating} onOpenChange={setCreating} onSaved={(id) => void id} />
      {editing ? <PlanFormDialog plan={editing} open onOpenChange={(openState) => !openState && setEditing(null)} /> : null}
    </div>
  );
}

function PlanRow({ plan: p, onOpen }: { plan: PfPlan; onOpen: () => void }) {
  const total = p.installments_total;
  const progress = total ? Math.min(p.paid_count / total, 1) : null;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {p.name} <Badge className="ml-1">{PLAN_KIND_LABELS[p.kind]}</Badge>
          </p>
          <p className="text-xs text-muted">
            {total ? `${p.paid_count} de ${total} pagas` : 'Todo mês'}
            {p.next_due ? ` · próxima ${short(p.next_due)}` : ''}
            {p.kind === 'FINANCIAMENTO' && p.outstanding_principal !== null ? <> · saldo devedor <PMoney value={p.outstanding_principal} /></> : null}
          </p>
          {progress !== null ? (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label={`Progresso de ${p.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <div className="h-full rounded-full bg-success" style={{ width: `${progress * 100}%` }} />
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <PMoney value={p.kind === 'PARCELADO' || p.kind === 'FINANCIAMENTO' ? p.remaining_amount : p.amount} className={cn('text-sm font-semibold', p.kind === 'ENTRADA_FIXA' && 'text-success')} />
          <p className="text-xs text-muted">{p.kind === 'PARCELADO' || p.kind === 'FINANCIAMENTO' ? 'a pagar' : 'por mês'}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
    </li>
  );
}
