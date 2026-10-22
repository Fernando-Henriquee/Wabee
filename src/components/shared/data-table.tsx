import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { normalizeName } from '@/lib/text';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  /** Texto pesquisável de cada linha (sem acentos/maiúsculas). */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  rowHref?: (row: T) => string;
  mobileCard: (row: T) => ReactNode;
  initialSort?: { key: string; direction: 'asc' | 'desc' };
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  footer?: ReactNode;
  caption?: string;
  rowClassName?: (row: T) => string | undefined;
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  searchText,
  searchPlaceholder = 'Pesquisar…',
  toolbar,
  rowHref,
  mobileCard,
  initialSort,
  pageSize = 50,
  emptyTitle = 'Nada encontrado',
  emptyDescription,
  emptyAction,
  footer,
  caption,
  rowClassName,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [visible, setVisible] = useState(pageSize);

  const filtered = useMemo(() => {
    const needle = normalizeName(query);
    let result = needle && searchText ? rows.filter((row) => normalizeName(searchText(row)).includes(needle)) : rows;
    if (sort) {
      const column = columns.find((c) => c.key === sort.key);
      if (column?.sortValue) {
        const factor = sort.direction === 'asc' ? 1 : -1;
        result = [...result].sort((a, b) => {
          const va = column.sortValue!(a);
          const vb = column.sortValue!(b);
          if (va === vb) return 0;
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
          return String(va).localeCompare(String(vb), 'pt-BR') * factor;
        });
      }
    }
    return result;
  }, [rows, query, sort, columns, searchText]);

  const shown = filtered.slice(0, visible);

  const toggleSort = (key: string) => {
    setSort((current) => (current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }));
  };

  return (
    <div className="space-y-3">
      {searchText || toolbar ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {searchText ? (
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisible(pageSize);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="pl-9"
              />
            </div>
          ) : null}
          {toolbar}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title={query ? 'Nenhum resultado para a pesquisa' : emptyTitle} description={query ? 'Tente outros termos.' : emptyDescription} action={query ? null : emptyAction} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)] md:block">
            <table className="w-full text-sm">
              {caption ? <caption className="sr-only">{caption}</caption> : null}
              <thead className="border-b border-line bg-subtle/70 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  {columns.map((column) => {
                    const active = sort?.key === column.key;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={cn('px-3 py-2.5 font-semibold', column.align === 'right' && 'text-right', column.align === 'center' && 'text-center', column.className)}
                      >
                        {column.sortValue ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className={cn('inline-flex items-center gap-1 uppercase hover:text-ink', column.align === 'right' && 'flex-row-reverse')}
                          >
                            {column.header}
                            {active ? (
                              sort.direction === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />
                            ) : (
                              <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          column.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((row) => (
                  <tr key={getRowId(row)} className={cn('group hover:bg-subtle/60', rowClassName?.(row))}>
                    {columns.map((column, index) => {
                      const content = column.cell(row);
                      return (
                        <td
                          key={column.key}
                          className={cn('px-3 py-2.5 align-middle', column.align === 'right' && 'text-right', column.align === 'center' && 'text-center', column.className)}
                        >
                          {index === 0 && rowHref ? (
                            <Link to={rowHref(row)} className="font-medium text-ink underline-offset-4 hover:underline hover:decoration-accent hover:decoration-2">
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {footer ? <tfoot className="border-t border-line bg-subtle/60">{footer}</tfoot> : null}
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {shown.map((row) => (
              <li key={getRowId(row)}>
                {rowHref ? (
                  <Link to={rowHref(row)} className={cn('block rounded-[var(--radius-card)] border border-line bg-panel p-3 shadow-[var(--shadow-card)] active:bg-subtle', rowClassName?.(row))}>
                    {mobileCard(row)}
                  </Link>
                ) : (
                  <div className={cn('rounded-[var(--radius-card)] border border-line bg-panel p-3 shadow-[var(--shadow-card)]', rowClassName?.(row))}>{mobileCard(row)}</div>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              {shown.length} de {filtered.length} {filtered.length === 1 ? 'registro' : 'registros'}
            </span>
            {filtered.length > shown.length ? (
              <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + pageSize)}>
                Mostrar mais
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
