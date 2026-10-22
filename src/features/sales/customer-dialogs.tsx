import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Textarea } from '@/components/ui/input';
import { type CustomerInput, type CustomerRow, useSaveCustomer } from '@/data/sales';
import { describeError } from '@/lib/errors';

type TextKey =
  | 'name'
  | 'phone'
  | 'email'
  | 'instagram'
  | 'document'
  | 'address_street'
  | 'address_number'
  | 'address_complement'
  | 'address_district'
  | 'address_city'
  | 'address_state'
  | 'address_zip'
  | 'notes';

type FormState = Record<TextKey, string> & { marketing_consent: boolean };

function initialState(customer?: CustomerRow | null): FormState {
  return {
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    instagram: customer?.instagram ?? '',
    document: customer?.document ?? '',
    address_street: customer?.address_street ?? '',
    address_number: customer?.address_number ?? '',
    address_complement: customer?.address_complement ?? '',
    address_district: customer?.address_district ?? '',
    address_city: customer?.address_city ?? '',
    address_state: customer?.address_state ?? '',
    address_zip: customer?.address_zip ?? '',
    notes: customer?.notes ?? '',
    marketing_consent: customer?.marketing_consent ?? false,
  };
}

/** Explicação do consentimento de marketing (LGPD). */
export function ConsentExplanation() {
  return (
    <p className="text-xs leading-relaxed text-muted">
      Pela LGPD, promoções e novidades só podem ser enviadas a quem autorizou. O cliente pode retirar o consentimento quando quiser (é só desmarcar). Sem consentimento, o contato continua
      podendo ser usado para tratar dos pedidos dele.
    </p>
  );
}

/** Cadastro e edição de cliente (US-6.1). */
export function CustomerFormDialog({
  customer,
  open,
  onOpenChange,
  onSaved,
}: {
  customer?: CustomerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (id: number) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(customer));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveCustomer((id) => {
    onOpenChange(false);
    onSaved?.(id);
  });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: TextKey) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value) });

  const submit = () => {
    setError(null);
    if (!form.name.trim()) return setError('Informe o nome do cliente.');
    const payload: CustomerInput = { ...form, id: customer?.id, name: form.name.trim() };
    save.mutate(payload, { onError: (e) => setError(describeError(e)) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={customer ? `Editar ${customer.name}` : 'Novo cliente'}
        description="Nome e um contato bastam; o endereço ajuda nas entregas."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={save.isPending}>
              {customer ? 'Salvar alterações' : 'Cadastrar cliente'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">
              <Input {...text('name')} maxLength={120} autoFocus />
            </Field>
            <Field label="Telefone / WhatsApp">
              <Input {...text('phone')} inputMode="tel" maxLength={30} placeholder="(11) 99999-0000" />
            </Field>
            <Field label="Instagram">
              <Input {...text('instagram')} maxLength={60} placeholder="@cliente" />
            </Field>
            <Field label="E-mail">
              <Input {...text('email')} type="email" maxLength={120} />
            </Field>
            <Field label="CPF ou CNPJ" hint="Só se precisar emitir nota ou recibo.">
              <Input {...text('document')} maxLength={20} />
            </Field>
          </div>
          <fieldset className="grid grid-cols-2 gap-4 sm:grid-cols-6">
            <legend className="mb-2 text-sm font-semibold">Endereço</legend>
            <Field label="Rua" className="col-span-2 sm:col-span-4">
              <Input {...text('address_street')} />
            </Field>
            <Field label="Número" className="sm:col-span-2">
              <Input {...text('address_number')} />
            </Field>
            <Field label="Complemento" className="sm:col-span-3">
              <Input {...text('address_complement')} />
            </Field>
            <Field label="Bairro" className="sm:col-span-3">
              <Input {...text('address_district')} />
            </Field>
            <Field label="Cidade" className="col-span-2 sm:col-span-3">
              <Input {...text('address_city')} />
            </Field>
            <Field label="UF">
              <Input {...text('address_state')} maxLength={2} className="uppercase" />
            </Field>
            <Field label="CEP" className="sm:col-span-2">
              <Input {...text('address_zip')} inputMode="numeric" maxLength={10} />
            </Field>
          </fieldset>
          <Field label="Observações">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} className="min-h-16" />
          </Field>
          <div className="space-y-1.5 rounded-lg bg-subtle p-3">
            <label className="flex items-start gap-2 text-sm font-medium text-ink">
              <Checkbox className="mt-0.5" checked={form.marketing_consent} onChange={(e) => set('marketing_consent', e.target.checked)} />
              Cliente autorizou receber novidades e promoções (WhatsApp, Instagram, e-mail)
            </label>
            <ConsentExplanation />
          </div>
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
