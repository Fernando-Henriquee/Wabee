import {
  Building2,
  ChevronRight,
  CircleCheck,
  CreditCard,
  FolderTree,
  History,
  type LucideIcon,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/states';
import { RESET_CONFIRM_PHRASE, TAX_REGIME_LABELS, useResetSystem, useStockIntegrity } from '@/data/settings';
import { type Capability, ROLE_LABELS, useMember } from '@/features/member/member-context';
import { formatDateBR } from '@/lib/dates';

interface HubLink {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Sem capacidade: todos os perfis veem. */
  capability?: Capability;
}

interface HubGroup {
  title: string;
  links: HubLink[];
}

const GROUPS: HubGroup[] = [
  {
    title: 'Empresa',
    links: [
      { to: '/configuracoes/empresa', title: 'Empresa e regras', description: 'Nome, início do uso, impostos, margem alvo e regras de estoque', icon: Building2, capability: 'settings' },
      { to: '/configuracoes/canais', title: 'Canais e taxas', description: 'Onde você vende, taxas de cada canal e prazo para receber', icon: Store, capability: 'settings' },
      { to: '/financeiro/contas', title: 'Contas e cartões', description: 'Pix, dinheiro e cartões da empresa e do dono', icon: CreditCard, capability: 'settings' },
      { to: '/financeiro/categorias', title: 'Categorias financeiras', description: 'Plano de contas usado nas despesas e no resultado', icon: FolderTree, capability: 'settings' },
    ],
  },
  {
    title: 'Acesso e segurança',
    links: [
      { to: '/configuracoes/pessoas', title: 'Pessoas com acesso', description: 'Quem entra no sistema e com qual perfil', icon: Users, capability: 'settings' },
      { to: '/auditoria', title: 'Auditoria', description: 'Quem fez o quê e quando, com antes e depois', icon: History, capability: 'audit' },
      { to: '/perfil', title: 'Meu perfil', description: 'Seu nome, senha e sessões abertas', icon: UserRound },
    ],
  },
  {
    title: 'Aplicativo',
    links: [
      { to: '/configuracoes/aplicativo', title: 'Aplicativo', description: 'Instalar no celular, versão, atualização e dados salvos no aparelho', icon: Smartphone },
      { to: '/inicio/assistente', title: 'Assistente inicial', description: 'Passo a passo para colocar a Wabee para funcionar', icon: Sparkles, capability: 'settings' },
    ],
  },
];

function HubCard({ link, badge }: { link: HubLink; badge?: string }) {
  const Icon = link.icon;
  return (
    <Link
      to={link.to}
      className="group flex h-full min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-panel p-3.5 shadow-[var(--shadow-card)] transition-colors hover:border-ink active:bg-subtle"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          {link.title}
          {badge ? <Badge tone="accent">{badge}</Badge> : null}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted">{link.description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/** Conferência do razão de estoque contra os saldos guardados (rebuild_balances) e das reservas. */
function IntegrityCard() {
  const [requested, setRequested] = useState(false);
  const check = useStockIntegrity(requested);
  const result = check.data;
  const problems = result ? result.ledger.length + result.reservations.length : 0;
  return (
    <Card>
      <CardHeader
        title="Integridade dos dados"
        description="Refaz o estoque a partir de todas as movimentações e compara com os saldos e custos médios guardados."
        actions={
          <Button variant="outline" size="sm" loading={check.isFetching} onClick={() => (requested ? void check.refetch() : setRequested(true))}>
            <ShieldCheck /> {result ? 'Conferir de novo' : 'Conferir agora'}
          </Button>
        }
      />
      <div className="p-4 text-sm">
        {check.isError ? (
          <ErrorState error={check.error} onRetry={() => void check.refetch()} />
        ) : !result ? (
          <p className="text-muted">{check.isFetching ? 'Conferindo… pode levar alguns segundos.' : 'Nenhuma conferência feita nesta sessão.'}</p>
        ) : result.ok ? (
          <p className="flex items-center gap-2 text-success">
            <CircleCheck className="size-5 shrink-0" aria-hidden /> Tudo certo: saldos, custos médios, carretéis e reservas batem com o histórico.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-medium text-warning">
              <TriangleAlert className="size-5 shrink-0" aria-hidden /> {problems === 1 ? '1 divergência encontrada' : `${problems} divergências encontradas`}
            </p>
            <ul className="space-y-1 text-xs text-ink-soft">
              {result.ledger.slice(0, 10).map((p, index) => (
                <li key={`l-${index}`}>
                  <Link to={`/estoque/itens/${p.item_id}`} className="font-medium underline-offset-2 hover:underline">
                    {p.sku}
                  </Link>{' '}
                  — {p.problem === 'saldo' ? 'saldo' : p.problem === 'custo_medio' ? 'custo médio' : p.problem}: guardado {p.cached ?? '—'}, pelo histórico {p.ledger ?? '—'}
                </li>
              ))}
              {result.reservations.slice(0, 10).map((p, index) => (
                <li key={`r-${index}`}>
                  <Link to={`/estoque/itens/${p.item_id}`} className="font-medium underline-offset-2 hover:underline">
                    Item {p.item_id}
                  </Link>{' '}
                  — reservado guardado {p.cached}, reservas ativas {p.reservations}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Os dados não foram alterados. Envie esta lista para o suporte técnico para corrigir os saldos guardados.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Zona de perigo: reset do sistema (somente o dono). */
function ResetCard() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const reset = useResetSystem(() => void navigate('/'));
  const change = (next: boolean) => {
    setOpen(next);
    if (!next) setPhrase('');
  };
  return (
    <Card className="border-danger/40">
      <CardHeader
        title="Zona de perigo"
        description="Começar do zero: apaga toda a operação e os produtos. Não dá para desfazer."
        actions={
          <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
            <RotateCcw /> Resetar sistema
          </Button>
        }
      />
      <ConfirmDialog
        open={open}
        onOpenChange={change}
        title="Resetar o sistema?"
        description="Faça um backup antes (npm run backup:db). Depois do reset não há como recuperar os dados apagados."
        confirmLabel="Apagar tudo"
        confirmDisabled={phrase.trim().toUpperCase() !== RESET_CONFIRM_PHRASE}
        onConfirm={() => reset.mutateAsync()}
      >
        <div className="space-y-3 text-sm">
          <p>
            <strong>Apaga:</strong> pedidos, entregas, recebimentos, pagamentos, compras, impressões, estoque e movimentações, caixa, resultado,
            fechamentos de mês, auditoria, produtos, fichas técnicas e itens (filamentos, componentes, embalagens).
          </p>
          <p>
            <strong>Mantém:</strong> configurações da empresa, pessoas com acesso, canais e taxas, taxas de custo, categorias financeiras,
            equipamentos, fornecedores, clientes e contas financeiras.
          </p>
          <Field label={`Digite ${RESET_CONFIRM_PHRASE} para confirmar`}>
            <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
          </Field>
        </div>
      </ConfirmDialog>
    </Card>
  );
}

export function SettingsHubPage() {
  const { can, role, settings } = useMember();
  const groups = GROUPS.map((group) => ({ ...group, links: group.links.filter((link) => !link.capability || can(link.capability)) })).filter(
    (group) => group.links.length > 0,
  );
  const onboardingPending = can('settings') && !settings.onboarding_state?.done;
  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Configurações"
        description={
          can('settings') ? (
            <>
              {settings.company_name} · {TAX_REGIME_LABELS[settings.tax_regime]} ·{' '}
              {settings.go_live_date ? `sistema em uso desde ${formatDateBR(settings.go_live_date)}` : 'data de início do uso não definida'}
            </>
          ) : (
            <>Seu perfil: {ROLE_LABELS[role]}. As regras da empresa são alteradas pelo dono.</>
          )
        }
      />
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.title} aria-labelledby={`grupo-${group.title}`}>
            <h2 id={`grupo-${group.title}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.title}
            </h2>
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {group.links.map((link) => (
                <li key={link.to}>
                  <HubCard link={link} badge={link.to === '/inicio/assistente' && onboardingPending ? 'pendente' : undefined} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {can('audit') ? <IntegrityCard /> : null}
        {can('settings') ? <ResetCard /> : null}
      </div>
    </Page>
  );
}
