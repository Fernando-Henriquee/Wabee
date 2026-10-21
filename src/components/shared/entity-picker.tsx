import { Check, Plus, Search } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { normalizeName } from '@/lib/import/normalize';

export interface PickerOption {
  id: string;
  label: string;
  description?: ReactNode;
  searchText?: string;
  disabled?: boolean;
}

interface EntityPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  options: PickerOption[];
  selectedId?: string | null;
  onSelect: (option: PickerOption) => void;
  /** Ação de cadastro rápido com o texto pesquisado (ex.: novo cliente). Oculta se já existe um item com o mesmo nome. */
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
  emptyText?: string;
  loading?: boolean;
}

/** Seleção pesquisável em diálogo (folha inferior no celular), navegável por teclado. */
export function EntityPicker({ open, onOpenChange, title, options, selectedId, onSelect, onCreate, createLabel, emptyText = 'Nada encontrado.', loading }: EntityPickerProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = normalizeName(query);
    if (!needle) return options;
    return options.filter((option) => normalizeName(`${option.label} ${option.searchText ?? ''}`).includes(needle));
  }, [options, query]);

  const close = () => {
    onOpenChange(false);
    setQuery('');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent title={title}>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar…"
            aria-label={`Pesquisar ${title.toLowerCase()}`}
            className="pl-9"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && filtered.length === 1 && !filtered[0]!.disabled) {
                event.preventDefault();
                onSelect(filtered[0]!);
                close();
              }
            }}
          />
        </div>
        {onCreate && query.trim() && !options.some((option) => normalizeName(option.label) === normalizeName(query)) ? (
          <Button
            variant="outline"
            className="mb-2 w-full justify-start"
            onClick={() => {
              onCreate(query.trim());
              close();
            }}
          >
            <Plus /> {createLabel ? createLabel(query.trim()) : `Cadastrar “${query.trim()}”`}
          </Button>
        ) : null}
        {loading ? <p className="py-6 text-center text-sm text-muted">Carregando…</p> : null}
        {!loading && filtered.length === 0 ? <p className="py-6 text-center text-sm text-muted">{emptyText}</p> : null}
        <ul className="max-h-[50dvh] space-y-1 overflow-y-auto" aria-label={title}>
          {filtered.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                disabled={option.disabled}
                onClick={() => {
                  onSelect(option);
                  close();
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-subtle focus-visible:bg-subtle disabled:opacity-50',
                  option.id === selectedId && 'bg-accent-soft',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{option.label}</span>
                  {option.description ? <span className="block truncate text-xs text-muted">{option.description}</span> : null}
                </span>
                {option.id === selectedId ? <Check className="size-4 text-accent-ink" aria-label="Selecionado" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
