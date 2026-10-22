import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type FinancialCategory, NATURE_LABELS, useCategories, useSaveCategory } from '@/data/finance';
import { useMember } from '@/features/member/member-context';
import { describeError } from '@/lib/errors';
import { FinanceNav } from './finance-nav';

/** Plano de categorias (US-7.2): grupos fixos (estrutura do DRE) e subcategorias editáveis. */
export function CategoriesPage() {
  const { can } = useMember();
  const categories = useCategories();
  const [editing, setEditing] = useState<{ parent: FinancialCategory; category: FinancialCategory | null } | null>(null);
  if (categories.isError) return <Page><ErrorState error={categories.error} /></Page>;
  const list = categories.data ?? [];
  const groups = list.filter((c) => c.parent_id === null);
  const children = (id: number) => list.filter((c) => c.parent_id === id).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
  return (
    <Page>
      <PageHeader
        back={
          <Link to="/financeiro/contas" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Contas
          </Link>
        }
        title="Categorias financeiras"
        description="Os grupos seguem a estrutura do DRE. Categorias do sistema são usadas pelos lançamentos automáticos e não podem ser desativadas."
      />
      <FinanceNav />
      {!categories.data ? (
        <LoadingBlock />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id}>
              <CardHeader
                title={`${g.code}. ${g.name}`}
                description={`${NATURE_LABELS[g.nature] ?? g.nature}${g.in_income_statement ? ' · entra no DRE' : ' · fora do DRE'}`}
                actions={
                  can('write') && !['7', '8', '9'].includes(g.code) ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ parent: g, category: null })}>
                      <Plus /> Nova
                    </Button>
                  ) : undefined
                }
              />
              <ul className="divide-y divide-line">
                {children(g.id).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="num w-10 shrink-0 text-muted">{c.code}</span>
                    <span className={c.active ? 'min-w-0 flex-1' : 'min-w-0 flex-1 text-muted line-through'}>{c.name}</span>
                    {c.is_system ? <Badge>sistema</Badge> : null}
                    {can('write') ? (
                      <Button size="icon-sm" variant="ghost" aria-label={`Editar ${c.name}`} onClick={() => setEditing({ parent: g, category: c })}>
                        <Pencil />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing ? <CategoryDialog key={editing.category?.id ?? `new-${editing.parent.id}`} parent={editing.parent} category={editing.category} onOpenChange={(o) => !o && setEditing(null)} /> : null}
    </Page>
  );
}

function CategoryDialog({ parent, category, onOpenChange }: { parent: FinancialCategory; category: FinancialCategory | null; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [active, setActive] = useState(category?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveCategory(() => onOpenChange(false));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={category ? `Editar ${category.code}` : `Nova categoria em ${parent.name}`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              disabled={!name.trim()}
              onClick={() => save.mutate(category ? { id: category.id, name: name.trim(), active } : { parent_id: parent.id, name: name.trim() }, { onError: (e) => setError(describeError(e)) })}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
          </Field>
          {category && !category.is_system ? (
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Ativa (aparece ao lançar despesas)
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
