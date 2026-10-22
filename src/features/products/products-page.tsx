import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Qty } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { CATEGORY_LABELS, type ProductCategory, useVariants, type VariantRow } from '@/data/products';
import { useMember } from '@/features/member/member-context';
import type { ExportColumn } from '@/lib/export';
import { formatMinutes, toNumber } from '@/lib/money';
import { ProductInitials, UnitCost } from './bits';

function BomBadge({ row }: { row: VariantRow }) {
  if (row.active_bom_id) return <Badge tone="success">ficha v{row.active_bom_version}</Badge>;
  if (row.draft_bom_id) return <Badge tone="accent">ficha em rascunho</Badge>;
  return <Badge tone="warning">sem ficha</Badge>;
}

export function ProductsPage() {
  const { can } = useMember();
  const showCosts = can('costs');
  const [params, setParams] = useSearchParams();
  const category = (params.get('categoria') as ProductCategory | null) ?? '';
  const showInactive = params.get('inativos') === '1';
  const variants = useVariants({ includeHidden: showInactive });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const rows = useMemo(
    () => (variants.data ?? []).filter((v) => (showInactive || (v.active && v.product_active)) && (!category || v.category === category)),
    [variants.data, showInactive, category],
  );

  const columns = useMemo<Column<VariantRow>[]>(() => {
    const cols: Column<VariantRow>[] = [
      {
        key: 'name',
        header: 'Produto',
        sortValue: (r) => r.full_name,
        cell: (r) => (
          <span className="inline-flex items-center gap-3">
            <ProductInitials name={r.product_name} className="size-9 text-xs" />
            <span>
              {r.product_name} <span className="text-muted">— {r.name}</span>
              <span className="block text-xs font-normal text-muted">
                {r.sku}
                {!r.active || !r.product_active ? ' · inativo' : ''}
                {r.is_hidden ? ' · personalizado' : ''}
              </span>
            </span>
          </span>
        ),
      },
      { key: 'category', header: 'Categoria', sortValue: (r) => r.category, cell: (r) => CATEGORY_LABELS[r.category] },
      { key: 'bom', header: 'Ficha técnica', cell: (r) => <BomBadge row={r} /> },
      {
        key: 'plate',
        header: 'Por mesa',
        align: 'right',
        cell: (r) => (r.active_bom_id ? `${r.units_per_plate} un · ${formatMinutes(r.est_print_minutes_per_plate)}` : '—'),
      },
      {
        key: 'free',
        header: 'Livre',
        align: 'right',
        sortValue: (r) => toNumber(r.qty_available),
        cell: (r) => (
          <span>
            <Qty value={r.qty_available} unit="UN" className="font-semibold" />
            {toNumber(r.qty_in_finishing) > 0 ? <span className="block text-xs text-muted">+{r.qty_in_finishing} no acabamento</span> : null}
          </span>
        ),
      },
    ];
    if (showCosts)
      cols.push(
        { key: 'cost', header: 'Custo médio', align: 'right', sortValue: (r) => toNumber(r.avg_cost_total), cell: (r) => <UnitCost value={r.avg_cost_total} estimated hint="Inclui energia/depreciação estimadas" /> },
        { key: 'price', header: 'Preço ref.', align: 'right', sortValue: (r) => toNumber(r.reference_price), cell: (r) => <Money value={r.reference_price} /> },
        {
          key: 'margin',
          header: 'Margem bruta',
          align: 'right',
          sortValue: (r) => toNumber(r.reference_price) - toNumber(r.avg_cost_total),
          cell: (r) =>
            r.reference_price !== null && r.avg_cost_total ? (
              <Money value={toNumber(r.reference_price) - toNumber(r.avg_cost_total)} signed estimated hint="Preço de referência − custo médio, antes de taxas e embalagem. A margem por canal está na ficha do produto." />
            ) : (
              <span className="text-muted">—</span>
            ),
        },
      );
    return cols;
  }, [showCosts]);

  const exportColumns: ExportColumn<VariantRow>[] = [
    { header: 'SKU', value: (r) => r.sku },
    { header: 'Produto', value: (r) => r.product_name },
    { header: 'Variação', value: (r) => r.name },
    { header: 'Categoria', value: (r) => CATEGORY_LABELS[r.category] },
    { header: 'Ficha ativa', value: (r) => (r.active_bom_version ? `v${r.active_bom_version}` : '') },
    { header: 'Peças por mesa', value: (r) => r.units_per_plate, kind: 'number' },
    { header: 'Minutos por mesa', value: (r) => r.est_print_minutes_per_plate, kind: 'number' },
    { header: 'Saldo', value: (r) => r.qty_on_hand, kind: 'number' },
    { header: 'Reservado', value: (r) => r.qty_reserved, kind: 'number' },
    { header: 'Livre', value: (r) => r.qty_available, kind: 'number' },
    ...(showCosts
      ? ([
          { header: 'Custo médio', value: (r) => r.avg_cost_total, kind: 'number' },
          { header: 'Preço de referência', value: (r) => r.reference_price, kind: 'money' },
        ] as ExportColumn<VariantRow>[])
      : []),
  ];

  const withoutBom = rows.filter((r) => !r.active_bom_id).length;

  return (
    <Page>
      <PageHeader
        title="Produtos"
        description="O que a Wabee vende. Cada variação (cor, tamanho) tem ficha técnica, estoque e preço próprios."
        actions={
          can('write') ? (
            <Button asChild>
              <Link to="/produtos/novo">
                <Plus /> Novo produto
              </Link>
            </Button>
          ) : undefined
        }
      />
      {withoutBom > 0 && can('write') ? (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {withoutBom === 1 ? '1 variação está' : `${withoutBom} variações estão`} sem ficha técnica ativa: sem ela não há custo estimado nem gramas e tempo sugeridos ao planejar a impressão.
        </p>
      ) : null}
      {variants.isError ? (
        <ErrorState error={variants.error} onRetry={() => void variants.refetch()} />
      ) : !variants.data ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => String(r.id)}
          searchText={(r) => `${r.full_name} ${r.sku}`}
          searchPlaceholder="Pesquisar por nome, cor ou SKU…"
          rowHref={(r) => `/produtos/${r.product_id}?variacao=${r.id}`}
          initialSort={{ key: 'name', direction: 'asc' }}
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <Select aria-label="Categoria" className="h-9 w-auto" value={category} onChange={(e) => setParam('categoria', e.target.value)}>
                <option value="">Todas as categorias</option>
                {(Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
              <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
                <Checkbox checked={showInactive} onChange={(e) => setParam('inativos', e.target.checked ? '1' : null)} /> Inativos e personalizados
              </label>
              <ExportMenu rows={rows} columns={exportColumns} fileName="produtos" />
            </div>
          }
          emptyTitle={variants.data.length === 0 ? 'Nenhum produto cadastrado' : 'Nada nesta seleção'}
          emptyDescription={variants.data.length === 0 ? 'Cadastre o primeiro produto (ex.: Chaveiro Abelha) com as variações de cor. Depois monte a ficha técnica de cada uma.' : undefined}
          emptyAction={
            variants.data.length === 0 && can('write') ? (
              <Button asChild>
                <Link to="/produtos/novo">
                  <Plus /> Novo produto
                </Link>
              </Button>
            ) : undefined
          }
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <ProductInitials name={r.product_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {r.product_name} <span className="text-muted">— {r.name}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {r.sku} <BomBadge row={r} />
                </p>
              </div>
              <div className="text-right">
                <Qty value={r.qty_available} unit="UN" className="block text-sm font-semibold" />
                {showCosts ? <Money value={r.reference_price} className="text-xs text-muted" /> : null}
              </div>
            </div>
          )}
        />
      )}
    </Page>
  );
}
