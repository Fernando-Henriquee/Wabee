import { AlertTriangle, ArrowDownToLine, PackagePlus, Plus, Scale } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { ColorDot, Qty } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type ItemKind, type ItemRow, KIND_TABS, MATERIAL_LABELS, TOOL_CONDITION_LABELS, useItems } from '@/data/inventory';
import { useMember } from '@/features/member/member-context';
import type { ExportColumn } from '@/lib/export';
import { sumMoney } from '@/lib/calc';
import { formatNumber, toNumber } from '@/lib/money';

function coverage(row: ItemRow) {
  if (row.coverage_days === null || row.coverage_days === undefined) return <span className="text-muted">—</span>;
  const days = toNumber(row.coverage_days);
  return <span className={days < 14 ? 'font-medium text-warning' : ''}>{formatNumber(days, 0)} dias</span>;
}

function useColumns(kind: ItemKind, showCosts: boolean): Column<ItemRow>[] {
  return useMemo(() => {
    const name: Column<ItemRow> = {
      key: 'name',
      header: kind === 'FILAMENT' ? 'Filamento' : kind === 'FINISHED_GOOD' ? 'Produto' : 'Item',
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.kind === 'FILAMENT' ? <ColorDot hex={r.color_hex} /> : null}
          <span>
            {r.name}
            <span className="block text-xs font-normal text-muted">{r.sku}</span>
          </span>
          {r.below_minimum ? <AlertTriangle className="size-3.5 text-warning" aria-label="Abaixo do mínimo" /> : null}
        </span>
      ),
    };
    const qty: Column<ItemRow> = { key: 'qty', header: 'Saldo', align: 'right', sortValue: (r) => toNumber(r.qty_on_hand), cell: (r) => <Qty value={r.qty_on_hand} unit={r.unit} /> };
    const value: Column<ItemRow> = { key: 'value', header: 'Valor em estoque', align: 'right', sortValue: (r) => toNumber(r.value_total), cell: (r) => <Money value={r.value_total} estimated={r.reference_cost} hint="Inclui carretéis com custo de referência (R$ 0,10/g)" /> };
    const cols: Column<ItemRow>[] = [name];
    if (kind === 'FILAMENT') {
      cols.push(
        { key: 'material', header: 'Material', sortValue: (r) => r.material, cell: (r) => (r.material ? MATERIAL_LABELS[r.material] : '—') },
        qty,
        { key: 'lots', header: 'Carretéis', align: 'center', cell: (r) => `${r.open_lots} aberto(s) · ${r.closed_lots} fechado(s)` },
      );
      if (showCosts) cols.push({ key: 'cost', header: 'Custo por kg', align: 'right', sortValue: (r) => toNumber(r.avg_cost_total), cell: (r) => <Money value={toNumber(r.avg_cost_total) * 1000} estimated={r.reference_cost} hint="Custo de referência" /> }, value);
      cols.push({ key: 'coverage', header: 'Cobertura', align: 'right', sortValue: (r) => r.coverage_days ?? 9999, cell: coverage });
    } else if (kind === 'FINISHED_GOOD') {
      cols.push(
        qty,
        { key: 'reserved', header: 'Reservado', align: 'right', cell: (r) => <Qty value={r.qty_reserved} unit={r.unit} /> },
        { key: 'free', header: 'Livre', align: 'right', sortValue: (r) => toNumber(r.qty_available), cell: (r) => <Qty value={r.qty_available} unit={r.unit} className="font-semibold" /> },
      );
      if (showCosts)
        cols.push(
          { key: 'cost', header: 'Custo médio', align: 'right', sortValue: (r) => toNumber(r.avg_cost_total), cell: (r) => <Money value={r.avg_cost_total} cost estimated hint="Inclui energia/depreciação estimadas" /> },
          { key: 'price', header: 'Preço ref.', align: 'right', cell: (r) => <Money value={r.reference_price} /> },
          {
            key: 'margin',
            header: 'Margem unit.',
            align: 'right',
            sortValue: (r) => toNumber(r.reference_price) - toNumber(r.avg_cost_total),
            cell: (r) => (r.reference_price === null ? '—' : <Money value={toNumber(r.reference_price) - toNumber(r.avg_cost_total)} signed estimated hint="Preço de referência − custo médio (sem taxas)" />),
          },
        );
    } else if (kind === 'TOOL') {
      cols.push(
        qty,
        { key: 'location', header: 'Local', cell: (r) => r.location ?? '—' },
        { key: 'condition', header: 'Condição', cell: (r) => (r.tool_condition ? <Badge tone={r.tool_condition === 'BOA' ? 'success' : r.tool_condition === 'DESGASTADA' ? 'warning' : 'danger'}>{TOOL_CONDITION_LABELS[r.tool_condition]}</Badge> : '—') },
      );
      if (showCosts) cols.push({ key: 'acq', header: 'Valor de aquisição', align: 'right', cell: (r) => <Money value={r.tool_acquisition_value} hint="Informativo: não entra no custo das peças" /> });
    } else {
      cols.push(qty, { key: 'min', header: 'Mínimo', align: 'right', cell: (r) => (toNumber(r.min_qty) > 0 ? <Qty value={r.min_qty} unit={r.unit} /> : '—') });
      if (showCosts) cols.push({ key: 'cost', header: 'Custo médio', align: 'right', sortValue: (r) => toNumber(r.avg_cost_total), cell: (r) => <Money value={r.avg_cost_total} cost /> }, value);
      cols.push({ key: 'coverage', header: 'Cobertura', align: 'right', sortValue: (r) => r.coverage_days ?? 9999, cell: coverage });
    }
    return cols;
  }, [kind, showCosts]);
}

