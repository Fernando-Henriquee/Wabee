import { AlertTriangle, ArrowLeft, Plus, Printer } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { EQUIPMENT_KIND_LABELS, EQUIPMENT_STATUS_LABELS, type EquipmentRow, useEquipmentList } from '@/data/production';
import { useMember } from '@/features/member/member-context';
import type { ExportColumn } from '@/lib/export';
import { formatPercent, toNumber } from '@/lib/money';
import { EquipmentStatusBadge } from './bits';
import { formatHours } from './helpers';

function useColumns(showCosts: boolean): Column<EquipmentRow>[] {
  return useMemo(() => {
    const cols: Column<EquipmentRow>[] = [
      {
        key: 'name',
        header: 'Equipamento',
        sortValue: (r) => r.name,
        cell: (r) => (
          <span>
            {r.name}
            <span className="block text-xs font-normal text-muted">{[r.brand, r.model].filter(Boolean).join(' ') || EQUIPMENT_KIND_LABELS[r.kind]}</span>
          </span>
        ),
      },
      { key: 'kind', header: 'Tipo', sortValue: (r) => r.kind, cell: (r) => EQUIPMENT_KIND_LABELS[r.kind] },
      {
        key: 'status',
        header: 'Situação',
        sortValue: (r) => r.status,
        cell: (r) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <EquipmentStatusBadge status={r.status} />
            {r.printing_code ? <Badge tone="accent">imprimindo {r.printing_code}</Badge> : null}
          </span>
        ),
      },
      { key: 'hours', header: 'Horímetro', align: 'right', sortValue: (r) => toNumber(r.hours_used), cell: (r) => <span className="num">{formatHours(r.hours_used)}</span> },
      {
        key: 'month',
        header: 'Este mês',
        align: 'right',
        sortValue: (r) => toNumber(r.hours_this_month),
        cell: (r) => (
          <span className="num">
            {formatHours(r.hours_this_month)} <span className="text-xs text-muted">({formatPercent(r.occupancy_month)})</span>
          </span>
        ),
      },
      {
        key: 'maintenance',
        header: 'Desde a manutenção',
        align: 'right',
        sortValue: (r) => toNumber(r.hours_since_maintenance),
        cell: (r) => (
          <span className={r.maintenance_due ? 'num font-medium text-warning' : 'num'}>
            {r.maintenance_due ? <AlertTriangle className="mr-1 inline size-3.5 align-[-2px]" aria-label="Manutenção próxima" /> : null}
            {formatHours(r.hours_since_maintenance)}
            {r.maintenance_interval_hours ? <span className="text-xs text-muted"> / {r.maintenance_interval_hours} h</span> : null}
          </span>
        ),
      },
    ];
    if (showCosts) cols.push({ key: 'book', header: 'Valor contábil', align: 'right', sortValue: (r) => toNumber(r.book_value), cell: (r) => <Money value={r.book_value} /> });
    return cols;
  }, [showCosts]);
}

export function EquipmentListPage() {
  const { can } = useMember();
  const showCosts = can('costs');
  const equipment = useEquipmentList();
  const columns = useColumns(showCosts);
  const rows = equipment.data ?? [];
  const exportColumns: ExportColumn<EquipmentRow>[] = [
    { header: 'Equipamento', value: (r) => r.name },
    { header: 'Tipo', value: (r) => EQUIPMENT_KIND_LABELS[r.kind] },
    { header: 'Situação', value: (r) => EQUIPMENT_STATUS_LABELS[r.status] },
    { header: 'Marca', value: (r) => r.brand ?? '' },
    { header: 'Modelo', value: (r) => r.model ?? '' },
    { header: 'Horas de uso', value: (r) => r.hours_used, kind: 'number' },
    { header: 'Horas no mês', value: (r) => r.hours_this_month, kind: 'number' },
    { header: 'Horas desde a manutenção', value: (r) => r.hours_since_maintenance, kind: 'number' },
    ...(showCosts
      ? ([
          { header: 'Valor de aquisição', value: (r) => r.acquisition_cost, kind: 'money' },
          { header: 'Depreciação acumulada', value: (r) => r.accumulated_depreciation, kind: 'money' },
          { header: 'Valor contábil', value: (r) => r.book_value, kind: 'money' },
        ] as ExportColumn<EquipmentRow>[])
      : []),
  ];

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/producao" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Produção
          </Link>
        }
        title="Equipamentos"
        description="Impressoras e outras máquinas: horímetro, manutenção e depreciação."
        actions={
          can('write') ? (
            <Button asChild>
              <Link to="/producao/equipamentos/novo">
                <Plus /> Novo equipamento
              </Link>
            </Button>
          ) : undefined
        }
      />
      {equipment.isError ? (
        <ErrorState error={equipment.error} onRetry={() => void equipment.refetch()} />
      ) : !equipment.data ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => String(r.id)}
          rowHref={(r) => `/producao/equipamentos/${r.id}`}
          searchText={(r) => `${r.name} ${r.brand ?? ''} ${r.model ?? ''} ${r.serial ?? ''}`}
          searchPlaceholder="Pesquisar equipamento…"
          initialSort={{ key: 'name', direction: 'asc' }}
          toolbar={<ExportMenu rows={rows} columns={exportColumns} fileName="equipamentos" />}
          emptyTitle="Nenhum equipamento cadastrado"
          emptyDescription="Impressoras compradas entram pelo recebimento da compra; as que você já tinha, cadastre aqui."
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <Printer className="size-5 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted">
                  {EQUIPMENT_KIND_LABELS[r.kind]} · {formatHours(r.hours_used)} de uso
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <EquipmentStatusBadge status={r.status} />
                  {r.printing_code ? <Badge tone="accent">imprimindo</Badge> : null}
                  {r.maintenance_due ? <Badge tone="warning">manutenção</Badge> : null}
                </div>
              </div>
              {showCosts ? (
                <div className="text-right text-xs text-muted">
                  <Money value={r.book_value} className="block text-sm font-semibold text-ink" />
                  valor contábil
                </div>
              ) : null}
            </div>
          )}
        />
      )}
    </Page>
  );
}
