import { Package, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/money-input';
import { formatNumber, toNumber } from '@/lib/money';
import { effectivePackaging, type PackagingItem, type PackagingRow } from './use-catalog';

/**
 * Embalagens baixadas na entrega (despesa de venda). Por padrão: as linhas de
 * embalagem das fichas técnicas × quantidade + a embalagem padrão por pedido.
 */
export function PackagingEditor({
  defaults,
  value,
  onChange,
  items,
  showCosts,
}: {
  defaults: Map<number, string>;
  value: PackagingRow[] | null;
  onChange: (value: PackagingRow[] | null) => void;
  items: Map<number, PackagingItem>;
  showCosts: boolean;
}) {
  const rows = effectivePackaging(defaults, value);
  const editing = value !== null;
  const available = [...items.values()].filter((i) => !rows.some((r) => r.itemId === i.id));
  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{editing ? 'Sem embalagem nesta venda.' : 'Nenhuma embalagem padrão (fichas sem embalagem e sem embalagem por pedido nas configurações).'}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const item = items.get(row.itemId);
            return (
              <li key={row.itemId} className="flex items-center gap-2 text-sm">
                <Package className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{item?.name ?? `Item ${row.itemId}`}</span>
                {editing ? (
                  <>
                    <DecimalInput
                      decimals={3}
                      value={row.qty}
                      onValueChange={(qty) => onChange(rows.map((r) => (r.itemId === row.itemId ? { ...r, qty } : r)))}
                      className="h-9 w-20"
                      aria-label={`Quantidade de ${item?.name ?? 'embalagem'}`}
                    />
                    <Button variant="ghost" size="icon-sm" aria-label="Remover embalagem" onClick={() => onChange(rows.filter((r) => r.itemId !== row.itemId))}>
                      <Trash2 />
                    </Button>
                  </>
                ) : (
                  <span className="num font-medium">{formatNumber(row.qty)} un</span>
                )}
                {showCosts ? <Money value={toNumber(row.qty) * toNumber(item?.avgCost)} className="w-16 text-right text-xs text-muted" /> : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            {available.length > 0 ? (
              <Select
                value=""
                aria-label="Adicionar embalagem"
                className="h-9 w-auto min-w-40"
                onChange={(e) => e.target.value && onChange([...rows, { itemId: Number(e.target.value), qty: '1' }])}
              >
                <option value="">+ Adicionar embalagem</option>
                {available.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              <RotateCcw /> Usar o padrão
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => onChange(rows)}>
              <Pencil /> Ajustar
            </Button>
            {rows.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                Sem embalagem
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
