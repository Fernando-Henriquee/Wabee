import { Table2 } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatBRL } from '@/lib/money';

/**
 * Gráfico de colunas (empilhadas ou não) com linhas opcionais no MESMO eixo (nunca
 * dois eixos). Especificação visual: colunas ≤ 24px com ponta arredondada de 4px,
 * 2px de espaço entre segmentos, linhas de 2px, grade fina e discreta, dica ao
 * passar o mouse/tocar, legenda sempre que houver 2+ séries e tabela com os valores.
 */

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  kind?: 'bar' | 'line';
  /** Linha tracejada para valores estimados/projetados. */
  dashed?: boolean;
}

export interface ChartDatum {
  label: string;
  /** Rótulo completo para a dica e a tabela. */
  fullLabel?: string;
  values: Record<string, number>;
}

interface ColumnChartProps {
  data: ChartDatum[];
  series: ChartSeries[];
  height?: number;
  format?: (value: number) => string;
  /** Empilha as séries de barra (padrão: true). */
  stacked?: boolean;
  ariaLabel: string;
  emptyText?: string;
  footnote?: ReactNode;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry!.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Marcas redondas do eixo: 0, 50, 100… */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    max = min + 1;
  }
  const span = max - min;
  const step0 = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= step0) ?? 10 * magnitude;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 1000)} mil`;
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: abs < 10 ? 1 : 0 }).format(value);
}

/** Retângulo com cantos de 4px só na ponta oposta à base (topo se positivo, base se negativo). */
function barPath(x: number, y: number, width: number, height: number, roundTop: boolean, roundBottom: boolean) {
  const r = Math.min(4, width / 2, Math.abs(height) / 2);
  const top = roundTop ? r : 0;
  const bottom = roundBottom ? r : 0;
  return [
    `M${x},${y + top}`,
    top ? `Q${x},${y} ${x + top},${y}` : '',
    `L${x + width - top},${y}`,
    top ? `Q${x + width},${y} ${x + width},${y + top}` : '',
    `L${x + width},${y + height - bottom}`,
    bottom ? `Q${x + width},${y + height} ${x + width - bottom},${y + height}` : '',
    `L${x + bottom},${y + height}`,
    bottom ? `Q${x},${y + height} ${x},${y + height - bottom}` : '',
    'Z',
  ].join(' ');
}

export function ColumnChart({ data, series, height = 220, format = formatBRL, stacked = true, ariaLabel, emptyText = 'Sem dados no período.', footnote }: ColumnChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const bars = series.filter((s) => (s.kind ?? 'bar') === 'bar');
  const lines = series.filter((s) => s.kind === 'line');

  const { min, max } = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const d of data) {
      if (stacked) {
        const pos = bars.reduce((sum, s) => sum + Math.max(d.values[s.key] ?? 0, 0), 0);
        const neg = bars.reduce((sum, s) => sum + Math.min(d.values[s.key] ?? 0, 0), 0);
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      } else {
        for (const s of bars) {
          hi = Math.max(hi, d.values[s.key] ?? 0);
          lo = Math.min(lo, d.values[s.key] ?? 0);
        }
      }
      for (const s of lines) {
        hi = Math.max(hi, d.values[s.key] ?? 0);
        lo = Math.min(lo, d.values[s.key] ?? 0);
      }
    }
    return { min: lo, max: hi };
  }, [data, bars, lines, stacked]);

  const hasData = data.some((d) => series.some((s) => (d.values[s.key] ?? 0) !== 0));
  const ticks = niceTicks(min, max);
  const yMin = Math.min(...ticks);
  const yMax = Math.max(...ticks);
  const padLeft = 44;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const y = (v: number) => padTop + ((yMax - v) / (yMax - yMin || 1)) * plotH;
  const band = plotW / Math.max(data.length, 1);
  const groupBars = stacked ? 1 : Math.max(bars.length, 1);
  const barW = Math.max(4, Math.min(24, (band * 0.6) / groupBars));
  const cx = (i: number) => padLeft + band * i + band / 2;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56)));

  return (
    <figure className="space-y-2">
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {hasData ? (
          <svg role="img" aria-label={ariaLabel} width={width} height={height} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padLeft} x2={width - padRight} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--color-line-strong)' : 'var(--color-chart-grid)'} strokeWidth={1} />
                <text x={padLeft - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] num">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              let posBase = 0;
              let negBase = 0;
              const segments: ReactNode[] = [];
              bars.forEach((s, j) => {
                const v = d.values[s.key] ?? 0;
                if (v === 0) return;
                let top: number;
                let bottom: number;
                if (stacked) {
                  if (v > 0) {
                    bottom = y(posBase);
                    top = y(posBase + v);
                    posBase += v;
                  } else {
                    top = y(negBase);
                    bottom = y(negBase + v);
                    negBase += v;
                  }
                } else {
                  top = y(Math.max(v, 0));
                  bottom = y(Math.min(v, 0));
                }
                const x = stacked ? cx(i) - barW / 2 : cx(i) - (barW * groupBars) / 2 + j * barW + 1;
                // 2px de espaço entre segmentos empilhados.
                const gap = stacked ? 1 : 0;
                const h = Math.max(bottom - top - gap * 2, 1);
                const isEnd = stacked
                  ? v > 0
                    ? !bars.slice(j + 1).some((n) => (d.values[n.key] ?? 0) > 0)
                    : !bars.slice(j + 1).some((n) => (d.values[n.key] ?? 0) < 0)
                  : true;
                segments.push(
                  <path
                    key={s.key}
                    d={barPath(x, top + gap, stacked ? barW : barW - 2, h, isEnd && v > 0, isEnd && v < 0)}
                    fill={s.color}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />,
                );
              });
              return <g key={d.label + i}>{segments}</g>;
            })}
            {lines.map((s) => {
              const points = data.map((d, i) => `${cx(i)},${y(d.values[s.key] ?? 0)}`).join(' ');
              return (
                <g key={s.key}>
                  <polyline points={points} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
                  {data.map((d, i) => (
                    <circle key={i} cx={cx(i)} cy={y(d.values[s.key] ?? 0)} r={hover === i ? 5 : 3.5} fill={s.color} stroke="var(--color-panel)" strokeWidth={2} />
                  ))}
                </g>
              );
            })}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={`l${i}`} x={cx(i)} y={height - 8} textAnchor="middle" className="fill-muted text-[10px]">
                  {d.label}
                </text>
              ) : null,
            )}
            {/* Alvos de toque/hover maiores que a marca: a coluna inteira. */}
            {data.map((d, i) => (
              <rect
                key={`h${i}`}
                x={padLeft + band * i}
                y={padTop}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={0}
                aria-label={`${d.fullLabel ?? d.label}: ${series.map((s) => `${s.label} ${format(d.values[s.key] ?? 0)}`).join(', ')}`}
              />
            ))}
            {hover !== null ? <line x1={cx(hover)} x2={cx(hover)} y1={padTop} y2={padTop + plotH} stroke="var(--color-line-strong)" strokeWidth={1} pointerEvents="none" /> : null}
          </svg>
        ) : (
          <div className="grid place-items-center rounded-lg border border-dashed border-line-strong text-sm text-muted" style={{ height }}>
            {emptyText}
          </div>
        )}
        {hasData && hover !== null && data[hover] ? (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-[var(--shadow-pop)]"
            style={{ left: Math.min(Math.max(cx(hover) - 80, 0), width - 170) }}
          >
            <p className="mb-1 font-semibold text-ink">{data[hover].fullLabel ?? data[hover].label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
                <span className="num font-medium text-ink">{format(data[hover]!.values[s.key] ?? 0)}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        {series.length > 1 ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft" aria-label="Legenda">
            {series.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                {s.kind === 'line' ? (
                  <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: s.color }} aria-hidden />
                ) : (
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                )}
                {s.label}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        {hasData ? (
          <button type="button" onClick={() => setShowTable((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink" aria-expanded={showTable}>
            <Table2 className="size-3.5" aria-hidden /> {showTable ? 'Ocultar tabela' : 'Ver tabela'}
          </button>
        ) : null}
      </figcaption>
      {footnote ? <p className="text-xs text-muted">{footnote}</p> : null}
      {showTable ? (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className={cn('w-full text-xs')}>
            <thead className="bg-subtle text-left text-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">Período</th>
                {series.map((s) => (
                  <th key={s.key} className="px-2 py-1.5 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((d, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">{d.fullLabel ?? d.label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num px-2 py-1.5 text-right">
                      {format(d.values[s.key] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

/** Camadas de custo com cores fixas em todo o sistema (14.7). */
export const COST_LAYERS = [
  { key: 'material', label: 'Material', color: 'var(--color-layer-material)' },
  { key: 'energy', label: 'Energia', color: 'var(--color-layer-energy)' },
  { key: 'depreciation', label: 'Depreciação', color: 'var(--color-layer-depreciation)' },
  { key: 'operational', label: 'Operacional (combinado)', color: 'var(--color-layer-operational)' },
  { key: 'labor', label: 'Trabalho', color: 'var(--color-layer-labor)' },
] as const;

/** Barra horizontal de composição (ex.: custo unitário por camada). */
export function LayerBar({ values, format = formatBRL }: { values: Partial<Record<(typeof COST_LAYERS)[number]['key'], number>>; format?: (v: number) => string }) {
  const parts = COST_LAYERS.map((l) => ({ ...l, value: Math.max(values[l.key] ?? 0, 0) })).filter((p) => p.value > 0);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}>
        {parts.map((p) => (
          <span key={p.key} className="h-full first:rounded-l last:rounded-r" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${format(p.value)}`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
        {parts.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
            {p.label} <span className="num text-ink">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
