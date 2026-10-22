import { ArrowLeft, ExternalLink, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type Supplier, useSuppliers } from '@/data/inventory';
import { SUPPLIER_KIND_LABELS, usePurchases } from '@/data/purchasing';
import { useMember } from '@/features/member/member-context';
import { sumMoney } from '@/lib/calc';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { toNumber } from '@/lib/money';
import { NoPurchaseAccess } from './purchase-bits';
import { SupplierDialog } from './supplier-dialog';

interface SupplierListRow extends Supplier {
  yearTotal: string;
  purchases: number;
  lastPurchase: string | null;
}

function externalHref(url: string | null) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Fornecedores (US-3.1): lista, cadastro rápido e o quanto se comprou de cada um no ano. */
export function SupplierListPage() {
  const { can, today } = useMember();
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const suppliers = useSuppliers(showInactive);
  const year = today().slice(0, 4);
  const purchases = usePurchases({}, can('costs'));

  const rows = useMemo<SupplierListRow[]>(() => {
    const list = purchases.data ?? [];
    return (suppliers.data ?? []).map((s) => {
      const mine = list.filter((p) => p.supplier_id === s.id && p.status !== 'RASCUNHO' && p.status !== 'CANCELADA');
      return {
        ...s,
        yearTotal: sumMoney(mine.filter((p) => p.purchased_at.startsWith(year)).map((p) => p.total)),
        purchases: mine.length,
        lastPurchase: mine.reduce<string | null>((max, p) => (max === null || p.purchased_at > max ? p.purchased_at : max), null),
      };
    });
  }, [suppliers.data, purchases.data, year]);

  if (!can('costs')) return <NoPurchaseAccess title="Fornecedores" />;

  const columns: Column<SupplierListRow>[] = [
    { key: 'name', header: 'Fornecedor', sortValue: (r) => r.name, cell: (r) => r.name },
    { key: 'kind', header: 'Tipo', sortValue: (r) => r.kind ?? '', cell: (r) => (r.kind ? SUPPLIER_KIND_LABELS[r.kind] : '—') },
    { key: 'contact', header: 'Contato', cell: (r) => r.contact ?? '—' },
    {
      key: 'url',
      header: 'Site',
      cell: (r) =>
        r.url ? (
          <a href={externalHref(r.url)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-soft underline decoration-accent decoration-2 underline-offset-2">
            Abrir <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : (
          '—'
        ),
    },
    { key: 'last', header: 'Última compra', align: 'right', sortValue: (r) => r.lastPurchase ?? '', cell: (r) => formatDateBR(r.lastPurchase) },
    { key: 'year', header: `Comprado em ${year}`, align: 'right', sortValue: (r) => toNumber(r.yearTotal), cell: (r) => <Money value={r.yearTotal} /> },
    { key: 'status', header: 'Situação', align: 'center', cell: (r) => (r.active ? <Badge tone="success">ativo</Badge> : <Badge>inativo</Badge>) },
  ];

  const exportColumns: ExportColumn<SupplierListRow>[] = [
    { header: 'Fornecedor', value: (r) => r.name },
    { header: 'Tipo', value: (r) => (r.kind ? SUPPLIER_KIND_LABELS[r.kind] : '') },
    { header: 'CPF/CNPJ', value: (r) => r.document ?? '' },
    { header: 'Contato', value: (r) => r.contact ?? '' },
    { header: 'Site', value: (r) => r.url ?? '' },
    { header: 'Compras', value: (r) => r.purchases, kind: 'number' },
    { header: 'Última compra', value: (r) => r.lastPurchase, kind: 'date' },
    { header: `Comprado em ${year}`, value: (r) => r.yearTotal, kind: 'money' },
    { header: 'Ativo', value: (r) => r.active, kind: 'boolean' },
  ];

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/compras" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Compras
          </Link>
        }
        title="Fornecedores"
        description="De quem a Wabee compra: lojas online, marketplaces e lojas físicas."
        actions={
          can('write') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Novo fornecedor
            </Button>
          ) : undefined
        }
      />
      {suppliers.isError ? (
        <ErrorState error={suppliers.error} onRetry={() => void suppliers.refetch()} />
      ) : !suppliers.data ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => String(r.id)}
          searchText={(r) => `${r.name} ${r.contact ?? ''} ${r.document ?? ''} ${r.url ?? ''}`}
          searchPlaceholder="Pesquisar fornecedor…"
          rowHref={(r) => `/fornecedores/${r.id}`}
          rowClassName={(r) => (r.active ? undefined : 'opacity-60')}
          initialSort={{ key: 'name', direction: 'asc' }}
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex min-h-10 items-center gap-2 text-sm text-ink-soft">
                <Checkbox checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inativos
              </label>
              <ExportMenu rows={rows} columns={exportColumns} fileName="fornecedores" />
            </div>
          }
          emptyTitle="Nenhum fornecedor cadastrado"
          emptyDescription="Cadastre aqui ou direto na compra, digitando o nome de um fornecedor novo."
          emptyAction={
            can('write') ? (
              <Button onClick={() => setCreating(true)}>
                <Plus /> Novo fornecedor
              </Button>
            ) : undefined
          }
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted">
                  {[r.kind ? SUPPLIER_KIND_LABELS[r.kind] : null, r.contact, r.lastPurchase ? `última ${formatDateBR(r.lastPurchase)}` : null].filter(Boolean).join(' · ') || 'Sem compras ainda'}
                </p>
              </div>
              <div className="text-right">
                <Money value={r.yearTotal} className="block text-sm font-semibold" />
                <span className="text-xs text-muted">em {year}</span>
                {!r.active ? <Badge className="ml-1">inativo</Badge> : null}
              </div>
            </div>
          )}
        />
      )}
      {creating ? <SupplierDialog open onOpenChange={setCreating} /> : null}
    </Page>
  );
}
