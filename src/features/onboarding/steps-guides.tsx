import { ArrowRight, Boxes, CircleCheck, CircleDashed, ExternalLink, Package, PartyPopper, Pencil, Plus, ShoppingCart, Store, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type ChannelWithFees, CHANNEL_KIND_LABELS, type OnboardingSnapshot, useSalesChannelsWithFees } from '@/data/settings';
import { useMember } from '@/features/member/member-context';
import { ChannelDialog } from '@/features/settings/channel-dialog';
import { describeFee, payoutLabel } from '@/features/settings/channel-format';
import { formatDateBR } from '@/lib/dates';
import { formatBRL, formatCost, toNumber } from '@/lib/money';
import { ONBOARDING_STEPS, type StepKey, type StepStatus } from './onboarding-logic';
import { ContinueButton, CountTile, DoneNote, Explain, StepFooter, type StepNav } from './step-ui';

interface GuideProps {
  nav: StepNav;
  snapshot: OnboardingSnapshot;
}

function LinkButton({ to, children, variant = 'accent' }: { to: string; children: ReactNode; variant?: 'accent' | 'outline' }) {
  return (
    <Button asChild variant={variant} className="w-full sm:w-auto">
      <Link to={to}>{children}</Link>
    </Button>
  );
}

function BackHint() {
  return <p className="text-xs text-muted">Ao terminar cada cadastro, volte por Configurações → Assistente inicial: o progresso fica salvo.</p>;
}

// -----------------------------------------------------------------------------
// 5. Filamentos em estoque
// -----------------------------------------------------------------------------

