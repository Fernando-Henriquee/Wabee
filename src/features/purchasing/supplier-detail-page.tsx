import { ArrowLeft, ExternalLink, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { ColorDot } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type ItemKind, KIND_LABELS } from '@/data/inventory';
import { type LineKind, type PurchaseLineRow, SUPPLIER_KIND_LABELS, usePurchaseLines, usePurchases, useSupplier } from '@/data/purchasing';
import { useMember } from '@/features/member/member-context';
import { sumMoney } from '@/lib/calc';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatQty, toNumber } from '@/lib/money';
import { InfoItem, NoPurchaseAccess } from './purchase-bits';
import { PURCHASE_EXPORT_COLUMNS, purchaseColumns, purchaseMobileCard } from './purchase-table';
import { SupplierDialog } from './supplier-dialog';

/** Item comprado deste fornecedor: último preço e custo de aquisição (US-3.1). */
interface BoughtItem {
  key: string;
  itemId: number | null;
  name: string;
  kind: LineKind;
  itemKind: ItemKind | null;
  unit: string;
  colorHex: string | null;
  sku: string | null;
  times: number;
  totalQty: number;
  totalSpent: string;
  lastDate: string;
  lastPurchaseId: number;
  lastNumber: string;
  lastUnitPrice: number;
  lastLandedUnitCost: number;
}

function perUnit(value: number, itemKind: ItemKind | null, unit: string) {
  if (itemKind === 'FILAMENT')
    return (
      <>
        <Money value={value * 1000} />
        <span className="text-xs text-muted">/kg</span>
      </>
    );
  return (
    <>
      <Money value={value} cost />
      <span className="text-xs text-muted">/{unit === 'UN' ? 'un' : unit.toLowerCase()}</span>
    </>
  );
}

