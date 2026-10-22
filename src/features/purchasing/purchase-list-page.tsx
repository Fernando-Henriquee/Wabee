import { Plus, Search, Store } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { Stat } from '@/components/shared/stat';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import type { Payer } from '@/data/finance';
import { useSuppliers } from '@/data/inventory';
import { type PurchaseStatus, STATUS_LABELS, STATUS_ORDER, usePurchases } from '@/data/purchasing';
import { useMember } from '@/features/member/member-context';
import { sumMoney } from '@/lib/calc';
import { normalizeName } from '@/lib/text';
import { NoPurchaseAccess } from './purchase-bits';
import { PURCHASE_EXPORT_COLUMNS, purchaseColumns, purchaseMobileCard } from './purchase-table';

const PENDING_RECEIPT = 'A_RECEBER';

/** Lista de compras (US-3.7): período, fornecedor, situação e pagador; total do filtro e exportação. */
export function PurchaseListPage() {
  const { can, today } = useMember();
  const [range, setRange] = useDateRange('ano');
  const [params, setParams] = useSearchParams();
  const supplierId = params.get('fornecedor') ?? '';
  const status = params.get('status') ?? '';
  const payer = (params.get('pagador') ?? '') as Payer | '';
  const query = params.get('q') ?? '';
  const purchases = usePurchases({ from: range.from, to: range.to }, can('costs'));
  const suppliers = useSuppliers(true);
  const columns = useMemo(() => purchaseColumns({ showSupplier: true, today: today() }), [today]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const needle = normalizeName(query);
    return (purchases.data ?? []).filter((p) => {
      if (supplierId && String(p.supplier_id) !== supplierId) return false;
      if (status === PENDING_RECEIPT ? !['CONFIRMADA', 'RECEBIDA_PARCIAL'].includes(p.status) : status && p.status !== status) return false;
      if (payer && p.payer !== payer) return false;
      if (needle && !normalizeName(`${p.number} ${p.supplier_name ?? ''} ${p.lines_summary ?? ''} ${p.invoice_ref ?? ''}`).includes(needle)) return false;
      return true;
    });
  }, [purchases.data, supplierId, status, payer, query]);

  if (!can('costs')) return <NoPurchaseAccess title="Compras" />;

  // Canceladas e rascunhos não somam (a menos que o filtro peça exatamente essa situação).
  const counted = rows.filter((p) => (status === 'CANCELADA' || status === 'RASCUNHO' ? true : p.status !== 'CANCELADA' && p.status !== 'RASCUNHO'));
  const total = sumMoney(counted.map((p) => p.total));
  const open = sumMoney(counted.map((p) => p.open_amount));
  const byOwner = sumMoney(counted.map((p) => p.paid_by_owner));
  const byCompany = sumMoney(counted.map((p) => p.paid_by_company));
  const supplierOptions = (suppliers.data ?? []).filter((s) => s.active || String(s.id) === supplierId);

  return (
    <Page>
      <PageHeader
        title="Compras"
        description="Filamento, componentes, equipamentos e despesas: estoque ao receber, contas a pagar ao confirmar."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/fornecedores">
                <Store /> Fornecedores
              </Link>
            </Button>
            {can('write') ? (
              <Button asChild>
                <Link to="/compras/nova">
                  <Plus /> Nova compra
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 space-y-3">
        <PeriodPresets range={range} onChange={setRange} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" value={query} onChange={(e) => setParam('q', e.target.value)} placeholder="Número, item, fornecedor ou nota…" aria-label="Pesquisar compras" className="pl-9" />
          </div>
          <Select value={supplierId} onChange={(e) => setParam('fornecedor', e.target.value)} aria-label="Fornecedor">
            <option value="">Todos os fornecedores</option>
            {supplierOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Situação">
            <option value="">Todas as situações</option>
            <option value={PENDING_RECEIPT}>A receber (confirmadas)</option>
            {STATUS_ORDER.map((s: PurchaseStatus) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={payer} onChange={(e) => setParam('pagador', e.target.value)} aria-label="Pagador">
            <option value="">Empresa e dono</option>
            <option value="EMPRESA">Pagas pela empresa</option>
            <option value="DONO">Pagas pelo dono</option>
          </Select>
        </div>
      </div>

      {purchases.isError ? (
        <ErrorState error={purchases.error} onRetry={() => void purchases.refetch()} />
      ) : !purchases.data ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Comprado no filtro" value={total} hint={`${counted.length} compra(s)`} />
            <Stat label="Pago pela empresa" value={byCompany} />
            <Stat label="Pago pelo dono" value={byOwner} hint="Vira aporte, empréstimo ou reembolso" />
            <Stat label="Em aberto" value={open} tone={Number(open) > 0 ? 'warning' : 'default'} />
          </div>
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => String(r.id)}
            rowHref={(r) => `/compras/${r.id}`}
            rowClassName={(r) => (r.status === 'CANCELADA' ? 'opacity-60' : undefined)}
            initialSort={{ key: 'date', direction: 'desc' }}
            toolbar={
              <div className="flex flex-wrap items-center justify-between gap-2 sm:ml-auto">
                <ExportMenu rows={rows} columns={PURCHASE_EXPORT_COLUMNS} fileName={`compras-${range.from}-a-${range.to}`} />
              </div>
            }
            emptyTitle={purchases.data.length === 0 ? 'Nenhuma compra no período' : 'Nenhuma compra com esses filtros'}
            emptyDescription={purchases.data.length === 0 ? 'Registre as compras de filamento, componentes e equipamentos — inclusive as feitas antes de usar o sistema.' : 'Mude o período ou limpe os filtros.'}
            emptyAction={
              can('write') && purchases.data.length === 0 ? (
                <Button asChild>
                  <Link to="/compras/nova">
                    <Plus /> Nova compra
                  </Link>
                </Button>
              ) : undefined
            }
            mobileCard={(r) => purchaseMobileCard(r, today())}
            footer={
              <tr>
                <td className="px-3 py-2.5 text-sm font-medium" colSpan={3}>
                  Total do filtro {status === 'CANCELADA' || status === 'RASCUNHO' ? '' : <span className="font-normal text-muted">(sem rascunhos e canceladas)</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-sm font-semibold">
                  <Money value={total} />
                </td>
                <td colSpan={columns.length - 4} />
              </tr>
            }
          />
          {rows.length > 0 ? (
            <p className="mt-3 text-right text-sm md:hidden">
              Total do filtro: <Money value={total} className="font-semibold" />
            </p>
          ) : null}
        </>
      )}
    </Page>
  );
}
