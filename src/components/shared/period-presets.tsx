import { useSearchParams } from 'react-router';
import { Input } from '@/components/ui/input';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addDays, addMonths, endOfMonth, formatDateBR, isValidISODate, startOfMonth } from '@/lib/dates';

export type PresetKey = '7d' | 'mes' | 'mes_anterior' | 'ano' | 'inicio' | 'custom';

export interface DateRange {
  preset: PresetKey;
  from: string;
  to: string;
}

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: '7d', label: '7 dias' },
  { key: 'mes', label: 'Mês' },
  { key: 'mes_anterior', label: 'Mês anterior' },
  { key: 'ano', label: 'Ano' },
  { key: 'inicio', label: 'Desde o início' },
  { key: 'custom', label: 'Período' },
];

export function rangeFor(preset: PresetKey, today: string, goLive: string | null): Omit<DateRange, 'preset'> {
  switch (preset) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case 'mes_anterior': {
      const start = startOfMonth(addMonths(startOfMonth(today), -1));
      return { from: start, to: endOfMonth(start) };
    }
    case 'ano':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'inicio':
      return { from: goLive && goLive < today ? addMonths(startOfMonth(goLive), -12) : '2020-01-01', to: today };
    default:
      return { from: startOfMonth(today), to: endOfMonth(today) };
  }
}

/**
 * Filtro de período global (14.1.4), guardado na URL para continuar igual ao trocar de
 * painel: ?periodo=mes|7d|mes_anterior|ano|inicio|custom&de=…&ate=…
 */
export function useDateRange(defaultPreset: PresetKey = 'mes'): [DateRange, (range: DateRange) => void] {
  const { today, settings } = useMember();
  const [params, setParams] = useSearchParams();
  const preset = (params.get('periodo') as PresetKey | null) ?? defaultPreset;
  const from = params.get('de');
  const to = params.get('ate');
  let range: DateRange;
  if (preset === 'custom' && isValidISODate(from) && isValidISODate(to) && from <= to) range = { preset, from, to };
  else range = { preset: preset === 'custom' ? defaultPreset : preset, ...rangeFor(preset === 'custom' ? defaultPreset : preset, today(), settings.go_live_date) };
  const setRange = (next: DateRange) => {
    const updated = new URLSearchParams(params);
    updated.set('periodo', next.preset);
    if (next.preset === 'custom') {
      updated.set('de', next.from);
      updated.set('ate', next.to);
    } else {
      updated.delete('de');
      updated.delete('ate');
    }
    setParams(updated, { replace: true });
  };
  return [range, setRange];
}

export function describeRange(range: DateRange): string {
  return `${formatDateBR(range.from)} a ${formatDateBR(range.to)}`;
}

export function PeriodPresets({ range, onChange, className }: { range: DateRange; onChange: (range: DateRange) => void; className?: string }) {
  const { today, settings } = useMember();
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      <div role="radiogroup" aria-label="Período" className="flex max-w-full overflow-x-auto rounded-xl border border-line bg-subtle p-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={range.preset === p.key}
            onClick={() => onChange(p.key === 'custom' ? { preset: 'custom', from: range.from, to: range.to } : { preset: p.key, ...rangeFor(p.key, today(), settings.go_live_date) })}
            className={cn(
              'h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-ink',
              range.preset === p.key && 'bg-panel text-ink shadow-sm',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {range.preset === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="Data inicial" className="h-9 w-auto" value={range.from} max={range.to} onChange={(e) => isValidISODate(e.target.value) && onChange({ ...range, from: e.target.value })} />
          <span className="text-sm text-muted">a</span>
          <Input type="date" aria-label="Data final" className="h-9 w-auto" value={range.to} min={range.from} onChange={(e) => isValidISODate(e.target.value) && onChange({ ...range, to: e.target.value })} />
        </div>
      ) : (
        <span className="text-xs text-muted">{describeRange(range)}</span>
      )}
    </div>
  );
}

export type CostLayerView = 'direct' | 'operational' | 'full';

const LAYER_OPTIONS: Array<{ key: CostLayerView; label: string; hint: string }> = [
  { key: 'direct', label: 'Direto', hint: 'Só material' },
  { key: 'operational', label: 'Direto + operacional', hint: 'Material, energia e depreciação' },
  { key: 'full', label: 'Completo', hint: 'Com o trabalho' },
];

/** Seletor de camada de custo presente em toda margem (14.1.2). Padrão: direto + operacional. */
export function useCostLayer(): [CostLayerView, (layer: CostLayerView) => void] {
  const [params, setParams] = useSearchParams();
  const value = (params.get('camada') as CostLayerView | null) ?? 'operational';
  const set = (layer: CostLayerView) => {
    const updated = new URLSearchParams(params);
    updated.set('camada', layer);
    setParams(updated, { replace: true });
  };
  return [LAYER_OPTIONS.some((o) => o.key === value) ? value : 'operational', set];
}

export function CostLayerSelector({ value, onChange }: { value: CostLayerView; onChange: (layer: CostLayerView) => void }) {
  return (
    <div role="radiogroup" aria-label="Camada de custo da margem" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-subtle p-1">
      {LAYER_OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          title={o.hint}
          onClick={() => onChange(o.key)}
          className={cn('h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted hover:text-ink', value === o.key && 'bg-panel text-ink shadow-sm')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
