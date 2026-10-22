import { formatDateBR } from './dates';
import { formatDecimal } from './money';

/**
 * Exportação de dados em CSV (padrão brasileiro: ";" e vírgula decimal, UTF-8
 * com BOM para o Excel reconhecer acentos) e em XLSX (SheetJS, carregado sob demanda).
 */

export type ColumnKind = 'text' | 'money' | 'date' | 'number' | 'boolean';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => unknown;
  kind?: ColumnKind;
}

function formatCell(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined) return '';
  switch (kind) {
    case 'money':
      return formatDecimal(Number(value));
    case 'date':
      return formatDateBR(String(value));
    case 'number':
      return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3, useGrouping: false }).format(Number(value));
    case 'boolean':
      return value ? 'Sim' : 'Não';
    default:
      return String(value);
  }
}

function escapeCSV(text: string): string {
  // Evita injeção de fórmulas ao abrir no Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((column) => escapeCSV(column.header)).join(';');
  const body = rows.map((row) =>
    columns.map((column) => escapeCSV(formatCell(column.value(row), column.kind ?? 'text'))).join(';'),
  );
  return `\ufeff${[header, ...body].join('\r\n')}`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCSV<T>(rows: T[], columns: ExportColumn<T>[], fileName: string) {
  triggerDownload(new Blob([toCSV(rows, columns)], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
}

/** Valores tipados para planilha: dinheiro em reais (número), datas como texto DD/MM/AAAA. */
export function toSheetRows<T>(rows: T[], columns: ExportColumn<T>[]): Array<Record<string, string | number | boolean | null>> {
  return rows.map((row) => {
    const record: Record<string, string | number | boolean | null> = {};
    for (const column of columns) {
      const value = column.value(row);
      const kind = column.kind ?? 'text';
      if (value === null || value === undefined) record[column.header] = null;
      else if (kind === 'money') record[column.header] = Number(value);
      else if (kind === 'number') record[column.header] = Number(value);
      else if (kind === 'date') record[column.header] = formatDateBR(String(value));
      else if (kind === 'boolean') record[column.header] = value ? 'Sim' : 'Não';
      else record[column.header] = String(value);
    }
    return record;
  });
}

export async function downloadXLSX<T>(rows: T[], columns: ExportColumn<T>[], fileName: string, sheetName = 'Dados') {
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.json_to_sheet(toSheetRows(rows, columns), { header: columns.map((c) => c.header) });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  triggerDownload(
    new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${fileName}.xlsx`,
  );
}
