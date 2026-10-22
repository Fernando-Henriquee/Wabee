import { ArrowLeft, Minus, Plus, UserRound, UserRoundPlus, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EntityPicker, type PickerOption } from '@/components/shared/entity-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type OrderKind, ORDER_KIND_LABELS, ORDER_STATUS_LABELS, type OrderStatus, useCustomers } from '@/data/sales';
import { cn } from '@/lib/cn';
import { formatBRL, formatNumber } from '@/lib/money';
import { type CustomerChoice, initials, NO_CUSTOMER, photoUrl, STATUS_TONES } from './sales-utils';

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function OrderKindBadge({ kind }: { kind: OrderKind }) {
  return <Badge tone={kind === 'ENCOMENDA' ? 'accent' : 'neutral'}>{ORDER_KIND_LABELS[kind]}</Badge>;
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4" /> {children}
    </Link>
  );
}

/** Botões − / + grandes para o celular (alvos de 44 px no tamanho padrão). */
export function Stepper({
  value,
  onChange,
  min = 0,
  label,
  size = 'md',
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const box = size === 'sm' ? 'size-9' : 'size-11';
  return (
    <div className={cn('inline-flex items-center rounded-xl border border-line-strong bg-panel', className)} role="group" aria-label={`Quantidade de ${label}`}>
      <button
        type="button"
        className={cn(box, 'grid place-items-center rounded-l-xl text-ink-soft hover:bg-subtle active:bg-line disabled:opacity-40')}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Diminuir ${label}`}
      >
        <Minus className="size-4" />
      </button>
      <span className={cn('num min-w-9 text-center font-semibold', size === 'sm' ? 'text-sm' : 'text-base')} aria-live="polite">
        {formatNumber(value)}
      </span>
      <button
        type="button"
        className={cn(box, 'grid place-items-center rounded-r-xl text-ink-soft hover:bg-subtle active:bg-line')}
        onClick={() => onChange(value + 1)}
        aria-label={`Aumentar ${label}`}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

const THUMB_TONES = ['bg-accent-soft text-accent-ink', 'bg-info-soft text-info', 'bg-success-soft text-success', 'bg-subtle text-ink-soft', 'bg-warning-soft text-warning'];

/** Foto do produto ou iniciais (cor estável pelo nome). */
export function ProductThumb({ name, photoPath, className }: { name: string; photoPath?: string | null; className?: string }) {
  const url = photoUrl(photoPath);
  const tone = THUMB_TONES[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % THUMB_TONES.length];
  if (url) return <img src={url} alt="" loading="lazy" className={cn('rounded-lg object-cover', className)} />;
  return (
    <span aria-hidden className={cn('grid place-items-center rounded-lg font-display text-lg font-bold', tone, className)}>
      {initials(name)}
    </span>
  );
}

/** Grupo de opções exclusivas (radiogroup) com toque fácil. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-subtle p-1', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn('h-9 flex-1 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-ink', value === option.value && 'bg-panel text-ink shadow-sm')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Info({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

/** Linha de valores (rótulo à esquerda, valor à direita). */
export function ValueRow({ label, value, strong, muted, hint }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean; hint?: ReactNode }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1 text-sm', strong && 'text-base font-semibold', muted && 'text-muted')}>
      <span className="min-w-0">
        {label}
        {hint ? <span className="block text-xs font-normal text-muted">{hint}</span> : null}
      </span>
      <span className="num shrink-0 text-right">{value}</span>
    </div>
  );
}

/** Cadastro rápido no pedido (US-6.1): nome + telefone ou Instagram. */
export function NewCustomerDialog({
  open,
  initialName,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onSave: (choice: Extract<CustomerChoice, { kind: 'new' }>) => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [instagram, setInstagram] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Novo cliente"
        description="Só o nome e um contato. O resto pode ser completado depois em Clientes."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                onSave({ kind: 'new', name: name.trim(), phone, instagram });
                onOpenChange(false);
              }}
            >
              Usar este cliente
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
          </Field>
          <Field label="Telefone / WhatsApp">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(11) 99999-0000" maxLength={30} />
          </Field>
          <Field label="Instagram">
            <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@cliente" maxLength={60} />
          </Field>
          <p className="text-xs text-muted">O cadastro é criado junto com a venda.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cliente da venda: opcional, pesquisável, com cadastro na hora. */
export function CustomerField({ value, onChange, className }: { value: CustomerChoice; onChange: (choice: CustomerChoice) => void; className?: string }) {
  const customers = useCustomers();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const options = useMemo<PickerOption[]>(
    () =>
      (customers.data ?? [])
        .filter((c) => c.active && !c.anonymized_at)
        .map((c) => ({
          id: String(c.id),
          label: c.name,
          description: [c.phone, c.instagram, c.order_count > 0 ? `${c.order_count} pedido(s) · ${formatBRL(c.total_purchased)}` : null].filter(Boolean).join(' · ') || undefined,
          searchText: `${c.phone ?? ''} ${c.instagram ?? ''} ${c.email ?? ''}`,
        })),
    [customers.data],
  );
  const label = value.kind === 'none' ? null : value.name;
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-panel px-3 text-left text-sm hover:bg-subtle"
        >
          <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', !label && 'text-muted')}>{label ?? 'Sem cliente (opcional)'}</span>
          {value.kind === 'new' ? <Badge tone="accent">novo</Badge> : null}
        </button>
        {value.kind !== 'none' ? (
          <Button variant="ghost" size="icon" aria-label="Remover cliente" onClick={() => onChange(NO_CUSTOMER)}>
            <X />
          </Button>
        ) : (
          <Button variant="outline" size="icon" aria-label="Cadastrar cliente" title="Cadastrar cliente" onClick={() => setCreating('')}>
            <UserRoundPlus />
          </Button>
        )}
      </div>
      {value.kind === 'new' && (value.phone || value.instagram) ? <p className="mt-1 text-xs text-muted">{[value.phone, value.instagram].filter(Boolean).join(' · ')}</p> : null}
      <EntityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Cliente"
        loading={!customers.data}
        options={options}
        selectedId={value.kind === 'existing' ? String(value.id) : null}
        onSelect={(option) => onChange({ kind: 'existing', id: Number(option.id), name: option.label })}
        onCreate={(text) => setCreating(text)}
        createLabel={(text) => `Cadastrar “${text}”`}
        emptyText="Nenhum cliente encontrado. Digite o nome para cadastrar."
      />
      {creating !== null ? (
        <NewCustomerDialog key={creating} open initialName={creating} onOpenChange={(open) => !open && setCreating(null)} onSave={onChange} />
      ) : null}
    </div>
  );
}
