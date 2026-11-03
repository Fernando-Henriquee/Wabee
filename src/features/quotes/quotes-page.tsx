import { BellRing, CalendarClock, ClipboardList, Hourglass, MessageCircle, PhoneCall, Plus, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { LOST_REASON_LABELS, type LostReason, type QuoteRow, useQuotes } from '@/data/quotes';
import { useMember } from '@/features/member/member-context';
import { sumMoney } from '@/lib/calc';
import { formatDateBR } from '@/lib/dates';
import { ContactDialog, FollowUpDialog, LostDialog, QuoteFormDialog } from './quote-dialogs';
import { ContactButtons, FollowUpText, QuoteStatusBadge } from './quote-bits';
import { lostReasonText, priceText, quoteSummary } from './quote-utils';
import { followUpTemplates, quoteMessageContext } from './quote-messages';

type TabKey = 'abertos' | 'encerrados';
type RowAction = { kind: 'contact' | 'follow-up' | 'lost'; quote: QuoteRow };

/** Pedidos de orçamento: o que precisa de retorno hoje, o que espera análise e o que aguarda o cliente. */
export function QuotesPage() {
  const { can, settings, today } = useMember();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('aba') === 'encerrados' ? 'encerrados' : 'abertos';
  const reason = (params.get('motivo') as LostReason | null) ?? '';
  const quotes = useQuotes();
  const [formOpen, setFormOpen] = useState(() => params.get('novo') === '1');
  const [action, setAction] = useState<RowAction | null>(null);
  const write = can('write');

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const groups = useMemo(() => {
    const all = quotes.data ?? [];
    const open = all.filter((q) => q.is_open);
    const byFollowUp = (a: QuoteRow, b: QuoteRow) => (a.follow_up_at ?? '9999').localeCompare(b.follow_up_at ?? '9999') || a.id - b.id;
    return {
      due: open.filter((q) => q.follow_up_due).sort(byFollowUp),
      toAnalyze: open.filter((q) => !q.follow_up_due && q.status === 'NOVO').sort((a, b) => a.id - b.id),
      waiting: open.filter((q) => !q.follow_up_due && q.status !== 'NOVO').sort(byFollowUp),
      closed: all.filter((q) => !q.is_open && (!reason || q.lost_reason === reason)).sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? '')),
      open,
    };
  }, [quotes.data, reason]);

  const openValue = sumMoney(groups.open.map((q) => q.quoted_total ?? 0));

  return (
    <Page>
      <PageHeader
        title="Orçamentos"
        description="Anote o pedido na hora, analise depois e não deixe ninguém sem retorno."
        actions={
          write ? (
            <Button onClick={() => setFormOpen(true)}>
              <Plus /> Anotar orçamento
            </Button>
          ) : undefined
        }
      />

      {quotes.isError ? (
        <ErrorState error={quotes.error} onRetry={() => void quotes.refetch()} />
      ) : !quotes.data ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Para retomar hoje" value={groups.due.length} format={(v) => String(v)} tone={groups.due.length > 0 ? 'warning' : 'default'} />
            <Stat label="Para analisar" value={groups.toAnalyze.length} format={(v) => String(v)} />
            <Stat label="Aguardando cliente" value={groups.waiting.length} format={(v) => String(v)} />
            <Stat label="Propostas em aberto" value={openValue} hint="Soma das propostas já enviadas" />
          </div>

          <Tabs value={tab} onValueChange={(value) => setParam('aba', value === 'encerrados' ? value : null)}>
            <TabsList>
              <TabsTrigger value="abertos">Em aberto ({groups.open.length})</TabsTrigger>
              <TabsTrigger value="encerrados">Encerrados</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'abertos' ? (
            groups.open.length === 0 ? (
              <EmptyState
                icon={<ClipboardList />}
                title="Nenhum orçamento em aberto"
                description="Quando alguém pedir um orçamento, anote aqui em segundos (o que quer, tamanho, cor). Depois você analisa, envia o valor e o sistema lembra de procurar quem não respondeu."
                action={
                  write ? (
                    <Button onClick={() => setFormOpen(true)}>
                      <Plus /> Anotar o primeiro
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <Band icon={<BellRing />} title="Retomar hoje" description="O retorno marcado chegou: procure essas pessoas." quotes={groups.due} empty="Ninguém para procurar hoje." tone="warning" onAction={setAction} write={write} company={settings.company_name} today={today()} highlight />
                <Band icon={<ClipboardList />} title="Para analisar" description="Anotados e ainda sem ficha ou preço." quotes={groups.toAnalyze} empty="Tudo analisado." onAction={setAction} write={write} company={settings.company_name} today={today()} />
                <Band icon={<Hourglass />} title="Aguardando o cliente" description="Em análise ou com proposta enviada, retorno ainda não venceu." quotes={groups.waiting} empty="Nenhuma proposta esperando resposta." onAction={setAction} write={write} company={settings.company_name} today={today()} />
              </>
            )
          ) : (
            <Card>
              <CardHeader
                title="Encerrados"
                description="Viraram pedido ou foram perdidos. Os motivos mostram o que ajustar para fechar mais."
                actions={
                  <Select aria-label="Motivo da perda" className="h-9 w-auto" value={reason} onChange={(e) => setParam('motivo', e.target.value)}>
                    <option value="">Todos os motivos</option>
                    {(Object.keys(LOST_REASON_LABELS) as LostReason[]).map((r) => (
                      <option key={r} value={r}>
                        {LOST_REASON_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                }
              />
              {groups.closed.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">Nada encerrado nesta seleção.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {groups.closed.map((q) => (
                    <li key={q.id}>
                      <button type="button" onClick={() => navigate(`/orcamentos/${q.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {q.item_wanted} <span className="text-muted">· {q.display_name ?? 'sem nome'}</span>
                          </p>
                          <p className="text-xs text-muted">
                            {q.number} · {formatDateBR(q.closed_at?.slice(0, 10))}
                            {q.status === 'GANHO' && q.order_number ? ` · pedido ${q.order_number}` : ''}
                            {q.status === 'PERDIDO' ? ` · ${lostReasonText(q)}` : ''}
                          </p>
                        </div>
                        <div className="text-right text-xs">
                          <QuoteStatusBadge status={q.status} />
                          {priceText(q) ? <p className="num mt-1 text-muted">{priceText(q)}</p> : null}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}

      <QuoteFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open && params.get('novo')) setParam('novo', null);
        }}
        onSaved={(id) => navigate(`/orcamentos/${id}`)}
      />
      {action?.kind === 'contact' ? <ContactDialog key={action.quote.id} quote={action.quote} open onOpenChange={(open) => !open && setAction(null)} /> : null}
      {action?.kind === 'follow-up' ? <FollowUpDialog key={action.quote.id} quote={action.quote} open onOpenChange={(open) => !open && setAction(null)} /> : null}
      {action?.kind === 'lost' ? <LostDialog key={action.quote.id} quote={action.quote} open onOpenChange={(open) => !open && setAction(null)} /> : null}
    </Page>
  );
}

function Band({
  icon,
  title,
  description,
  quotes,
  empty,
  onAction,
  write,
  company,
  today,
  highlight,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  quotes: QuoteRow[];
  empty: string;
  tone?: 'warning';
  onAction: (action: RowAction) => void;
  write: boolean;
  company: string;
  today: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight && quotes.length > 0 ? 'border-warning/40' : undefined}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted">
            {icon} {title} <Badge tone={highlight && quotes.length > 0 ? 'warning' : 'neutral'}>{quotes.length}</Badge>
          </span>
        }
        description={description}
      />
      {quotes.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {quotes.map((q) => (
            <QuoteItem key={q.id} quote={q} write={write} company={company} today={today} onAction={onAction} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function QuoteItem({ quote: q, write, company, today, onAction }: { quote: QuoteRow; write: boolean; company: string; today: string; onAction: (action: RowAction) => void }) {
  const templates = followUpTemplates(quoteMessageContext(q, company, null));
  const summary = quoteSummary(q);
  const price = priceText(q);
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/orcamentos/${q.id}`} className="min-w-0 flex-1 hover:underline">
          <p className="truncate text-sm font-semibold">{q.item_wanted}</p>
          <p className="truncate text-xs text-muted">
            {q.display_name ?? 'Sem nome'}
            {summary ? ` · ${summary}` : ''}
          </p>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <QuoteStatusBadge status={q.status} />
          <FollowUpText quote={q} today={today} />
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span>{q.number}</span>
        <span>anotado há {q.age_days === 0 ? 'menos de 1 dia' : q.age_days === 1 ? '1 dia' : `${q.age_days} dias`}</span>
        {price ? <span className="num font-medium text-ink">{price}</span> : null}
        {q.follow_up_count > 0 ? (
          <span>
            <PhoneCall className="mr-1 inline size-3 align-[-1px]" aria-hidden />
            {q.follow_up_count} {q.follow_up_count === 1 ? 'contato' : 'contatos'}
          </span>
        ) : null}
        {q.valid_until ? (
          <span>
            <CalendarClock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
            vale até {formatDateBR(q.valid_until).slice(0, 5)}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <ContactButtons phone={q.phone} instagram={q.instagram} text={templates[0]?.text} />
        {write ? (
          <>
            <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'contact', quote: q })}>
              <MessageCircle /> Chamei
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'follow-up', quote: q })}>
              <CalendarClock /> Adiar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'lost', quote: q })}>
              <XCircle /> Perdido
            </Button>
          </>
        ) : null}
        {!q.phone && !q.instagram ? <span className="text-xs text-muted">sem contato anotado</span> : null}
      </div>
    </li>
  );
}

