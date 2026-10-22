import { ArrowRight, Boxes, CircleCheck, CircleDashed, ExternalLink, Package, PartyPopper, Plus, ShoppingCart, SkipForward, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { OnboardingSnapshot } from '@/data/settings';
import { useMember } from '@/features/member/member-context';
import { formatDateBR } from '@/lib/dates';
import { formatBRL, formatCost, toNumber } from '@/lib/money';
import { STEPS, type StepKey, type StepStatus } from './onboarding-logic';
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

// -----------------------------------------------------------------------------
// 4. Filamentos e itens
// -----------------------------------------------------------------------------

export function StepItems({ nav, snapshot }: GuideProps) {
  const c = snapshot.itemCounts;
  return (
    <div>
      <div className="space-y-4 p-4">
        <Explain>
          Cadastre o que você usa para produzir: cada <strong>filamento</strong> (material, cor e marca), os <strong>componentes</strong> (argolas, ímãs, chaveiros) e as{' '}
          <strong>embalagens</strong>. Por enquanto só o cadastro, sem quantidades: o saldo entra pelas compras anteriores (passo 6) ou pelo saldo inicial (passo 7).
        </Explain>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <CountTile label="Filamentos" value={c.FILAMENT ?? 0} to="/estoque?tipo=FILAMENT" />
          <CountTile label="Componentes" value={c.COMPONENT ?? 0} to="/estoque?tipo=COMPONENT" />
          <CountTile label="Embalagens" value={c.PACKAGING ?? 0} to="/estoque?tipo=PACKAGING" />
          <CountTile label="Consumíveis" value={c.CONSUMABLE ?? 0} to="/estoque?tipo=CONSUMABLE" />
          <CountTile label="Ferramentas" value={c.TOOL ?? 0} to="/estoque?tipo=TOOL" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <LinkButton to="/estoque/itens/novo?tipo=FILAMENT">
            <Plus /> Cadastrar filamento
          </LinkButton>
          <LinkButton to="/estoque/itens/novo?tipo=COMPONENT" variant="outline">
            <Plus /> Componente
          </LinkButton>
          <LinkButton to="/estoque/itens/novo?tipo=PACKAGING" variant="outline">
            <Plus /> Embalagem
          </LinkButton>
          <LinkButton to="/estoque" variant="outline">
            <Boxes /> Ver estoque
          </LinkButton>
        </div>
        <p className="text-xs text-muted">Ao terminar cada cadastro, volte aqui pelo menu Configurações → Assistente inicial (o progresso fica salvo).</p>
      </div>
      <StepFooter nav={nav} skipLabel="Pular por agora">
        {nav.status === 'done' ? <ContinueButton nav={nav} /> : null}
      </StepFooter>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 5. Produtos e fichas
// -----------------------------------------------------------------------------

export function StepProducts({ nav, snapshot }: GuideProps) {
  const withoutBom = snapshot.variants - snapshot.variantsWithBom;
  return (
    <div>
      <div className="space-y-4 p-4">
        <Explain>
          Cadastre o que a Wabee vende (ex.: Chaveiro Abelha) com as <strong>variações</strong> de cor. Depois monte a <strong>ficha técnica</strong> de cada variação: gramas por
          peça, peças por mesa e tempo de impressão, componentes e embalagem. É com ela que o sistema calcula o custo e sugere o preço.
        </Explain>
        <div className="grid grid-cols-3 gap-2">
          <CountTile label="Produtos" value={snapshot.products} to="/produtos" />
          <CountTile label="Variações" value={snapshot.variants} />
          <CountTile label="Com ficha ativa" value={snapshot.variantsWithBom} />
        </div>
        {withoutBom > 0 ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {withoutBom === 1 ? '1 variação ainda está' : `${withoutBom} variações ainda estão`} sem ficha técnica ativa.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <LinkButton to="/produtos/novo">
            <Plus /> Novo produto
          </LinkButton>
          <LinkButton to="/produtos" variant="outline">
            <Package /> Ver produtos
          </LinkButton>
        </div>
      </div>
      <StepFooter nav={nav} skipLabel="Pular por agora">
        {nav.status === 'done' ? <ContinueButton nav={nav} /> : null}
      </StepFooter>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 6. Compras anteriores ao sistema
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
                <Link to={`/compras/${p.id}`} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-subtle">
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
            <Plus /> Lançar compra anterior
          </LinkButton>
          <LinkButton to="/compras" variant="outline">
            <ShoppingCart /> Ver compras
          </LinkButton>
        </div>
      </div>
      <StepFooter nav={nav} skipLabel="Pular por agora">
        {nav.status === 'done' ? <ContinueButton nav={nav} /> : null}
      </StepFooter>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 7. Saldo inicial do estoque
// -----------------------------------------------------------------------------

export function StepOpening({ nav, snapshot }: GuideProps) {
  const { settings } = useMember();
  return (
    <div>
      <div className="space-y-4 p-4">
        <Explain>
          Registre o que <strong>já existia</strong> no início do uso e <strong>não</strong> entrou por uma compra do passo 6: sobras de filamento (pese o carretel), componentes,
          embalagens e produtos prontos. Filamento sem custo conhecido usa a referência de{' '}
          <strong className="num">{formatCost(toNumber(settings.filament_reference_cost_g), 4)}/g</strong> (Empresa e regras), marcada como estimada.
        </Explain>
        <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
          <CountTile label="Lançamentos de saldo inicial" value={snapshot.openingMovements} />
          <CountTile label="Compras anteriores" value={snapshot.openingPurchases.length} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <LinkButton to="/estoque/saldo-inicial">
            <Plus /> Lançar saldo inicial
          </LinkButton>
          <LinkButton to="/estoque" variant="outline">
            <Boxes /> Ver estoque
          </LinkButton>
        </div>
      </div>
      <StepFooter nav={nav} skipLabel="Pular por agora">
        {nav.status === 'done' ? <ContinueButton nav={nav} /> : null}
      </StepFooter>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 8. Concluir
// -----------------------------------------------------------------------------

const STATUS_TEXT: Record<StepStatus, string> = { done: 'feito', skipped: 'pulado', pending: 'pendente' };

export function StepFinish({ nav, statuses, onOpen, alreadyDone }: { nav: StepNav; statuses: Record<StepKey, StepStatus>; onOpen: (key: StepKey) => void; alreadyDone: boolean }) {
  const steps = STEPS.filter((s) => s.key !== 'concluir');
  const pending = steps.filter((s) => statuses[s.key] !== 'done').length;
  return (
    <div>
      <div className="space-y-4 p-4">
        {alreadyDone ? (
          <DoneNote>Configuração concluída. Você pode voltar a qualquer passo quando quiser.</DoneNote>
        ) : (
          <Explain>
            {pending === 0
              ? 'Tudo pronto! Confira o resumo e conclua para começar a usar a Wabee no dia a dia.'
              : `${pending === 1 ? 'Falta 1 passo' : `Faltam ${pending} passos`}. Dá para concluir assim mesmo e voltar depois em Configurações → Assistente inicial.`}
          </Explain>
        )}
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {steps.map((step, index) => {
            const status = statuses[step.key];
            return (
              <li key={step.key}>
                <button type="button" onClick={() => onOpen(step.key)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-subtle">
                  {status === 'done' ? (
                    <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
                  ) : status === 'skipped' ? (
                    <SkipForward className="size-5 shrink-0 text-warning" aria-hidden />
                  ) : (
                    <CircleDashed className="size-5 shrink-0 text-muted" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">
                      {index + 1}. {step.title}
                    </span>
                    <span className="block text-xs text-muted">{step.short}</span>
                  </span>
                  <Badge tone={status === 'done' ? 'success' : status === 'skipped' ? 'warning' : 'neutral'}>{STATUS_TEXT[status]}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="rounded-xl border border-line p-3 text-sm">
          <p className="mb-2 font-semibold">Próximos passos</p>
          <ul className="space-y-1.5 text-ink-soft">
            <li>
              <Link to="/configuracoes/canais" className="inline-flex min-h-8 items-center gap-1.5 underline-offset-4 hover:underline">
                <ExternalLink className="size-3.5" aria-hidden /> Revisar canais e taxas (Shopee, Mercado Livre, feiras)
              </Link>
            </li>
            <li>
              <Link to="/producao/impressoes/nova" className="inline-flex min-h-8 items-center gap-1.5 underline-offset-4 hover:underline">
                <ExternalLink className="size-3.5" aria-hidden /> Planejar a primeira impressão
              </Link>
            </li>
            <li>
              <Link to="/vendas/rapida" className="inline-flex min-h-8 items-center gap-1.5 underline-offset-4 hover:underline">
                <ExternalLink className="size-3.5" aria-hidden /> Registrar uma venda
              </Link>
            </li>
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
