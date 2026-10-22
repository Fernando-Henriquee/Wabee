import type { ReactNode } from 'react';
import { ColorDot } from '@/components/shared/item-bits';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { LoadingBlock } from '@/components/ui/states';
import { type BomLine, type BomVersion, LINE_KIND_LABELS, useBomEstimate, useBomLines } from '@/data/products';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatCost, formatMinutes, formatQty, toNumber } from '@/lib/money';

/** Duas versões da ficha lado a lado: linhas e custo estimado de cada uma (US-4.3). */
export function CompareBomDialog({ a, b, onOpenChange }: { a: BomVersion; b: BomVersion; onOpenChange: (open: boolean) => void }) {
  const { can } = useMember();
  const showCosts = can('costs');
  const linesA = useBomLines(a.id);
  const linesB = useBomLines(b.id);
  const costA = useBomEstimate(a.id, showCosts);
  const costB = useBomEstimate(b.id, showCosts);
  const ready = linesA.data && linesB.data && (!showCosts || (costA.data && costB.data));

  const key = (l: BomLine) => `${l.item_id}:${l.line_kind}`;
  const rows = new Map<string, { line: BomLine; a?: BomLine; b?: BomLine }>();
  for (const l of linesA.data ?? []) rows.set(key(l), { line: l, a: l });
  for (const l of linesB.data ?? []) rows.set(key(l), { ...(rows.get(key(l)) ?? { line: l }), b: l });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent title={`Versão ${a.version} × versão ${b.version}`} description="Diferenças destacadas. O custo usa os custos médios e as taxas de hoje nas duas." size="xl">
        {!ready ? (
          <LoadingBlock rows={4} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium" />
                  <th className="px-3 py-2 text-right font-medium">Versão {a.version}</th>
                  <th className="px-3 py-2 text-right font-medium">Versão {b.version}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <Row label="Peças por mesa" a={a.units_per_plate} b={b.units_per_plate} />
                <Row label="Tempo por mesa" a={a.est_print_minutes_per_plate} b={b.est_print_minutes_per_plate} format={formatMinutes} />
                <Row label="Acabamento por peça" a={a.est_post_process_minutes_per_unit} b={b.est_post_process_minutes_per_unit} format={formatMinutes} />
                <Row label="Filamento por unidade" a={a.grams_per_unit} b={b.grams_per_unit} format={(v) => formatQty(v, 'G')} />
                {[...rows.values()].map(({ line, a: la, b: lb }) => (
                  <Row
                    key={key(line)}
                    label={
                      <span className="inline-flex items-center gap-2">
                        <ColorDot hex={line.color_hex} />
                        <span>
                          {line.item_name}
                          <span className="block text-xs text-muted">{LINE_KIND_LABELS[line.line_kind]}</span>
                        </span>
                      </span>
                    }
                    a={la ? la.qty_per_unit : null}
                    b={lb ? lb.qty_per_unit : null}
                    format={(v) => formatQty(v, line.unit)}
                  />
                ))}
                {showCosts && costA.data && costB.data ? (
                  <>
                    <Row label="Material" a={costA.data.material} b={costB.data.material} format={(v) => formatCost(v, 4)} />
                    <Row label="Operacional (energia, depreciação, combinada)" a={toNumber(costA.data.energy) + toNumber(costA.data.depreciation) + toNumber(costA.data.operational)} b={toNumber(costB.data.energy) + toNumber(costB.data.depreciation) + toNumber(costB.data.operational)} format={(v) => formatCost(v, 4)} />
                    <Row label="Trabalho" a={costA.data.labor} b={costB.data.labor} format={(v) => formatCost(v, 4)} />
                    <Row label="Custo de produção por unidade" a={costA.data.total_production} b={costB.data.total_production} format={(v) => formatCost(v, 4)} strong />
                    <Row label="Embalagem" a={costA.data.packaging} b={costB.data.packaging} format={(v) => formatCost(v, 4)} />
                  </>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, a, b, format = (v) => String(v), strong }: { label: ReactNode; a: number | null; b: number | null; format?: (v: number) => string; strong?: boolean }) {
  const changed = a === null || b === null || toNumber(a) !== toNumber(b);
  return (
    <tr className={cn(changed && 'bg-accent-soft/60', strong && 'font-semibold')}>
      <th scope="row" className="px-3 py-2 text-left font-normal text-ink-soft">
        {label}
      </th>
      <td className="num px-3 py-2 text-right">{a === null ? <span className="text-muted">—</span> : format(a)}</td>
      <td className="num px-3 py-2 text-right">{b === null ? <span className="text-muted">—</span> : format(b)}</td>
    </tr>
  );
}
