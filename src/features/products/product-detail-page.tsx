import { ArrowLeft, Copy, FilePlus2, GitCompare, Pencil, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ColorDot, Qty } from '@/components/shared/item-bits';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  BOM_STATUS_LABELS,
  CATEGORY_LABELS,
  CONSUMED_AT_LABELS,
  LINE_KIND_LABELS,
  MODEL_SOURCE_LABELS,
  useBomEstimate,
  useBomLines,
  useBomVersions,
  useCopyBom,
  useProduct,
  useVariants,
  type VariantRow,
} from '@/data/products';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import { formatCost, formatMinutes, formatNumber, formatPercent, formatQty, toNumber } from '@/lib/money';
import { CostBreakdown, Info, ProductInitials } from './bits';
import { CompareBomDialog } from './compare-bom-dialog';
import { CopyBomDialog } from './copy-bom-dialog';
import { ChannelPricingCard } from './pricing';

export function ProductDetailPage() {
  const { id } = useParams();
  const productId = Number(id);
  const { can } = useMember();
  const [params, setParams] = useSearchParams();
  const product = useProduct(productId);
  const variants = useVariants({ productId });

  if (product.isError || variants.isError) return <Page><ErrorState error={product.error ?? variants.error} onRetry={() => void product.refetch()} /></Page>;
  if (!product.data || !variants.data) {
    if (product.data === null) return <Page><EmptyState title="Produto não encontrado" action={<Button asChild variant="outline"><Link to="/produtos">Voltar aos produtos</Link></Button>} /></Page>;
    return <Page><LoadingBlock /></Page>;
  }
  const p = product.data;
  const list = variants.data;
  const selectedId = Number(params.get('variacao')) || list.find((v) => v.active)?.id || list[0]?.id;
  const variant = list.find((v) => v.id === selectedId) ?? list[0];

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/produtos" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Produtos
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-3">
            <ProductInitials name={p.name} />
            {p.name}
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge>{CATEGORY_LABELS[p.category]}</Badge>
            <span>{MODEL_SOURCE_LABELS[p.model_source]}</span>
            {!p.active ? <Badge tone="danger">inativo</Badge> : null}
            {p.model_source !== 'PROPRIO' && p.license_allows_commercial !== true ? <Badge tone="warning">licença sem uso comercial confirmado</Badge> : null}
          </span>
        }
        actions={
          can('write') ? (
            <Button asChild variant="outline">
              <Link to={`/produtos/${p.id}/editar`}>
                <Pencil /> Editar produto
              </Link>
            </Button>
          ) : undefined
        }
      />

      {list.length > 1 ? (
        <div role="tablist" aria-label="Variações" className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {list.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === variant?.id}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('variacao', String(v.id));
                setParams(next, { replace: true });
              }}
              className={cn(
                'inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors',
                v.id === variant?.id ? 'border-ink bg-ink text-brand-fg' : 'border-line-strong bg-panel text-ink-soft hover:bg-subtle',
                !v.active && 'opacity-60',
              )}
            >
              {v.name}
              <span className={cn('num text-xs', v.id === variant?.id ? 'text-brand-fg/70' : 'text-muted')}>{formatNumber(v.qty_available, 0)} un</span>
            </button>
          ))}
        </div>
      ) : null}

      {variant ? <VariantPanel key={variant.id} variant={variant} siblings={list} /> : <EmptyState title="Sem variações" description="Edite o produto e cadastre ao menos uma variação." />}
    </Page>
  );
}

