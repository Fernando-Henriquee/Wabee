import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { COST_LAYERS } from '@/components/charts/chart';
import { Input } from '@/components/ui/input';
import { useFieldControl } from '@/components/ui/field';
import type { CostEstimate } from '@/data/products';
import { cn } from '@/lib/cn';
import { formatCost, formatMinutes, formatNumber, formatQty, toNumber } from '@/lib/money';

/** Iniciais do produto no lugar da foto. */
export function ProductInitials({ name, className }: { name: string; className?: string }) {
  const words = name.replace(/^(chaveiro|vaso|suporte|porta)\s+/i, '').split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? name).slice(0, 2)).toUpperCase();
  return (
    <span aria-hidden className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft font-display text-sm font-semibold text-accent-ink', className)}>
      {initials}
    </span>
  );
}

export function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

/** Duração em horas e minutos (o banco guarda minutos). */
export function DurationInput({ value, onChange, disabled, ...rest }: { value: number; onChange: (minutes: number) => void; disabled?: boolean; id?: string; 'aria-describedby'?: string }) {
  const props = useFieldControl(rest);
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  const clamp = (text: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(text.replace(/\D/g, '')) || 0)));
  return (
    <div className="flex items-center gap-2" role="group" aria-describedby={props['aria-describedby']}>
      <div className="relative w-24">
        <Input id={props.id} disabled={disabled} inputMode="numeric" className="num pr-7 text-right" value={hours || ''} placeholder="0" onChange={(e) => onChange(clamp(e.target.value, 999) * 60 + minutes)} aria-label="Horas" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">h</span>
      </div>
      <div className="relative w-24">
        <Input disabled={disabled} inputMode="numeric" className="num pr-10 text-right" value={minutes || ''} placeholder="0" onChange={(e) => onChange(hours * 60 + clamp(e.target.value, 59))} aria-label="Minutos" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">min</span>
      </div>
    </div>
  );
}

/** Composição por camada só como barra: a tabela ao lado faz o papel de legenda. */
function StackBar({ values }: { values: Record<'material' | 'energy' | 'depreciation' | 'operational' | 'labor', number> }) {
  const parts = COST_LAYERS.map((l) => ({ ...l, value: Math.max(values[l.key], 0) })).filter((p) => p.value > 0);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return null;
  return (
    <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label={parts.map((p) => `${p.label} ${formatCost(p.value, 4)}`).join(', ')}>
      {parts.map((p) => (
        <span key={p.key} className="h-full first:rounded-l last:rounded-r" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${formatCost(p.value, 4)}`} />
      ))}
    </div>
  );
}

/** Custo unitário com 4 casas (o centavo some em peças de poucos gramas). */
export function UnitCost({ value, estimated, hint, className }: { value: number | string | null | undefined; estimated?: boolean; hint?: string; className?: string }) {
  if (value === null || value === undefined || value === '') return <span className={cn('text-muted', className)}>—</span>;
  return (
    <span className={cn('num whitespace-nowrap', estimated && 'estimated cursor-help', className)} title={estimated ? (hint ?? 'Valor estimado') : hint}>
      {estimated ? '~' : ''}
      {formatCost(value, 4)}
    </span>
  );
}

const ROWS: Array<{ key: keyof CostEstimate; label: string; layer: 'material' | 'energy' | 'depreciation' | 'operational' | 'labor' }> = [
  { key: 'material', label: 'Material', layer: 'material' },
  { key: 'energy', label: 'Energia', layer: 'energy' },
  { key: 'depreciation', label: 'Depreciação', layer: 'depreciation' },
  { key: 'operational', label: 'Operacional (taxa combinada)', layer: 'operational' },
  { key: 'labor', label: 'Trabalho', layer: 'labor' },
];

/** Quadro de custo estimado de uma unidade, por camada (US-4.4, seção 14.7). */
export function CostBreakdown({ estimate, loading, className }: { estimate: CostEstimate | null | undefined; loading?: boolean; className?: string }) {
  if (!estimate) return <p className="text-sm text-muted">{loading ? 'Calculando…' : 'Sem estimativa.'}</p>;
  const values = {
    material: toNumber(estimate.material),
    energy: toNumber(estimate.energy),
    depreciation: toNumber(estimate.depreciation),
    operational: toNumber(estimate.operational),
    labor: toNumber(estimate.labor),
  };
  return (
    <div className={cn('space-y-3', loading && 'opacity-60', className)} aria-busy={loading || undefined}>
      <div>
        <p className="text-xs text-muted">Custo de produção por unidade</p>
        <p className={cn('num text-2xl font-semibold', estimate.estimated && 'estimated cursor-help')} title={estimate.estimated ? 'Inclui filamento com custo de referência ou energia/depreciação estimadas' : undefined}>
          {estimate.estimated ? '~' : ''}
          {formatCost(estimate.total_production, 4)}
        </p>
      </div>
      <StackBar values={values} />
      <table className="w-full text-sm">
        <caption className="sr-only">Custo por camada</caption>
        <tbody className="divide-y divide-line">
          {ROWS.filter((r) => r.key !== 'labor' || estimate.labor_valued).map((r) => (
            <tr key={r.key}>
              <th scope="row" className="py-1.5 text-left font-normal text-ink-soft">
                <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: `var(--color-layer-${r.layer})` }} aria-hidden />
                {r.label}
              </th>
              <td className="num py-1.5 text-right">{formatCost(estimate[r.key] as number, 4)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-1.5 text-left font-normal text-ink-soft">
              Embalagem
              <span className="block text-xs text-muted">Sai na entrega; entra na margem, fora do custo de produção</span>
            </th>
            <td className="num py-1.5 text-right align-top">{formatCost(estimate.packaging, 4)}</td>
          </tr>
        </tbody>
      </table>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-subtle px-2.5 py-2">
          <dt className="text-muted">Tempo de máquina / un.</dt>
          <dd className="num font-medium text-ink">{toNumber(estimate.machine_minutes) < 10 ? `${formatNumber(estimate.machine_minutes, 1)} min` : formatMinutes(estimate.machine_minutes)}</dd>
        </div>
        <div className="rounded-lg bg-subtle px-2.5 py-2">
          <dt className="text-muted">Filamento / un.</dt>
          <dd className="num font-medium text-ink">{formatQty(estimate.grams, 'G')}</dd>
        </div>
      </dl>
      {estimate.rate_mode === 'MISSING' ? (
        <Warning>Sem taxa horária vigente: o tempo de máquina está saindo sem custo. Cadastre em Produção → Taxas.</Warning>
      ) : estimate.rate_mode === 'COMBINED' ? (
        <p className="text-xs text-muted">Energia e depreciação estão juntas na taxa combinada por hora. Separe as duas em Produção → Taxas quando quiser ver cada uma.</p>
      ) : null}
      {!estimate.labor_valued ? <p className="text-xs text-muted">O trabalho não está sendo valorizado (sem taxa de mão de obra).</p> : null}
      {estimate.estimated ? <p className="text-xs text-muted">~ Estimado: há filamento sem custo de compra (usa a referência por grama).</p> : null}
    </div>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
