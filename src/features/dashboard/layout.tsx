import { ChevronDown, ChevronUp, LayoutGrid, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { BLOCKS, type BlockId, DEFAULT_ORDER, type LayoutPrefs } from './layout-prefs';

/** Diálogo para escolher e ordenar os blocos da Visão geral. */
export function CustomizeDialog({ prefs, onChange }: { prefs: LayoutPrefs; onChange: (next: LayoutPrefs) => void }) {
  const move = (index: number, delta: number) => {
    const order = [...prefs.order];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    onChange({ ...prefs, order });
  };
  const toggle = (id: BlockId) =>
    onChange({
      ...prefs,
      hidden: prefs.hidden.includes(id) ? prefs.hidden.filter((h) => h !== id) : [...prefs.hidden, id],
    });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LayoutGrid /> Personalizar
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Personalizar a Visão geral"
        description="Escolha os blocos e a ordem. Vale para este aparelho."
        footer={
          <Button variant="ghost" onClick={() => onChange({ order: DEFAULT_ORDER, hidden: [], compact: false })}>
            <RotateCcw /> Restaurar padrão
          </Button>
        }
      >
        <label className="mb-4 flex items-start gap-3 rounded-lg border border-line p-3">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--color-ink)]"
            checked={prefs.compact}
            onChange={(e) => onChange({ ...prefs, compact: e.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium">Modo compacto</span>
            <span className="block text-xs text-muted">Só a meta do mês, os indicadores principais e o que está na impressora. Bom para o celular.</span>
          </span>
        </label>
        <ol
          className={cn('divide-y divide-line rounded-lg border border-line', prefs.compact && 'pointer-events-none opacity-50')}
          aria-disabled={prefs.compact}
        >
          {prefs.order.map((id, index) => {
            const block = BLOCKS.find((b) => b.id === id)!;
            const shown = !prefs.hidden.includes(id);
            return (
              <li key={id} className="flex items-center gap-2 px-3 py-2">
                <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={shown} onChange={() => toggle(id)} />
                  <span className={cn('truncate', !shown && 'text-muted line-through')}>{block.label}</span>
                </label>
                <Button variant="ghost" size="icon-sm" aria-label={`Subir ${block.label}`} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ChevronUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Descer ${block.label}`}
                  disabled={index === prefs.order.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown />
                </Button>
              </li>
            );
          })}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
