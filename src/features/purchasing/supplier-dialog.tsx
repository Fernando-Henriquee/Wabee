import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { type Supplier, useSaveSupplier } from '@/data/inventory';
import { SUPPLIER_KIND_LABELS, type SupplierKind } from '@/data/purchasing';
import { describeError } from '@/lib/errors';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fornecedor a editar; ausente = novo. */
  supplier?: Supplier | null;
  initialName?: string;
  onSaved?: (id: number) => void;
}

/** Cadastro de fornecedor (US-3.1): só o nome é obrigatório. Monte com `key` para reiniciar o formulário. */
export function SupplierDialog({ open, onOpenChange, supplier, initialName, onSaved }: Props) {
  const [form, setForm] = useState({
    name: supplier?.name ?? initialName ?? '',
    document: supplier?.document ?? '',
    kind: (supplier?.kind ?? '') as SupplierKind | '',
    contact: supplier?.contact ?? '',
    url: supplier?.url ?? '',
    notes: supplier?.notes ?? '',
    active: supplier?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useSaveSupplier();
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('Informe o nome do fornecedor.');
    save.mutate(
      {
        id: supplier?.id,
        name: form.name.trim(),
        document: form.document.trim() || null,
        kind: form.kind || null,
        contact: form.contact.trim() || null,
        url: form.url.trim() || null,
        notes: form.notes.trim() || null,
        active: form.active,
      },
      {
        onSuccess: (id) => {
          onSaved?.(id);
          onOpenChange(false);
        },
        onError: (e) => setError(describeError(e)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'}
        description="Só o nome é obrigatório; o resto ajuda a encontrar e recomprar."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="supplier-form" loading={save.isPending}>
              {supplier ? 'Salvar' : 'Cadastrar'}
            </Button>
          </>
        }
      >
        <form id="supplier-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" required className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120} autoFocus />
          </Field>
          <Field label="Tipo">
            <Select value={form.kind} onChange={(e) => set('kind', e.target.value as SupplierKind | '')}>
              <option value="">—</option>
              {(Object.keys(SUPPLIER_KIND_LABELS) as SupplierKind[]).map((k) => (
                <option key={k} value={k}>
                  {SUPPLIER_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="CPF ou CNPJ">
            <Input value={form.document} onChange={(e) => set('document', e.target.value)} maxLength={20} inputMode="numeric" />
          </Field>
          <Field label="Contato" hint="Telefone, WhatsApp, e-mail ou vendedor.">
            <Input value={form.contact} onChange={(e) => set('contact', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Site ou loja">
            <Input value={form.url} onChange={(e) => set('url', e.target.value)} maxLength={300} type="url" placeholder="https://" />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} className="min-h-16" />
          </Field>
          {supplier ? (
            <label className="inline-flex min-h-10 items-center gap-2 text-sm text-ink-soft sm:col-span-2">
              <Checkbox checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Ativo (aparece na escolha de fornecedor das compras)
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">
              {error}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