function VariantPanel({ variant, siblings }: { variant: VariantRow; siblings: VariantRow[] }) {
  const { can } = useMember();
  const showCosts = can('costs');
  const hasStock = toNumber(variant.qty_on_hand) > 0 && toNumber(variant.avg_cost_total) > 0;
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Livre para venda"
          value={variant.qty_available}
          format={(v) => formatQty(v, 'UN')}
          hint={toNumber(variant.qty_reserved) > 0 ? `${formatQty(variant.qty_on_hand, 'UN')} em estoque, ${formatQty(variant.qty_reserved, 'UN')} reservada(s)` : `${variant.sku}`}
        />
        <Stat label="No acabamento" value={variant.qty_in_finishing} format={(v) => formatQty(v, 'UN')} hint="Impressas, aguardando liberação" />
        {showCosts ? (
          <>
            <Stat
              label="Custo médio em estoque"
              value={hasStock ? variant.avg_cost_total : null}
              format={(v) => formatCost(v, 4)}
              estimated={hasStock}
              estimatedHint="Inclui energia/depreciação estimadas"
              hint={hasStock ? undefined : 'Sem estoque: veja o custo estimado pela ficha'}
            />
            <Stat label="Preço de referência" value={variant.reference_price} hint="Usado quando o canal não tem preço próprio" />
          </>
        ) : null}
      </div>
      <Tabs defaultValue="bom">
        <TabsList>
          <TabsTrigger value="bom">Ficha técnica</TabsTrigger>
          {showCosts ? <TabsTrigger value="prices">Preços por canal</TabsTrigger> : null}
          <TabsTrigger value="versions">Versões da ficha</TabsTrigger>
        </TabsList>
        <TabsContent value="bom">
          <ActiveBom variant={variant} siblings={siblings} />
        </TabsContent>
        {showCosts ? (
          <TabsContent value="prices">
            <ChannelPricingCard variant={variant} />
          </TabsContent>
        ) : null}
        <TabsContent value="versions">
          <BomVersions variant={variant} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ActiveBom({ variant, siblings }: { variant: VariantRow; siblings: VariantRow[] }) {
  const { can } = useMember();
  const navigate = useNavigate();
  const versions = useBomVersions(variant.id);
  const bomId = variant.active_bom_id;
  const lines = useBomLines(bomId);
  const estimate = useBomEstimate(bomId, can('costs'));
  const [copying, setCopying] = useState(false);
  const newVersion = useCopyBom((id) => navigate(`/produtos/${variant.product_id}/fichas/${id}`));
  const active = versions.data?.find((b) => b.id === bomId);
  const editorHref = (id: number) => `/produtos/${variant.product_id}/fichas/${id}`;
  const sources = siblings.filter((s) => s.id !== variant.id && s.active_bom_id);

  const draftAction = can('write') ? (
    variant.draft_bom_id ? (
      <Button asChild>
        <Link to={editorHref(variant.draft_bom_id)}>
          <Pencil /> Continuar rascunho
        </Link>
      </Button>
    ) : bomId ? (
      <Button loading={newVersion.isPending} onClick={() => newVersion.mutate({ bomId })}>
        <Pencil /> Editar (nova versão)
      </Button>
    ) : null
  ) : null;

  if (!bomId) {
    return (
      <>
        <EmptyState
          icon={<FilePlus2 />}
          title={variant.draft_bom_id ? 'Ficha em rascunho' : 'Sem ficha técnica'}
          description="A ficha diz quanto filamento, quanto tempo de impressora e quais componentes cada unidade usa. Com ela o sistema estima o custo e já sugere gramas e tempo ao planejar a impressão."
          action={
            can('write') ? (
              <div className="flex flex-wrap justify-center gap-2">
                {variant.draft_bom_id ? (
                  draftAction
                ) : (
                  <>
                    <Button asChild>
                      <Link to={`/produtos/${variant.product_id}/fichas/nova?variacao=${variant.id}`}>
                        <FilePlus2 /> Montar ficha
                      </Link>
                    </Button>
                    {sources.length > 0 ? (
                      <Button variant="outline" onClick={() => setCopying(true)}>
                        <Copy /> Copiar de outra cor
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            ) : undefined
          }
        />
        {copying ? <CopyBomDialog target={variant} sources={sources} onOpenChange={setCopying} /> : null}
      </>
    );
  }

  return (
    <div className={cn('grid grid-cols-1 items-start gap-4', can('costs') && 'lg:grid-cols-[1fr_22rem]')}>
      <Card>
        <CardHeader
          title={`Versão ${variant.active_bom_version} (ativa)`}
          description={active?.activated_at ? `Ativada em ${formatDateBR(active.activated_at.slice(0, 10))}` : undefined}
          actions={draftAction}
        />
        {variant.draft_bom_id ? <p className="border-b border-line bg-accent-soft px-4 py-2 text-xs text-accent-ink">Há uma nova versão em rascunho. Esta continua valendo até você ativar a outra.</p> : null}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-4">
          <Info label="Peças por mesa" value={variant.units_per_plate ?? '—'} />
          <Info label="Tempo por mesa" value={formatMinutes(variant.est_print_minutes_per_plate)} />
          <Info label="Acabamento por peça" value={toNumber(variant.est_post_process_minutes_per_unit) > 0 ? formatMinutes(variant.est_post_process_minutes_per_unit) : 'sem acabamento'} />
          <Info
            label="Impressora padrão"
            value={
              active?.default_equipment_name ? (
                <span className="inline-flex items-center gap-1">
                  <Printer className="size-3.5 text-muted" /> {active.default_equipment_name}
                </span>
              ) : (
                'qualquer'
              )
            }
          />
        </dl>
        {lines.isError ? (
          <ErrorState className="m-4" error={lines.error} />
        ) : !lines.data ? (
          <div className="p-4">
            <LoadingBlock rows={2} />
          </div>
        ) : (
          <BomLinesTable lines={lines.data} unitsPerPlate={variant.units_per_plate ?? 1} />
        )}
        {active?.notes ? <p className="border-t border-line px-4 py-3 text-sm text-ink-soft">{active.notes}</p> : null}
      </Card>
      {can('costs') ? (
        <Card className="h-fit">
          <CardHeader title="Custo estimado por unidade" />
          <div className="p-4">{estimate.isError ? <ErrorState error={estimate.error} /> : <CostBreakdown estimate={estimate.data} loading={estimate.isFetching} unitsPerPlate={variant.units_per_plate} />}</div>
        </Card>
      ) : null}
    </div>
  );
}

export function BomLinesTable({ lines, unitsPerPlate }: { lines: Array<{ id: number; item_id: number; item_name: string; sku: string; unit: string; color_hex: string | null; line_kind: keyof typeof LINE_KIND_LABELS; qty_per_unit: number; waste_pct: number; consumed_at: keyof typeof CONSUMED_AT_LABELS }>; unitsPerPlate: number }) {
  if (lines.length === 0) return <p className="px-4 pb-4 text-sm text-muted">Nenhuma linha.</p>;
  return (
    <div className="overflow-x-auto border-t border-line">
      <table className="w-full text-sm">
        <thead className="bg-subtle text-xs text-muted">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Item</th>
            <th className="px-3 py-2 text-right font-medium">Por unidade</th>
            <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Por mesa</th>
            <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Perda</th>
            <th className="hidden px-4 py-2 text-left font-medium md:table-cell">Quando sai</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <ColorDot hex={l.color_hex} />
                  <span>
                    <Link to={`/estoque/itens/${l.item_id}`} className="font-medium hover:underline">
                      {l.item_name}
                    </Link>
                    <span className="block text-xs text-muted">{LINE_KIND_LABELS[l.line_kind]}</span>
                  </span>
                </span>
              </td>
              <td className="num px-3 py-2.5 text-right">
                <Qty value={l.qty_per_unit} unit={l.unit} />
              </td>
              <td className="num hidden px-3 py-2.5 text-right text-muted sm:table-cell">{l.line_kind.startsWith('FILAMENT') ? <Qty value={toNumber(l.qty_per_unit) * unitsPerPlate} unit={l.unit} /> : '—'}</td>
              <td className="num hidden px-3 py-2.5 text-right text-muted sm:table-cell">{toNumber(l.waste_pct) > 0 ? formatPercent(l.waste_pct) : '—'}</td>
              <td className="hidden px-4 py-2.5 text-muted md:table-cell">{CONSUMED_AT_LABELS[l.consumed_at]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BomVersions({ variant }: { variant: VariantRow }) {
  const versions = useBomVersions(variant.id);
  const { can } = useMember();
  const [selected, setSelected] = useState<number[]>([]);
  const [comparing, setComparing] = useState(false);
  if (versions.isError) return <ErrorState error={versions.error} />;
  if (!versions.data) return <LoadingBlock rows={2} />;
  if (versions.data.length === 0) return <EmptyState title="Nenhuma versão" description="Cada alteração na ficha ativa cria uma nova versão; as anteriores ficam guardadas e as impressões antigas continuam com o custo da época." />;
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  const pair = versions.data.filter((b) => selected.includes(b.id)).sort((x, y) => x.version - y.version);
  return (
    <div className="space-y-3">
      {versions.data.length > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">Marque duas versões para comparar.</p>
          <Button size="sm" variant="outline" disabled={pair.length !== 2} onClick={() => setComparing(true)}>
            <GitCompare /> Comparar
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
        {versions.data.map((b) => (
          <li key={b.id} className="flex items-center gap-1 pl-3 hover:bg-subtle">
            {versions.data.length > 1 ? <Checkbox aria-label={`Comparar versão ${b.version}`} className="size-5" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} /> : null}
            <Link to={`/produtos/${variant.product_id}/fichas/${b.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-3 text-sm">
              <span className="w-20 font-semibold">Versão {b.version}</span>
              <Badge tone={b.status === 'ATIVA' ? 'success' : b.status === 'RASCUNHO' ? 'accent' : 'neutral'}>{BOM_STATUS_LABELS[b.status]}</Badge>
              <span className="min-w-0 flex-1 text-muted">
                {b.units_per_plate} por mesa · {formatMinutes(b.est_print_minutes_per_plate)} · {formatQty(b.grams_per_unit, 'G')} por unidade
              </span>
              <span className="text-xs text-muted">{b.activated_at ? `ativada ${formatDateBR(b.activated_at.slice(0, 10))}` : `criada ${formatDateBR(b.created_at.slice(0, 10))}`}</span>
              {can('write') && b.status === 'RASCUNHO' ? <span className="text-xs font-medium text-accent-ink">continuar editando →</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {comparing && pair.length === 2 ? <CompareBomDialog a={pair[0]!} b={pair[1]!} onOpenChange={setComparing} /> : null}
    </div>
  );
}

