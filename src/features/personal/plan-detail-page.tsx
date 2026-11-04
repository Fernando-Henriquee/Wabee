import { ArrowLeft, Pencil, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { PLAN_KIND_LABELS, type PfScheduleStatus, useClosePlan, usePfPlan, usePfSchedule } from '@/data/personal';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import { PlanFormDialog } from './plan-dialogs';
import { PMoney } from './privacy';
import { ScheduleActions } from './schedule-actions';

const STATUS: Record<PfScheduleStatus, { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  PREVISTO: { label: 'a pagar', tone: 'warning' },
  PAGO: { label: 'paga', tone: 'success' },
  PULADO: { label: 'pulada', tone: 'neutral' },
};

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold">{children}</dd>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Detalhe de um parcelado ou financiamento: saldo devedor, juros e a tabela de parcelas. */
export function PlanDetailPage() {
  const { id } = useParams();
  const planId = id ? Number(id) : undefined;
  const navigate = useNavigate();
  const plan = usePfPlan(planId);
  const schedule = usePfSchedule({ planId });
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const close = useClosePlan(() => navigate('/pessoal/parcelas'));

  if (plan.isError) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  if (plan.data === undefined) return <LoadingBlock />;
  if (!plan.data) {
    return <EmptyState title="Cadastro não encontrado" action={<Button asChild><Link to="/pessoal/parcelas">Voltar</Link></Button>} />;
  }
  const p = plan.data;
  const financing = p.kind === 'FINANCIAMENTO';
  const total = p.installments_total ?? 0;
  const progress = total > 0 ? p.paid_count / total : 0;
  const rows = schedule.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/pessoal/parcelas" className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Parcelas e contas
          </Link>
          <h2 className="text-xl font-semibold">{p.name}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge>{PLAN_KIND_LABELS[p.kind]}</Badge>
            {p.lender ? <span>{p.lender}</span> : null}
            {financing && p.rate_month !== null ? <span>{formatPercent(p.rate_month, 2)} ao mês</span> : null}
            {p.status === 'ENCERRADO' ? <Badge tone="neutral">encerrado</Badge> : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> Editar
          </Button>
          {p.status === 'ATIVO' ? (
            <Button variant="danger-outline" onClick={() => setClosing(true)}>
              <XCircle /> {financing ? 'Quitar / encerrar' : 'Encerrar'}
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {financing && p.outstanding_principal !== null ? (
          <Stat label="Saldo devedor" hint="Do valor financiado, sem os juros futuros">
            <PMoney value={p.outstanding_principal} />
          </Stat>
        ) : null}
        <Stat label="Falta pagar" hint={`${p.open_count} ${p.open_count === 1 ? 'parcela' : 'parcelas'}`}>
          <PMoney value={p.remaining_amount} />
        </Stat>
        <Stat label="Já pago" hint={`${p.paid_count} de ${total}`}>
          <PMoney value={p.paid_amount} />
        </Stat>
        {financing && p.total_interest !== null ? (
          <Stat label="Juros no total">
            <PMoney value={p.total_interest} />
          </Stat>
        ) : (
          <Stat label="Última parcela">{p.last_due ? formatDateBR(p.last_due) : '—'}</Stat>
        )}
      </dl>

      <div>
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>{Math.round(progress * 100)}% das parcelas pagas</span>
          <span>{financing && p.last_due ? `Quitação prevista em ${formatDateBR(p.last_due)}` : null}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Parcelas pagas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full rounded-full bg-success" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <Card>
        <CardHeader title="Parcelas" description={financing ? 'Juros e amortização de cada parcela. Mude o valor de uma parcela se o banco cobrar diferente.' : undefined} />
        {schedule.isError ? (
          <div className="p-4"><ErrorState error={schedule.error} /></div>
        ) : !schedule.data ? (
          <div className="p-4"><LoadingBlock rows={4} /></div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">Nº</th>
                  <th scope="col" className="px-2 py-2 font-medium">Vence</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Parcela</th>
                  {financing ? <th scope="col" className="px-2 py-2 text-right font-medium">Juros</th> : null}
                  {financing ? <th scope="col" className="px-2 py-2 text-right font-medium">Amortização</th> : null}
                  <th scope="col" className="px-2 py-2 font-medium">Situação</th>
                  <th scope="col" className="px-4 py-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className={cn(r.status === 'PULADO' && 'text-muted')}>
                    <td className="px-4 py-2">{r.number}</td>
                    <td className="px-2 py-2">{formatDateBR(r.due_date)}</td>
                    <td className="px-2 py-2 text-right font-medium"><PMoney value={r.amount} /></td>
                    {financing ? <td className="px-2 py-2 text-right text-muted"><PMoney value={r.interest} /></td> : null}
                    {financing ? <td className="px-2 py-2 text-right text-muted"><PMoney value={r.interest === null ? null : r.amount - r.interest} /></td> : null}
                    <td className="px-2 py-2"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                    <td className="px-4 py-2 text-right">{p.status === 'ATIVO' || r.status !== 'PREVISTO' ? <ScheduleActions row={r} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing ? <PlanFormDialog plan={p} open onOpenChange={(open) => !open && setEditing(false)} /> : null}
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={financing ? 'Quitar ou encerrar este financiamento?' : 'Encerrar este cadastro?'}
        description="As parcelas que ainda estavam a pagar ficam como puladas e saem do seu limite do dia. O que já foi pago continua nos lançamentos."
        confirmLabel="Encerrar"
        onConfirm={() => close.mutateAsync(p.id).catch(() => undefined)}
      />
    </div>
  );
}