export function SupplierDetailPage() {
  const { id } = useParams();
  const supplierId = Number(id);
  const { can, today } = useMember();
  const [editing, setEditing] = useState(false);
  const supplier = useSupplier(supplierId);
  const purchases = usePurchases({ supplierId }, can('costs') && supplierId > 0);
  const effective = useMemo(() => (purchases.data ?? []).filter((p) => p.status !== 'RASCUNHO' && p.status !== 'CANCELADA'), [purchases.data]);
  const lines = usePurchaseLines(purchases.data ? effective.map((p) => p.id) : undefined);
  const columns = useMemo(() => purchaseColumns({ showSupplier: false, today: today() }), [today]);

  const bought = useMemo<BoughtItem[]>(() => {
    const byId = new Map(effective.map((p) => [p.id, p]));
    const groups = new Map<string, BoughtItem>();
    const sorted = [...(lines.data ?? [])]
      .filter((l: PurchaseLineRow) => l.line_kind !== 'EXPENSE')
      .sort((a, b) => {
        const pa = byId.get(a.purchase_id);
        const pb = byId.get(b.purchase_id);
        return `${pa?.purchased_at}-${String(a.purchase_id).padStart(8, '0')}`.localeCompare(`${pb?.purchased_at}-${String(b.purchase_id).padStart(8, '0')}`);
      });
    for (const l of sorted) {
      const p = byId.get(l.purchase_id);
      if (!p) continue;
      const key = l.item_id ? `i${l.item_id}` : `d${l.description.toLowerCase()}`;
      const current = groups.get(key);
      groups.set(key, {
        key,
        itemId: l.item_id,
        name: l.item_name ?? l.description,
        kind: l.line_kind,
        itemKind: l.item_kind,
        unit: l.unit ?? 'UN',
        colorHex: l.color_hex,
        sku: l.sku,
        times: (current?.times ?? 0) + 1,
        totalQty: (current?.totalQty ?? 0) + toNumber(l.qty),
        totalSpent: sumMoney([current?.totalSpent ?? 0, l.landed_total]),
        // Linhas em ordem cronológica: a última sobrescreve o "último preço".
        lastDate: p.purchased_at,
        lastPurchaseId: p.id,
        lastNumber: p.number,
        lastUnitPrice: toNumber(l.unit_price),
        lastLandedUnitCost: toNumber(l.landed_unit_cost),
      });
    }
    return [...groups.values()];
  }, [effective, lines.data]);

  if (!can('costs')) return <NoPurchaseAccess title="Fornecedor" />;
  if (supplier.isError) return <Page><ErrorState error={supplier.error} onRetry={() => void supplier.refetch()} /></Page>;
  if (supplier.data === undefined) return <Page><LoadingBlock /></Page>;
  if (supplier.data === null) {
    return (
      <Page>
        <EmptyState title="Fornecedor não encontrado" action={<Button asChild variant="outline"><Link to="/fornecedores">Voltar aos fornecedores</Link></Button>} />
      </Page>
    );
  }
  const s = supplier.data;
  const year = today().slice(0, 4);
  const yearTotal = sumMoney(effective.filter((p) => p.purchased_at.startsWith(year)).map((p) => p.total));
  const allTotal = sumMoney(effective.map((p) => p.total));
  const openTotal = sumMoney(effective.map((p) => p.open_amount));
  const last = effective[0];
  const href = s.url ? (/^https?:\/\//i.test(s.url) ? s.url : `https://${s.url}`) : null;

  const itemColumns: Column<BoughtItem>[] = [
    {
      key: 'name',
      header: 'Item',
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.itemKind === 'FILAMENT' ? <ColorDot hex={r.colorHex} /> : null}
          <span>
            {r.name}
            <span className="block text-xs font-normal text-muted">{r.kind === 'EQUIPMENT' ? 'Equipamento' : `${r.itemKind ? KIND_LABELS[r.itemKind] : ''} · ${r.sku ?? ''}`}</span>
          </span>
        </span>
      ),
    },
    { key: 'times', header: 'Compras', align: 'center', sortValue: (r) => r.times, cell: (r) => r.times },
    { key: 'qty', header: 'Qtd. total', align: 'right', sortValue: (r) => r.totalQty, cell: (r) => <span className="num">{formatQty(r.totalQty, r.unit)}</span> },
    { key: 'price', header: 'Último preço', align: 'right', sortValue: (r) => r.lastUnitPrice, cell: (r) => perUnit(r.lastUnitPrice, r.itemKind, r.unit) },
    { key: 'landed', header: 'Último custo de aquisição', align: 'right', sortValue: (r) => r.lastLandedUnitCost, cell: (r) => <span className="font-semibold">{perUnit(r.lastLandedUnitCost, r.itemKind, r.unit)}</span> },
    {
      key: 'last',
      header: 'Última compra',
      align: 'right',
      sortValue: (r) => r.lastDate,
      cell: (r) => (
        <Link to={`/compras/${r.lastPurchaseId}`} className="num underline decoration-accent decoration-2 underline-offset-2">
          {formatDateBR(r.lastDate)}
        </Link>
      ),
    },
  ];
  const itemExport: ExportColumn<BoughtItem>[] = [
    { header: 'Item', value: (r) => r.name },
    { header: 'SKU', value: (r) => r.sku ?? '' },
    { header: 'Compras', value: (r) => r.times, kind: 'number' },
    { header: 'Quantidade total', value: (r) => r.totalQty, kind: 'number' },
    { header: 'Unidade', value: (r) => r.unit.toLowerCase() },
    { header: 'Último preço unitário', value: (r) => r.lastUnitPrice, kind: 'number' },
    { header: 'Último custo de aquisição', value: (r) => r.lastLandedUnitCost, kind: 'number' },
    { header: 'Total gasto', value: (r) => r.totalSpent, kind: 'money' },
    { header: 'Última compra', value: (r) => r.lastDate, kind: 'date' },
    { header: 'Compra', value: (r) => r.lastNumber },
  ];

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/fornecedores" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Fornecedores
          </Link>
        }
        title={s.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {s.kind ? <Badge>{SUPPLIER_KIND_LABELS[s.kind]}</Badge> : null}
            {!s.active ? <Badge tone="danger">inativo</Badge> : null}
            {s.contact ? <span>{s.contact}</span> : null}
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-accent decoration-2 underline-offset-2">
                {s.url} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </span>
        }
        actions={
          can('write') ? (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Editar
              </Button>
              {s.active ? (
                <Button asChild>
                  <Link to={`/compras/nova?fornecedor=${s.id}`}>
                    <Plus /> Nova compra
                  </Link>
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Comprado em ${year}`} value={yearTotal} hint={`${effective.filter((p) => p.purchased_at.startsWith(year)).length} compra(s)`} />
        <Stat label="Comprado no total" value={allTotal} hint={`${effective.length} compra(s) confirmada(s)`} />
        <Stat label="Em aberto" value={openTotal} tone={toNumber(openTotal) > 0 ? 'warning' : 'default'} />
        <Stat label="Última compra" value={last?.purchased_at ?? null} format={(v) => (v ? formatDateBR(String(v)) : '—')} hint={last ? last.number : 'Nenhuma ainda'} />
      </div>

      <Tabs defaultValue="purchases">
        <TabsList>
          <TabsTrigger value="purchases">Compras ({purchases.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="items">Itens comprados ({bought.length})</TabsTrigger>
          <TabsTrigger value="data">Dados</TabsTrigger>
        </TabsList>
        <TabsContent value="purchases">
          {purchases.isError ? (
            <ErrorState error={purchases.error} onRetry={() => void purchases.refetch()} />
          ) : !purchases.data ? (
            <LoadingBlock />
          ) : (
            <DataTable
              rows={purchases.data}
              columns={columns}
              getRowId={(r) => String(r.id)}
              rowHref={(r) => `/compras/${r.id}`}
              rowClassName={(r) => (r.status === 'CANCELADA' ? 'opacity-60' : undefined)}
              initialSort={{ key: 'date', direction: 'desc' }}
              toolbar={<ExportMenu rows={purchases.data} columns={PURCHASE_EXPORT_COLUMNS} fileName={`compras-${s.name}`} />}
              emptyTitle="Nenhuma compra deste fornecedor"
              mobileCard={(r) => purchaseMobileCard(r, today(), false)}
            />
          )}
        </TabsContent>
        <TabsContent value="items">
          {lines.isError ? (
            <ErrorState error={lines.error} />
          ) : !lines.data ? (
            <LoadingBlock />
          ) : (
            <DataTable
              rows={bought}
              columns={itemColumns}
              getRowId={(r) => r.key}
              rowHref={(r) => (r.itemId ? `/estoque/itens/${r.itemId}` : `/compras/${r.lastPurchaseId}`)}
              searchText={(r) => `${r.name} ${r.sku ?? ''}`}
              searchPlaceholder="Pesquisar item…"
              initialSort={{ key: 'last', direction: 'desc' }}
              toolbar={<ExportMenu rows={bought} columns={itemExport} fileName={`itens-${s.name}`} />}
              emptyTitle="Nada comprado ainda"
              emptyDescription="Itens e equipamentos das compras confirmadas aparecem aqui com o último preço pago."
              mobileCard={(r) => (
                <div className="flex items-center gap-3">
                  {r.itemKind === 'FILAMENT' ? <ColorDot hex={r.colorHex} className="size-5" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted">
                      {r.times} compra(s) · última {formatDateBR(r.lastDate)}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <span className="block font-semibold">{perUnit(r.lastUnitPrice, r.itemKind, r.unit)}</span>
                    <span className="text-xs text-muted">custo {perUnit(r.lastLandedUnitCost, r.itemKind, r.unit)}</span>
                  </div>
                </div>
              )}
            />
          )}
        </TabsContent>
        <TabsContent value="data">
          <Card>
            <CardHeader title="Cadastro" />
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              <InfoItem label="Nome" value={s.name} />
              <InfoItem label="Tipo" value={s.kind ? SUPPLIER_KIND_LABELS[s.kind] : '—'} />
              <InfoItem label="CPF ou CNPJ" value={s.document ?? '—'} />
              <InfoItem label="Contato" value={s.contact ?? '—'} />
              <InfoItem label="Site ou loja" value={s.url ?? '—'} />
              <InfoItem label="Situação" value={s.active ? 'Ativo' : 'Inativo'} />
              {s.notes ? <InfoItem label="Observações" value={s.notes} className="sm:col-span-2" /> : null}
            </dl>
          </Card>
        </TabsContent>
      </Tabs>

      {editing ? <SupplierDialog open onOpenChange={setEditing} supplier={s} /> : null}
    </Page>
  );
}
