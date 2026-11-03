import { ImagePlus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/money-input';
import {
  LOST_REASON_LABELS,
  type LostReason,
  type QuoteInput,
  type QuoteRow,
  type QuoteSource,
  QUOTE_SOURCE_LABELS,
  useLogQuoteContact,
  useSaveQuote,
  useSetQuoteFollowUp,
  useSetQuoteStatus,
} from '@/data/quotes';
import { useCustomers } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { addDays, isValidISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { photoUrl } from '@/lib/photo-url';
import { removePhoto, uploadPhoto } from '@/lib/photos';
import { toNumber } from '@/lib/money';

const MAX_PHOTOS = 3;

interface NewPhoto {
  file: File;
  preview: string;
}

interface FormState {
  item_wanted: string;
  customer_id: string;
  contact_name: string;
  contact_phone: string;
  contact_instagram: string;
  source: QuoteSource | '';
  size_text: string;
  color_text: string;
  qty: string | null;
  desired_date: string;
  notes: string;
  reference_links: string;
}

function initialState(quote?: QuoteRow | null): FormState {
  return {
    item_wanted: quote?.item_wanted ?? '',
    customer_id: quote?.customer_id ? String(quote.customer_id) : '',
    contact_name: quote?.contact_name ?? '',
    contact_phone: quote?.contact_phone ?? '',
    contact_instagram: quote?.contact_instagram ?? '',
    source: quote?.source ?? '',
    size_text: quote?.size_text ?? '',
    color_text: quote?.color_text ?? '',
    qty: String(quote?.qty ?? 1),
    desired_date: quote?.desired_date ?? '',
    notes: quote?.notes ?? '',
    reference_links: quote?.reference_links ?? '',
  };
}

/**
 * Questionário do pedido de orçamento. Só "o que pediram" é obrigatório: dá para anotar em
 * segundos com o cliente na frente e completar depois.
 */
export function QuoteFormDialog({ quote, open, onOpenChange, onSaved }: { quote?: QuoteRow | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved?: (id: number) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <QuoteForm quote={quote} onClose={() => onOpenChange(false)} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function QuoteForm({ quote, onClose, onSaved }: { quote?: QuoteRow | null; onClose: () => void; onSaved?: (id: number) => void }) {
  const customers = useCustomers();
  const [form, setForm] = useState<FormState>(() => initialState(quote));
  const [keptPhotos, setKeptPhotos] = useState<string[]>(quote?.reference_photo_paths ?? []);
  const [newPhotos, setNewPhotos] = useState<NewPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const save = useSaveQuote((id) => {
    onClose();
    onSaved?.(id);
  });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const existingCustomer = Boolean(form.customer_id);
  const photoCount = keptPhotos.length + newPhotos.length;

  const addPhotos = (files: FileList | null) => {
    setError(null);
    const picked = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    const room = MAX_PHOTOS - photoCount;
    if (picked.length > room) setError(`Anexe no máximo ${MAX_PHOTOS} fotos de referência.`);
    setNewPhotos((list) => [...list, ...picked.slice(0, Math.max(room, 0)).map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };

  const removeNew = (preview: string) => {
    URL.revokeObjectURL(preview);
    setNewPhotos((list) => list.filter((p) => p.preview !== preview));
  };

  const submit = async () => {
    setError(null);
    if (!form.item_wanted.trim()) return setError('Escreva o que a pessoa pediu.');
    if (toNumber(form.qty) < 1) return setError('A quantidade precisa ser de pelo menos 1.');
    if (form.desired_date && !isValidISODate(form.desired_date)) return setError('Data desejada inválida.');
    let uploaded: string[] = [];
    try {
      setUploading(true);
      for (const photo of newPhotos) uploaded = [...uploaded, await uploadPhoto('quotes', photo.file)];
    } catch (e) {
      await Promise.all(uploaded.map((path) => removePhoto(path)));
      setUploading(false);
      return setError(describeError(e));
    }
    setUploading(false);
    const payload: QuoteInput = {
      id: quote?.id,
      item_wanted: form.item_wanted.trim(),
      customer_id: form.customer_id ? Number(form.customer_id) : null,
      contact_name: existingCustomer ? null : form.contact_name.trim() || null,
      contact_phone: existingCustomer ? null : form.contact_phone.trim() || null,
      contact_instagram: existingCustomer ? null : form.contact_instagram.trim() || null,
      source: form.source || null,
      size_text: form.size_text.trim() || null,
      color_text: form.color_text.trim() || null,
      qty: Math.max(1, Math.round(toNumber(form.qty))),
      desired_date: form.desired_date || null,
      notes: form.notes.trim() || null,
      reference_links: form.reference_links.trim() || null,
      reference_photo_paths: [...keptPhotos, ...uploaded],
    };
    save.mutate(payload, {
      onSuccess: () => {
        const removed = (quote?.reference_photo_paths ?? []).filter((path) => !keptPhotos.includes(path));
        void Promise.all(removed.map((path) => removePhoto(path)));
      },
      onError: (e) => {
        void Promise.all(uploaded.map((path) => removePhoto(path)));
        setError(describeError(e));
      },
    });
  };

  return (
    <DialogContent
      title={quote ? `Editar ${quote.number}` : 'Anotar pedido de orçamento'}
      description="Só o que pediram é obrigatório. O resto pode ser completado depois."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={save.isPending || uploading}>
            {quote ? 'Salvar alterações' : 'Anotar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="O que pediram?" required>
          <Input value={form.item_wanted} onChange={(e) => set('item_wanted', e.target.value)} maxLength={200} placeholder="Ex.: Moto 3D, chaveiro do time, vaso com nome" autoFocus />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Cliente cadastrado?" className="sm:col-span-2">
            <Select value={form.customer_id} onChange={(e) => set('customer_id', e.target.value)}>
              <option value="">Não, só anotar o contato</option>
              {(customers.data ?? [])
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          {existingCustomer ? null : (
            <>
              <Field label="Quem pediu">
                <Input value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} maxLength={120} placeholder="Nome ou como você conhece" />
              </Field>
              <Field label="WhatsApp / telefone">
                <Input value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} inputMode="tel" maxLength={30} placeholder="(11) 99999-0000" />
              </Field>
              <Field label="Instagram" className="sm:col-span-2">
                <Input value={form.contact_instagram} onChange={(e) => set('contact_instagram', e.target.value)} maxLength={60} placeholder="@cliente" />
              </Field>
            </>
          )}
        </div>

        <details className="rounded-xl border border-line px-3 py-2" open={Boolean(quote)}>
          <summary className="cursor-pointer text-sm font-medium text-ink-soft">Mais detalhes (tamanho, cor, prazo, referências)</summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Tamanho">
              <Input value={form.size_text} onChange={(e) => set('size_text', e.target.value)} maxLength={100} placeholder="Ex.: 20 cm de comprimento" />
            </Field>
            <Field label="Cor">
              <Input value={form.color_text} onChange={(e) => set('color_text', e.target.value)} maxLength={100} placeholder="Ex.: vermelha e preta" />
            </Field>
            <Field label="Quantidade">
              <DecimalInput decimals={0} value={form.qty} onValueChange={(v) => set('qty', v)} />
            </Field>
            <Field label="Prazo desejado">
              <Input type="date" value={form.desired_date} onChange={(e) => set('desired_date', e.target.value)} />
            </Field>
            <Field label="Onde pediu">
              <Select value={form.source} onChange={(e) => set('source', e.target.value as QuoteSource | '')}>
                <option value="">Não informado</option>
                {(Object.keys(QUOTE_SOURCE_LABELS) as QuoteSource[]).map((s) => (
                  <option key={s} value={s}>
                    {QUOTE_SOURCE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Link de referência">
              <Input value={form.reference_links} onChange={(e) => set('reference_links', e.target.value)} maxLength={1000} placeholder="Link de um modelo parecido" inputMode="url" />
            </Field>
            <Field label="Observações" className="sm:col-span-2">
              <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} className="min-h-16" placeholder="Para quem é, para quando, detalhes combinados…" />
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-ink">Fotos de referência</span>
              <ul className="flex flex-wrap gap-2">
                {keptPhotos.map((path) => (
                  <PhotoChip key={path} src={photoUrl(path)} label="Remover foto" onRemove={() => setKeptPhotos((list) => list.filter((p) => p !== path))} />
                ))}
                {newPhotos.map((photo) => (
                  <PhotoChip key={photo.preview} src={photo.preview} label="Remover foto" onRemove={() => removeNew(photo.preview)} />
                ))}
                {photoCount < MAX_PHOTOS ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="grid size-20 place-items-center rounded-xl border border-dashed border-line-strong bg-subtle text-muted hover:text-ink"
                      aria-label="Adicionar foto de referência"
                    >
                      <ImagePlus className="size-6" />
                    </button>
                  </li>
                ) : null}
              </ul>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-label="Escolher fotos de referência"
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
              <p className="text-xs text-muted">Até {MAX_PHOTOS} fotos do que o cliente mandou de exemplo.</p>
            </div>
          </div>
        </details>

        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </DialogContent>
  );
}

function PhotoChip({ src, label, onRemove }: { src: string | null; label: string; onRemove: () => void }) {
  return (
    <li className="relative size-20">
      {src ? <img src={src} alt="Foto de referência" className="size-20 rounded-xl border border-line object-cover" /> : <div className="size-20 rounded-xl bg-subtle" />}
      <button type="button" onClick={onRemove} aria-label={label} className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-ink text-brand-fg shadow">
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/** Atalhos de data: hoje + N dias. */
function DatePresets({ today, value, onChange }: { today: string; value: string; onChange: (date: string) => void }) {
  const presets = [
    { label: 'Amanhã', days: 1 },
    { label: '3 dias', days: 3 },
    { label: '1 semana', days: 7 },
    { label: '15 dias', days: 15 },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => {
        const date = addDays(today, p.days);
        return (
          <Button key={p.days} type="button" size="sm" variant={value === date ? 'primary' : 'outline'} onClick={() => onChange(date)}>
            {p.label}
          </Button>
        );
      })}
    </div>
  );
}

/** "Chamei": registra o contato e marca quando procurar de novo. */
export function ContactDialog({ quote, open, onOpenChange }: { quote: QuoteRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settings, today } = useMember();
  const [note, setNote] = useState('');
  const [next, setNext] = useState(() => addDays(today(), settings.quote_followup_days));
  const [error, setError] = useState<string | null>(null);
  const log = useLogQuoteContact(() => onOpenChange(false));
  const submit = () => {
    setError(null);
    if (!isValidISODate(next) || next < today()) return setError('Escolha uma data de hoje em diante para o próximo retorno.');
    log.mutate({ quoteId: quote.id, note, nextFollowUp: next }, { onError: (e) => setError(describeError(e)) });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Registrar contato"
        description={`${quote.item_wanted}${quote.display_name ? ` · ${quote.display_name}` : ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={log.isPending}>
              Registrar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="O que foi combinado?" hint="Opcional. Ex.: vai ver com a esposa, pediu desconto, ainda sem resposta.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} className="min-h-16" autoFocus />
          </Field>
          <Field label="Procurar de novo em">
            <Input type="date" min={today()} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <DatePresets today={today()} value={next} onChange={setNext} />
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

/** Adia (ou marca) o próximo retorno sem contar como contato. */
export function FollowUpDialog({ quote, open, onOpenChange }: { quote: QuoteRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settings, today } = useMember();
  const [date, setDate] = useState(() => (quote.follow_up_at && quote.follow_up_at > today() ? quote.follow_up_at : addDays(today(), settings.quote_followup_days)));
  const [error, setError] = useState<string | null>(null);
  const set = useSetQuoteFollowUp(() => onOpenChange(false));
  const submit = () => {
    setError(null);
    if (!isValidISODate(date) || date < today()) return setError('Escolha uma data de hoje em diante.');
    set.mutate({ quoteId: quote.id, date }, { onError: (e) => setError(describeError(e)) });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Marcar retorno"
        description={quote.item_wanted}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={set.isPending}>
              Marcar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Procurar de novo em">
            <Input type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
          </Field>
          <DatePresets today={today()} value={date} onChange={setDate} />
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

/** Encerra o orçamento como perdido, com o motivo (ele alimenta o aprendizado de por que não fecha). */
export function LostDialog({ quote, open, onOpenChange }: { quote: QuoteRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState<LostReason | ''>(quote.follow_up_count >= 3 ? 'SUMIU' : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lose = useSetQuoteStatus(() => onOpenChange(false));
  const submit = () => {
    setError(null);
    if (!reason) return setError('Escolha o motivo.');
    lose.mutate({ quoteId: quote.id, status: 'PERDIDO', reason, note }, { onError: (e) => setError(describeError(e)) });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Dar como perdido"
        description={`${quote.item_wanted}${quote.display_name ? ` · ${quote.display_name}` : ''}. Dá para reabrir depois.`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button variant="danger" onClick={submit} loading={lose.isPending}>
              Encerrar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {quote.follow_up_count > 0 ? <p className="text-sm text-muted">Você já procurou {quote.follow_up_count} {quote.follow_up_count === 1 ? 'vez' : 'vezes'}.</p> : null}
          <Field label="Por que não fechou?" required>
            <Select value={reason} onChange={(e) => setReason(e.target.value as LostReason | '')} autoFocus>
              <option value="">Escolha…</option>
              {(Object.keys(LOST_REASON_LABELS) as LostReason[]).map((r) => (
                <option key={r} value={r}>
                  {LOST_REASON_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Observação">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Opcional" />
          </Field>
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
