import { useState } from 'react';

/**
 * Blocos da Visão geral que o dono pode esconder e reordenar, e o modo compacto
 * (só meta, indicadores principais e impressoras). Preferência deste aparelho.
 */

export type BlockId =
  'resumo' | 'meta' | 'indicadores' | 'caminho' | 'impressora' | 'carteira' | 'retirada' | 'produtos' | 'entregas' | 'comparar' | 'graficos';

export const BLOCKS: Array<{ id: BlockId; label: string; half?: boolean }> = [
  { id: 'resumo', label: 'Resumo da semana' },
  { id: 'meta', label: 'Meta do mês' },
  { id: 'indicadores', label: 'Indicadores' },
  { id: 'carteira', label: 'Carteira e capacidade', half: true },
  { id: 'retirada', label: 'Quanto você pode retirar', half: true },
  { id: 'caminho', label: 'Caminho do valor' },
  { id: 'impressora', label: 'Agora na impressora' },
  { id: 'produtos', label: 'Produtos (ABC, pontuais e cores)', half: true },
  { id: 'entregas', label: 'Tempo de entrega', half: true },
  { id: 'comparar', label: 'Comparar períodos' },
  { id: 'graficos', label: 'Gráficos' },
];

export const COMPACT_BLOCKS: BlockId[] = ['meta', 'indicadores', 'impressora'];

export interface LayoutPrefs {
  order: BlockId[];
  hidden: BlockId[];
  compact: boolean;
}

const KEY = 'wabee.visao-geral.layout';
export const DEFAULT_ORDER = BLOCKS.map((b) => b.id);

function defaults(): LayoutPrefs {
  let compact = false;
  try {
    compact = window.matchMedia('(max-width: 639px)').matches;
  } catch {
    // sem matchMedia (testes)
  }
  return { order: DEFAULT_ORDER, hidden: [], compact };
}

function load(): LayoutPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw) as Partial<LayoutPrefs>;
    const known = (saved.order ?? []).filter((id): id is BlockId => DEFAULT_ORDER.includes(id));
    // Blocos novos (de versões futuras) entram no fim.
    const order = [...known, ...DEFAULT_ORDER.filter((id) => !known.includes(id))];
    return {
      order,
      hidden: (saved.hidden ?? []).filter((id) => DEFAULT_ORDER.includes(id)),
      compact: Boolean(saved.compact),
    };
  } catch {
    return defaults();
  }
}

export function useLayoutPrefs(): [LayoutPrefs, (next: LayoutPrefs) => void] {
  const [prefs, setPrefs] = useState<LayoutPrefs>(load);
  const update = (next: LayoutPrefs) => {
    setPrefs(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // armazenamento indisponível: vale só nesta visita
    }
  };
  return [prefs, update];
}

/** Blocos na ordem em que aparecem, considerando o modo compacto. */
export function visibleBlocks(prefs: LayoutPrefs): BlockId[] {
  if (prefs.compact) return COMPACT_BLOCKS;
  return prefs.order.filter((id) => !prefs.hidden.includes(id));
}