export function StepFilaments({ nav, snapshot }: GuideProps) {
  const { settings } = useMember();
  const total = snapshot.itemCounts.FILAMENT ?? 0;
  const withStock = snapshot.itemsWithStock.FILAMENT ?? 0;
  return (
    <div>
      <div className="space-y-4 p-4">
        <Explain>
          Cadastre cada <strong>filamento</strong> (material, cor e marca) e informe o que você <strong>já tem</strong>: pese os carretéis abertos e conte os fechados no{' '}
          <strong>saldo inicial</strong>. Filamento que veio numa compra que você vai lançar em “Compras já feitas” entra no estoque quando a compra for recebida: não lance de novo.
          Sem custo conhecido, vale a referência de <strong className="num">{formatCost(toNumber(settings.filament_reference_cost_g), 4)}/g</strong>.
        </Explain>
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <CountTile label="Filamentos cadastrados" value={total} to="/estoque?tipo=FILAMENT" />
          <CountTile label="Com saldo em estoque" value={withStock} to="/estoque/carreteis" />
        </div>
        {total > 0 && withStock < total ? (
          <p className="text-sm text-ink-soft">
            {total - withStock === 1 ? '1 filamento ainda está' : `${total - withStock} filamentos ainda estão`} sem saldo. Lance o saldo inicial ou receba a compra deles.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <LinkButton to="/estoque/itens/novo?tipo=FILAMENT">
            <Plus /> Cadastrar filamento
          </LinkButton>
          <LinkButton to="/estoque/saldo-inicial" variant="outline">
            <Boxes /> Lançar saldo inicial
          </LinkButton>
        </div>
        <BackHint />
      </div>
      <StepFooter nav={nav}>{nav.status === 'done' ? <ContinueButton nav={nav} /> : null}</StepFooter>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 6. Componentes em estoque
// -----------------------------------------------------------------------------

export function StepComponents({ nav, snapshot }: GuideProps) {
  const count = (kind: string) => snapshot.itemCounts[kind] ?? 0;
  const stock = (kind: string) => snapshot.itemsWithStock[kind] ?? 0;
  return (
    <div>
      <div className="space-y-4 p-4">
        <Explain>
          Cadastre os <strong>componentes</strong> (argolas, ímãs, correntes) e as <strong>embalagens</strong> (saquinhos, caixas, etiquetas) e informe as quantidades que você já
          tem no <strong>saldo inicial</strong>. Eles entram na ficha técnica dos produtos e saem do estoque a cada montagem ou entrega.
        </Explain>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CountTile label="Componentes" value={count('COMPONENT')} to="/estoque?tipo=COMPONENT" />
          <CountTile label="Componentes com saldo" value={stock('COMPONENT')} />
          <CountTile label="Embalagens" value={count('PACKAGING')} to="/estoque?tipo=PACKAGING" />
          <CountTile label="Embalagens com saldo" value={stock('PACKAGING')} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <LinkButton to="/estoque/itens/novo?tipo=COMPONENT">
            <Plus /> Cadastrar componente
          </LinkButton>
          <LinkButton to="/estoque/itens/novo?tipo=PACKAGING" variant="outline">
            <Package /> Cadastrar embalagem
          </LinkButton>
          <LinkButton to="/estoque/saldo-inicial" variant="outline">
            <Boxes /> Lançar saldo inicial
          </LinkButton>
        </div>
        <BackHint />
      </div>
      <StepFooter nav={nav}>{nav.status === 'done' ? <ContinueButton nav={nav} /> : null}</StepFooter>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 7. Compras já feitas (anteriores ao sistema)
// -----------------------------------------------------------------------------

export function StepPurchases({ nav, snapshot }: GuideProps) {
  const { settings } = useMember();
  const funding = settings.default_owner_funding_type === 'OWNER_LOAN' ? 'empréstimo do dono' : 'aporte do dono';
  const unlinkedPrinters = snapshot.printers.filter((p) => p.purchase_line_id === null);
  return (
    <div>
      <div className="space-y-4 p-4">
        <Explain>
          Compras feitas <strong>antes do início do uso</strong>
          {settings.go_live_date ? ` (${formatDateBR(settings.go_live_date)})` : ''} que ainda estão sendo pagas — como as duas no cartão pessoal do dono:{' '}
          <strong className="num">{formatBRL(5646.19)} em 18x</strong> e <strong className="num">{formatBRL(2863.11)} em 12x</strong>. Lançá-las coloca no sistema o que foi
          comprado (impressora, filamentos) e as parcelas que faltam.
        </Explain>
        <ol className="space-y-2.5 text-sm text-ink-soft">
          {[
            <>
              Em <strong className="text-ink">Compras → Nova compra</strong>, marque <strong className="text-ink">Compra anterior ao sistema</strong> e use a data real da compra.
            </>,
            <>
              Pagamento <strong className="text-ink">crédito parcelado</strong> no cartão pessoal do dono, com o número de parcelas (18 ou 12) e o{' '}
              <strong className="text-ink">total das parcelas</strong>. Sem o valor à vista, marque que os juros são desconhecidos.
            </>,
            <>
              Ao confirmar, informe <strong className="text-ink">quantas parcelas já foram pagas</strong>: elas viram {funding} e não mexem no caixa da empresa. As que faltam ficam
              em contas a pagar.
            </>,
            <>
              Ao receber, informe o que <strong className="text-ink">ainda resta</strong> de cada filamento. A impressora vira equipamento com o valor pago.
            </>,
          ].map((text, index) => (
            <li key={index} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-ink">{index + 1}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
        {unlinkedPrinters.length > 0 ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {unlinkedPrinters.map((p) => `“${p.name}”`).join(', ')} foi cadastrada sem compra. Se ela está numa destas compras, o recebimento cria outro cadastro com o valor
              pago; depois, marque o cadastro antigo como baixado em Produção → Equipamentos.
            </span>
          </p>
        ) : null}
        {snapshot.openingPurchases.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Compras anteriores lançadas">
            {snapshot.openingPurchases.map((p) => (
              <li key={p.id}>
                <Link to={`/compras/${p.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2.5 text-sm hover:bg-subtle">
                  <ShoppingCart className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">
                      {p.number} · {formatDateBR(p.purchased_at)}
                    </span>
                    <span className="num block text-xs text-muted">
                      {formatBRL(p.installments_total ?? p.cash_price_total)} em {p.installments_count}x · {p.payer === 'DONO' ? 'pago pelo dono' : 'pago pela empresa'}
                    </span>
                  </span>
                  <Badge tone={p.status === 'RASCUNHO' ? 'warning' : p.status === 'RECEBIDA' ? 'success' : 'info'}>
                    {p.status === 'RASCUNHO' ? 'rascunho' : p.status === 'RECEBIDA' ? 'recebida' : p.status === 'RECEBIDA_PARCIAL' ? 'recebida em parte' : 'a receber'}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <LinkButton to="/compras/nova">
            <Plus /> Lançar compra já feita
          </LinkButton>
          <LinkButton to="/compras" variant="outline">
            <ShoppingCart /> Ver compras
          </LinkButton>
        </div>
      </div>
      <StepFooter nav={nav}>{nav.status === 'done' ? <ContinueButton nav={nav} /> : null}</StepFooter>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 8. Canais de venda
// -----------------------------------------------------------------------------

export function StepChannels({ nav }: { nav: StepNav }) {
  const { today, settings } = useMember();
  const channels = useSalesChannelsWithFees(today());
  const [editing, setEditing] = useState<ChannelWithFees | null>(null);
  const rows = [...(channels.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'));
  return (
    <div>
      <div className="space-y-4 p-4">
        <Explain>
          Confira onde a Wabee vende e as <strong>taxas de cada canal</strong> (comissão, taxa fixa, taxa de pagamento) e o <strong>prazo para receber</strong>. Elas entram no preço
          sugerido e na margem de cada venda. Ative os marketplaces que você usa (Shopee, Mercado Livre) e desative os que não usa.
        </Explain>
        {channels.isError ? (
          <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
        ) : !channels.data ? (
          <LoadingBlock rows={3} />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Canais de venda">
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setEditing(c)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-subtle">
                  <Store className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                      {c.name}
                      {c.id === settings.default_channel_id ? <Badge tone="accent">padrão</Badge> : null}
                      {c.active ? null : <Badge>inativo</Badge>}
                    </span>
                    <span className="num block text-xs text-muted">
                      {CHANNEL_KIND_LABELS[c.kind] !== c.name ? `${CHANNEL_KIND_LABELS[c.kind]} · ` : ''}
                      {describeFee(c.current)} · recebe {payoutLabel(c.payout_days)}
                    </span>
                  </span>
                  <Pencil className="size-4 shrink-0 text-muted" aria-label="Editar" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          Toque num canal para editar. Também em <Link to="/configuracoes/canais" className="underline">Configurações → Canais e taxas</Link>.
        </p>
      </div>
      <StepFooter nav={nav}>
        <Button onClick={nav.complete} loading={nav.busy}>
          {nav.status === 'done' ? 'Continuar' : 'Revisei os canais'} <ArrowRight />
        </Button>
      </StepFooter>
      <ChannelDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} channel={editing} isDefault={editing?.id === settings.default_channel_id} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Resumo e conclusão
// -----------------------------------------------------------------------------

export function StepSummary({
  nav,
  statuses,
  onOpen,
  alreadyDone,
}: {
  nav: StepNav;
  statuses: Record<StepKey, StepStatus>;
  onOpen: (key: StepKey) => void;
  alreadyDone: boolean;
}) {
  const pending = ONBOARDING_STEPS.filter((s) => statuses[s.key] !== 'done').length;
  return (
    <div>
      <div className="space-y-4 p-4">
        {alreadyDone ? (
          <DoneNote>
            Configuração concluída.
            {pending > 0 ? ` ${pending === 1 ? 'O passo pendente aparece' : `Os ${pending} passos pendentes aparecem`} na Visão geral até serem feitos.` : ''}
          </DoneNote>
        ) : (
          <Explain>
            {pending === 0
              ? 'Tudo pronto! Confira o resumo e conclua para começar a usar a Wabee no dia a dia.'
              : `${pending === 1 ? 'Falta 1 passo' : `Faltam ${pending} passos`}. Dá para concluir assim mesmo: os pendentes ficam listados na Visão geral.`}
          </Explain>
        )}
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {ONBOARDING_STEPS.map((step, index) => {
            const done = statuses[step.key] === 'done';
            return (
              <li key={step.key}>
                <button type="button" onClick={() => onOpen(step.key)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-subtle">
                  {done ? <CircleCheck className="size-5 shrink-0 text-success" aria-hidden /> : <CircleDashed className="size-5 shrink-0 text-warning" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">
                      {index + 1}. {step.title}
                    </span>
                    <span className="block text-xs text-muted">{step.short}</span>
                  </span>
                  <Badge tone={done ? 'success' : 'warning'}>{done ? 'feito' : 'pendente'}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="rounded-xl border border-line p-3 text-sm">
          <p className="mb-1 font-semibold">Próximos passos</p>
          <ul className="text-ink-soft">
            {[
              { to: '/produtos/novo', label: 'Cadastrar os produtos e montar as fichas técnicas' },
              { to: '/producao/impressoes/nova', label: 'Planejar a primeira impressão' },
              { to: '/vendas/rapida', label: 'Registrar uma venda' },
            ].map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="inline-flex min-h-10 items-center gap-1.5 underline-offset-4 hover:underline">
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden /> {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <StepFooter nav={{ ...nav, status: 'done' }}>
        {alreadyDone ? (
          <Button asChild>
            <Link to="/">
              Ir para a visão geral <ArrowRight />
            </Link>
          </Button>
        ) : (
          <Button variant="accent" onClick={nav.complete} loading={nav.busy}>
            <PartyPopper /> Concluir configuração
          </Button>
        )}
      </StepFooter>
    </div>
  );
}
