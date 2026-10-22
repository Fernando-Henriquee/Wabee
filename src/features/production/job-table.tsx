import { useMemo } from 'react';
import type { Column } from '@/components/shared/data-table';
import { Money } from '@/components/shared/money';
import { FAILURE_REASON_LABELS, JOB_STATUS_LABELS, type PrintJobRow } from '@/data/production';
import { formatDateTimeBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatMinutes, toNumber } from '@/lib/money';
import { JobStatusBadge } from './bits';

/** Colunas da lista de impressões (histórico e por equipamento). */
export function useHistoryColumns(showCosts: boolean, timeZone: string, showPrinter = true): Column<PrintJobRow>[] {
  return useMemo(() => {
    const cols: Column<PrintJobRow>[] = [
      {
        key: 'code',
        header: 'Impressão',
        className: 'whitespace-nowrap',
        sortValue: (r) => r.code,
        cell: (r) => (
          <span>
            {r.code}
            {showPrinter ? <span className="block text-xs font-normal text-muted">{r.equipment_name}</span> : null}
          </span>
        ),
      },
      { key: 'date', header: 'Data', sortValue: (r) => r.finished_at ?? r.created_at, cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTimeBR(r.finished_at ?? r.created_at, timeZone)}</span> },
      { key: 'outputs', header: 'Peças', cell: (r) => <span className="text-sm text-ink-soft">{r.outputs_summary}</span> },
      { key: 'status', header: 'Situação', sortValue: (r) => r.status, cell: (r) => <JobStatusBadge status={r.status} /> },
      {
        key: 'good',
        header: 'Boas / falhas',
        align: 'right',
        className: 'whitespace-nowrap',
        sortValue: (r) => r.qty_good,
        cell: (r) =>
          r.status === 'CANCELADA' ? (
            '—'
          ) : (
            <span className="num">
              {r.qty_good}
              {r.qty_failed > 0 ? <span className="text-danger"> / {r.qty_failed}</span> : <span className="text-muted"> / 0</span>}
            </span>
          ),
      },
      { key: 'time', header: 'Tempo', align: 'right', sortValue: (r) => r.actual_minutes ?? 0, cell: (r) => <span className="num">{formatMinutes(r.actual_minutes)}</span> },
    ];
    if (showCosts) {
      cols.push(
        { key: 'cost', header: 'Custo', align: 'right', sortValue: (r) => toNumber(r.cost_total), cell: (r) => (r.status === 'CANCELADA' ? '—' : <Money value={r.cost_total} />) },
        {
          key: 'scrap',
          header: 'Falhas',
          align: 'right',
          sortValue: (r) => toNumber(r.cost_scrap),
          cell: (r) => (toNumber(r.cost_scrap) > 0 ? <Money value={r.cost_scrap} className="text-danger" /> : <span className="text-muted">—</span>),
        },
      );
    }
    return cols;
  }, [showCosts, timeZone, showPrinter]);
}

export function historyExportColumns(showCosts: boolean, timeZone: string): ExportColumn<PrintJobRow>[] {
  return [
    { header: 'Impressão', value: (r) => r.code },
    { header: 'Impressora', value: (r) => r.equipment_name },
    { header: 'Situação', value: (r) => JOB_STATUS_LABELS[r.status] },
    { header: 'Início', value: (r) => formatDateTimeBR(r.started_at, timeZone) },
    { header: 'Término', value: (r) => formatDateTimeBR(r.finished_at, timeZone) },
    { header: 'Peças', value: (r) => r.outputs_summary ?? '' },
    { header: 'Planejadas', value: (r) => r.qty_planned, kind: 'number' },
    { header: 'Boas', value: (r) => r.qty_good, kind: 'number' },
    { header: 'Falhas', value: (r) => r.qty_failed, kind: 'number' },
    { header: 'Minutos', value: (r) => r.actual_minutes, kind: 'number' },
    { header: 'Gramas', value: (r) => r.actual_grams, kind: 'number' },
    { header: 'Motivo da falha', value: (r) => (r.failure_reason ? FAILURE_REASON_LABELS[r.failure_reason] : '') },
    ...(showCosts
      ? ([
          { header: 'Custo material', value: (r) => r.cost_material, kind: 'money' },
          { header: 'Custo operacional', value: (r) => toNumber(r.cost_energy) + toNumber(r.cost_depreciation) + toNumber(r.cost_operational), kind: 'money' },
          { header: 'Custo total', value: (r) => r.cost_total, kind: 'money' },
          { header: 'Custo de falhas', value: (r) => r.cost_scrap, kind: 'money' },
        ] as ExportColumn<PrintJobRow>[])
      : []),
  ];
}