export function StockPage() {
  const { can } = useMember();
  const showCosts = can('costs');
  const [params, setParams] = useSearchParams();
  const kind = (params.get('tipo') as ItemKind | null) ?? 'FILAMENT';
  const belowOnly = params.get('alerta') === '1';
  const items = useItems({ kind });
  const columns = useColumns(kind, showCosts);

  const rows = useMemo(() => {
    const list = items.data ?? [];
    if (!belowOnly) return list;
    // "Abaixo do mínimo" ordenado pelos menores dias de cobertura (US-1.4).
    return list.filter((r) => r.below_minimum).sort((a, b) => toNumber(a.coverage_days ?? 9999) - toNumber(b.coverage_days ?? 9999));
  }, [items.data, belowOnly]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const exportColumns: ExportColumn<ItemRow>[] = [
    { header: 'SKU', value: (r) => r.sku },
    { header: 'Nome', value: (r) => r.name },
    { header: 'Saldo', value: (r) => r.qty_on_hand, kind: 'number' },
    { header: 'Unidade', value: (r) => r.unit.toLowerCase() },
    { header: 'Reservado', value: (r) => r.qty_reserved, kind: 'number' },
    ...(showCosts
      ? ([
          { header: 'Custo médio', value: (r) => r.avg_cost_total, kind: 'number' },
          { header: 'Valor em estoque', value: (r) => r.value_total, kind: 'money' },
        ] as ExportColumn<ItemRow>[])
      : []),
    { header: 'Cobertura (dias)', value: (r) => r.coverage_days, kind: 'number' },
  ];

  const total = sumMoney(rows.map((r) => r.value_total));

  return (
    <Page>
      <PageHeader
        title="Estoque"
        description="Tudo que entra e sai: o saldo vem das movimentações."
        actions={
          can('write') ? (
            <>
              <Button asChild variant="outline">
                <Link to="/estoque/ajuste">
                  <Scale /> Ajuste ou saída
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/estoque/saldo-inicial">
                  <ArrowDownToLine /> Saldo inicial
                </Link>
              </Button>
              {kind !== 'FINISHED_GOOD' ? (
                <Button asChild>
                  <Link to={`/estoque/itens/novo?tipo=${kind}`}>
                    <Plus /> Novo item
                  </Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/produtos/novo">
                    <PackagePlus /> Novo produto
                  </Link>
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <Tabs value={kind} onValueChange={(value) => setParam('tipo', value)}>
        <TabsList className="mb-4">
          {KIND_TABS.map((tab) => (
            <TabsTrigger key={tab.kind} value={tab.kind}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {items.isError ? (
        <ErrorState error={items.error} onRetry={() => void items.refetch()} />
      ) : !items.data ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => String(r.id)}
          searchText={(r) => `${r.name} ${r.sku} ${r.color_name ?? ''} ${r.brand ?? ''}`}
          searchPlaceholder="Pesquisar por nome, SKU ou cor…"
          rowHref={(r) => (r.kind === 'FINISHED_GOOD' && r.product_id ? `/produtos/${r.product_id}` : `/estoque/itens/${r.id}`)}
          initialSort={{ key: 'name', direction: 'asc' }}
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              {kind !== 'FINISHED_GOOD' ? (
                <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
                  <Checkbox checked={belowOnly} onChange={(e) => setParam('alerta', e.target.checked ? '1' : null)} /> Abaixo do mínimo
                </label>
              ) : null}
              <ExportMenu rows={rows} columns={exportColumns} fileName={`estoque-${kind.toLowerCase()}`} />
            </div>
          }
          emptyTitle={belowOnly ? 'Nenhum item em alerta' : 'Nenhum item nesta aba'}
          emptyDescription={belowOnly ? 'Todos os itens estão acima do mínimo e da cobertura desejada.' : 'Cadastre os itens que a Wabee guarda para controlar entradas e saídas.'}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              {r.kind === 'FILAMENT' ? <ColorDot hex={r.color_hex} className="size-5" /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted">
                  {r.sku}
                  {r.kind === 'FILAMENT' ? ` · ${r.open_lots + r.closed_lots} carretel(is)` : ''}
                  {r.coverage_days !== null ? ` · ${formatNumber(r.coverage_days, 0)} dias` : ''}
                </p>
              </div>
              <div className="text-right">
                <Qty value={r.kind === 'FINISHED_GOOD' ? r.qty_available : r.qty_on_hand} unit={r.unit} className="block text-sm font-semibold" />
                {showCosts && r.kind !== 'TOOL' ? <Money value={r.value_total} className="text-xs text-muted" /> : null}
                {r.below_minimum ? <Badge tone="warning">baixo</Badge> : null}
              </div>
            </div>
          )}
          footer={
            showCosts && kind !== 'TOOL' ? (
              <tr>
                <td className="px-3 py-2.5 text-sm font-medium" colSpan={columns.length - 1}>
                  Valor total da aba
                </td>
                <td className="px-3 py-2.5 text-right text-sm font-semibold">
                  <Money value={total} />
                </td>
              </tr>
            ) : undefined
          }
        />
      )}
      {showCosts && kind !== 'TOOL' && rows.length > 0 ? (
        <p className="mt-3 text-right text-sm md:hidden">
          Valor total: <Money value={total} className="font-semibold" />
        </p>
      ) : null}
    </Page>
  );
}
