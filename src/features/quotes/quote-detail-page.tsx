import { ArrowLeft, CalendarClock, ClipboardCopy, Images, Link2, MessageCircle, MoreHorizontal, Pencil, PhoneCall, RotateCcw, Save, ShoppingBag, Send, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/page';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useItems } from '@/data/inventory';
import { useEquipmentOptions } from '@/data/products';
import {
  type QuoteAnalysis,
  type QuoteEvent,
  type QuoteRow,
  QUOTE_SOURCE_LABELS,
  useAddQuoteNote,
  useAnalyzeQuote,
  useQuote,
  useQuoteEvents,
  useSaveQuoteProposal,
  useSendQuote,
  useSetQuoteStatus,
} from '@/data/quotes';
import { type CustomItemInput, useCreateCustomItem, usePreviewCustomItem } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { useDebounced } from '@/features/production/use-now';
import { CostBreakdown, DurationInput } from '@/features/products/bits';
import { emptyMaterialRow, type MaterialRow } from '@/features/sales/material-rows';
import { MaterialSection } from '@/features/sales/material-section';
import { type CustomerChoice, NO_CUSTOMER, type OrderPrefill, whatsappLink } from '@/features/sales/sales-utils';
import { describeError } from '@/lib/errors';
import { formatDateBR, formatDateTimeBR, isValidISODate } from '@/lib/dates';
import { formatBRL, toNumber } from '@/lib/money';
import { photoUrl } from '@/lib/photo-url';
import { removePhoto } from '@/lib/photos';
import { canShareFiles } from '@/lib/share-images';
import { useRequestId } from '@/lib/use-request-id';
import { ProposalPhotosField } from './proposal-photos';
import { useProposalPhotos } from './use-proposal-photos';
import { ContactDialog, FollowUpDialog, LostDialog, QuoteFormDialog } from './quote-dialogs';
import { ContactButtons, FollowUpText, QuoteStatusBadge } from './quote-bits';
import { lostReasonText, quoteSummary } from './quote-utils';
import { followUpTemplates, proposalMessage, quoteMessageContext } from './quote-messages';

type Dialog = 'edit' | 'contact' | 'follow-up' | 'lost' | null;

export function QuoteDetailPage() {
  const { id } = useParams();
  const quoteId = id ? Number(id) : undefined;
  const quote = useQuote(quoteId);
  if (quote.isError) return <Page><ErrorState error={quote.error} onRetry={() => void quote.refetch()} /></Page>;
  if (quote.data === undefined) return <Page><LoadingBlock /></Page>;
  if (!quote.data) {
    return (
      <Page>
        <EmptyState title="Orçamento não encontrado" action={<Button asChild><Link to="/orcamentos">Voltar para orçamentos</Link></Button>} />
      </Page>
    );
  }
  return <QuoteDetail quote={quote.data} />;
}

function QuoteDetail({ quote }: { quote: QuoteRow }) {
  const { can, settings, today } = useMember();
  const write = can('write') && quote.is_open;
  const [dialog, setDialog] = useState<Dialog>(null);
  const reopen = useSetQuoteStatus();
  const templates = followUpTemplates(quoteMessageContext(quote, settings.company_name, null));
  const summary = quoteSummary(quote);

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/orcamentos" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Orçamentos
          </Link>
        }
        title={quote.item_wanted}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {quote.number} <QuoteStatusBadge status={quote.status} />
            {quote.source ? <span>{QUOTE_SOURCE_LABELS[quote.source]}</span> : null}
            <FollowUpText quote={quote} today={today()} />
          </span>
        }
        actions={
          <>
            <ContactButtons phone={quote.phone} instagram={quote.instagram} text={templates[0]?.text} size="md" />
            {write ? (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Mais ações">
                    <MoreHorizontal />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => setDialog('contact')}>
                    <PhoneCall /> Registrar contato
                  </MenuItem>
                  <MenuItem onSelect={() => setDialog('follow-up')}>
                    <CalendarClock /> Marcar retorno
                  </MenuItem>
                  <MenuItem onSelect={() => setDialog('edit')}>
                    <Pencil /> Editar pedido
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem tone="danger" onSelect={() => setDialog('lost')}>
                    <XCircle /> Dar como perdido
                  </MenuItem>
                </MenuContent>
              </Menu>
            ) : null}
          </>
        }
      />

      {!quote.is_open ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          {quote.status === 'GANHO' ? (
            <span>
              Este orçamento virou pedido{' '}
              {quote.order_id ? (
                <Link to={`/vendas/${quote.order_id}`} className="font-medium underline underline-offset-2">
                  {quote.order_number}
                </Link>
              ) : null}
              .
            </span>
          ) : (
            <span>
              Perdido: <strong>{lostReasonText(quote)}</strong>
              {quote.lost_note ? ` · ${quote.lost_note}` : ''}
            </span>
          )}
          {quote.status === 'PERDIDO' && can('write') ? (
            <Button
              size="sm"
              variant="outline"
              loading={reopen.isPending}
              onClick={() => reopen.mutate({ quoteId: quote.id, status: quote.quoted_unit_price !== null ? 'PROPOSTA_ENVIADA' : 'EM_ANALISE' })}
            >
              <RotateCcw /> Reabrir
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <RequestCard quote={quote} summary={summary} onEdit={write ? () => setDialog('edit') : undefined} />
          {quote.is_open || quote.analysis ? <Workbench key={quote.updated_at} quote={quote} write={write} /> : null}
        </div>
        <aside className="space-y-5">
          {write ? <NextStepCard quote={quote} today={today()} onContact={() => setDialog('contact')} onFollowUp={() => setDialog('follow-up')} /> : null}
          <TimelineCard quote={quote} write={write} />
        </aside>
      </div>

      {dialog === 'edit' ? <QuoteFormDialog quote={quote} open onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === 'contact' ? <ContactDialog quote={quote} open onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === 'follow-up' ? <FollowUpDialog quote={quote} open onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === 'lost' ? <LostDialog quote={quote} open onOpenChange={(open) => !open && setDialog(null)} /> : null}
    </Page>
  );
}

function RequestCard({ quote, summary, onEdit }: { quote: QuoteRow; summary: string; onEdit?: () => void }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Quem pediu', quote.customer_id ? <Link key="c" to={`/clientes/${quote.customer_id}`} className="underline underline-offset-2">{quote.display_name}</Link> : (quote.display_name ?? '—')],
    ['Contato', [quote.phone, quote.instagram ? `@${quote.instagram.replace(/^@/, '')}` : null].filter(Boolean).join(' · ') || '—'],
    ['Tamanho', quote.size_text ?? '—'],
    ['Cor', quote.color_text ?? '—'],
    ['Quantidade', String(quote.qty)],
    ['Prazo desejado', quote.desired_date ? formatDateBR(quote.desired_date) : '—'],
  ];
  return (
    <Card>
      <CardHeader
        title="Pedido do cliente"
        description={summary || undefined}
        actions={
          onEdit ? (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil /> Editar
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-3 p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {quote.notes ? <p className="whitespace-pre-line rounded-lg bg-subtle px-3 py-2 text-sm">{quote.notes}</p> : null}
        {quote.reference_links ? (
          <p className="flex items-start gap-1.5 text-sm">
            <Link2 className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 break-words">
              {/^https?:\/\//i.test(quote.reference_links) ? (
                <a href={quote.reference_links} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {quote.reference_links}
                </a>
              ) : (
                quote.reference_links
              )}
            </span>
          </p>
        ) : null}
        {quote.reference_photo_paths.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Fotos de referência">
            {quote.reference_photo_paths.map((path) => (
              <li key={path}>
                <a href={photoUrl(path) ?? undefined} target="_blank" rel="noopener noreferrer">
                  <img src={photoUrl(path) ?? undefined} alt="Foto de referência" loading="lazy" className="size-24 rounded-xl border border-line object-cover" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

interface AnalysisForm {
  name: string;
  filaments: MaterialRow[];
  components: MaterialRow[];
  minutes: number;
  unitsPerPlate: string | null;
  equipmentId: number | null;
}

/** Análise (ficha e custo) e proposta: o preço sugerido da análise alimenta o preço da proposta. */
function Workbench({ quote, write }: { quote: QuoteRow; write: boolean }) {
  const filaments = useItems({ kind: 'FILAMENT' });
  const components = useItems({ kind: 'COMPONENT' });
  if (!filaments.data || !components.data) return <Card><div className="p-4"><LoadingBlock rows={3} /></div></Card>;
  const filamentIds = new Set(filaments.data.map((i) => i.id));
  const rowsFor = (lines: QuoteAnalysis['lines'], keep: (id: number) => boolean): MaterialRow[] =>
    lines.filter((l) => keep(l.item_id)).map((l) => ({ ...emptyMaterialRow(), itemId: l.item_id, qty: String(l.qty_per_unit) }));
  const analysis = quote.analysis;
  const initial: AnalysisForm = {
    name: analysis?.name ?? quote.item_wanted,
    filaments: analysis ? rowsFor(analysis.lines, (id) => filamentIds.has(id)) : [emptyMaterialRow()],
    components: analysis ? rowsFor(analysis.lines, (id) => !filamentIds.has(id)) : [],
    minutes: Math.round(analysis?.est_print_minutes_per_plate ?? 0),
    unitsPerPlate: String(analysis?.units_per_plate ?? 1),
    equipmentId: analysis?.default_equipment_id ?? null,
  };
  if (initial.filaments.length === 0) initial.filaments = [emptyMaterialRow()];
  return <WorkbenchForm quote={quote} write={write} initial={initial} filamentItems={filaments.data} componentItems={components.data} />;
}

function WorkbenchForm({
  quote,
  write,
  initial,
  filamentItems,
  componentItems,
}: {
  quote: QuoteRow;
  write: boolean;
  initial: AnalysisForm;
  filamentItems: NonNullable<ReturnType<typeof useItems>['data']>;
  componentItems: NonNullable<ReturnType<typeof useItems>['data']>;
}) {
  const { can, settings, today } = useMember();
  const navigate = useNavigate();
  const showCosts = can('costs');
  const equipment = useEquipmentOptions();
  const [form, setForm] = useState<AnalysisForm>(initial);
  const [price, setPrice] = useState<string | null>(quote.quoted_unit_price === null ? null : String(quote.quoted_unit_price));
  const [validUntil, setValidUntil] = useState(quote.valid_until ?? '');
  const [description, setDescription] = useState(quote.proposal_description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const photos = useProposalPhotos(quote.proposal_photo_paths ?? []);
  const [requestId, renew] = useRequestId();
  const set = <K extends keyof AnalysisForm>(key: K, value: AnalysisForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const lines = [...form.filaments, ...form.components]
    .filter((r) => r.itemId && toNumber(r.qty) > 0)
    .map((r) => ({ item_id: r.itemId!, qty_per_unit: r.qty! }));
  const unitsPerPlate = Math.max(1, Math.floor(toNumber(form.unitsPerPlate)) || 1);
  const analysis: QuoteAnalysis = {
    name: form.name.trim() || quote.item_wanted,
    units_per_plate: unitsPerPlate,
    est_print_minutes_per_plate: form.minutes > 0 ? form.minutes : null,
    default_equipment_id: form.equipmentId,
    lines,
  };
  const dirty = JSON.stringify(analysis) !== JSON.stringify({ ...(quote.analysis ?? {}), lines: quote.analysis?.lines.map((l) => ({ item_id: l.item_id, qty_per_unit: String(l.qty_per_unit) })) ?? [] }) && (lines.length > 0 || form.minutes > 0);

  const previewKey = useDebounced(
    showCosts && lines.length > 0 && form.minutes > 0
      ? JSON.stringify({ lines, units_per_plate: unitsPerPlate, est_print_minutes_per_plate: form.minutes, default_equipment_id: form.equipmentId, channel_id: settings.default_channel_id })
      : '',
  );
  const previewInput = useMemo(() => (previewKey ? ({ name: 'Orçamento', ...JSON.parse(previewKey) } as CustomItemInput) : null), [previewKey]);
  const preview = usePreviewCustomItem(previewInput);
  const suggested = preview.data?.suggested_price ?? null;

  const saveAnalysis = useAnalyzeQuote();
  const send = useSendQuote();
  const saveProposal = useSaveQuoteProposal();
  const createItem = useCreateCustomItem();

  const priceNumber = toNumber(price);
  const message = proposalMessage({
    ...quoteMessageContext(quote, settings.company_name, settings.pix_key ? { key: settings.pix_key, type: settings.pix_key_type, holder: settings.pix_holder ?? settings.company_name } : null),
    description: description.trim() || null,
    unitPrice: priceNumber > 0 ? priceNumber : null,
    validUntil: validUntil || null,
  });
  const phone = quote.phone;
  const analysisReady = lines.length > 0 && form.minutes > 0 && lines.some((l) => filamentItems.some((f) => f.id === l.item_id));

  const validateProposal = (): string | null => {
    if (priceNumber <= 0) return 'Informe o preço por peça.';
    if (validUntil && (!isValidISODate(validUntil) || validUntil < today())) return 'A validade da proposta precisa ser de hoje em diante.';
    return null;
  };

  const savedPaths = quote.proposal_photo_paths ?? [];
  const proposalDirty =
    (priceNumber > 0 ? priceNumber : 0) !== (quote.quoted_unit_price ?? 0) ||
    validUntil !== (quote.valid_until ?? '') ||
    description.trim() !== (quote.proposal_description ?? '') ||
    photos.dirty(savedPaths);

  /** Envia as imagens novas e grava a proposta (registrando o envio, ou só guardando o valor combinado). */
  const persistProposal = async (mode: 'send' | 'draft') => {
    setError(null);
    setUploading(true);
    let result: Awaited<ReturnType<typeof photos.upload>>;
    try {
      result = await photos.upload();
    } catch (e) {
      setUploading(false);
      return setError(describeError(e));
    }
    setUploading(false);
    const { paths, uploaded } = result;
    const common = { quoteId: quote.id, validUntil: validUntil || null, description: description.trim() || null, photoPaths: paths };
    const options = {
      onSuccess: () => void Promise.all(savedPaths.filter((p) => !paths.includes(p)).map((p) => removePhoto(p))),
      onError: (e: Error) => {
        void Promise.all(uploaded.map((p) => removePhoto(p)));
        setError(describeError(e));
      },
    };
    if (mode === 'send') send.mutate({ ...common, unitPrice: String(price) }, options);
    else saveProposal.mutate({ ...common, unitPrice: priceNumber > 0 ? String(price) : null }, options);
  };

  const registerSend = () => void persistProposal('send');

  const saveDraft = () => {
    if (validUntil && validUntil !== quote.valid_until && (!isValidISODate(validUntil) || validUntil < today())) return setError('A validade da proposta precisa ser de hoje em diante.');
    void persistProposal('draft');
  };

  const saving = uploading || send.isPending || saveProposal.isPending;

  /** Celular: abre o menu de compartilhar com as imagens e o texto juntos (o dono escolhe o WhatsApp e a conversa). */
  const shareWithPhotos = async () => {
    setError(null);
    const problem = validateProposal();
    if (problem) return setError(problem);
    if (!photos.allReady) return setError('As imagens ainda estão carregando. Tente de novo em um instante.');
    try {
      await navigator.share({ files: photos.files, text: message });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      return setError('Não foi possível abrir o compartilhamento. Baixe ou copie as imagens e cole na conversa.');
    }
    registerSend();
  };

  const sendWhatsApp = () => {
    setError(null);
    const problem = validateProposal();
    if (problem) return setError(problem);
    const link = whatsappLink(phone, message);
    if (!link) return setError('Anote o WhatsApp do cliente para abrir a conversa (ou copie o texto).');
    // Abre antes de gravar: abrir depois de uma espera é bloqueado pelo navegador no celular.
    window.open(link, '_blank', 'noopener,noreferrer');
    registerSend();
  };

  const copyText = async () => {
    setError(null);
    const problem = validateProposal();
    if (problem) return setError(problem);
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Texto copiado. É só colar na conversa.');
    } catch {
      return setError('Não foi possível copiar. Selecione o texto abaixo e copie.');
    }
    registerSend();
  };

  const customer: CustomerChoice = quote.customer_id
    ? { kind: 'existing', id: quote.customer_id, name: quote.display_name ?? 'Cliente' }
    : quote.display_name
      ? { kind: 'new', name: quote.display_name, phone: quote.contact_phone ?? '', instagram: quote.contact_instagram ?? '' }
      : NO_CUSTOMER;

  const goToOrder = (line: OrderPrefill['lines'][number]) =>
    navigate('/vendas/nova', {
      state: { prefill: { kind: 'ENCOMENDA', customer, lines: [line], quoteId: quote.id, reason: `Orçamento ${quote.number}` } satisfies OrderPrefill },
    });

  const turnIntoOrder = () => {
    setError(null);
    if (priceNumber <= 0) return setError('Informe o preço por peça antes de virar pedido.');
    const unitPrice = String(price);
    if (!analysisReady) {
      // Sem ficha, o pedido leva uma linha avulsa (não vai para a produção).
      const detail = quoteSummary(quote);
      return goToOrder({ customDescription: `${quote.item_wanted}${detail ? ` (${detail})` : ''}`, qty: String(quote.qty), unitPrice, isGift: false });
    }
    createItem.mutate(
      {
        requestId,
        item: {
          name: analysis.name ?? quote.item_wanted,
          channel_id: settings.default_channel_id,
          units_per_plate: unitsPerPlate,
          est_print_minutes_per_plate: form.minutes,
          default_equipment_id: form.equipmentId,
          unit_price: unitPrice,
          lines,
        },
      },
      {
        onSuccess: (r) => {
          renew();
          goToOrder({ variantId: r.variant_id, qty: String(quote.qty), unitPrice, isGift: false, label: analysis.name ?? quote.item_wanted, estCost: toNumber(r.unit_cost) });
        },
        onError: (e) => setError(describeError(e)),
      },
    );
  };

  return (
    <>
      <Card>
        <CardHeader
          title="Análise"
          description="Filamento, gramas e horas de impressão. Calcula o custo e o preço sugerido; não cria produto no catálogo."
          actions={
            write ? (
              <Button
                size="sm"
                variant={dirty ? 'primary' : 'outline'}
                loading={saveAnalysis.isPending}
                disabled={!dirty}
                onClick={() => saveAnalysis.mutate({ quoteId: quote.id, analysis: { ...analysis, channel_id: settings.default_channel_id } }, { onError: (e) => setError(describeError(e)) })}
              >
                <Save /> Salvar análise
              </Button>
            ) : undefined
          }
        />
        <fieldset disabled={!write} className="space-y-5 p-4">
          <Field label="Nome da peça" hint="Como vai aparecer no pedido e na produção.">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
          </Field>
          <MaterialSection
            title="Filamentos (gramas por peça)"
            addLabel="Filamento"
            rows={form.filaments}
            onChange={(rows) => set('filaments', rows)}
            items={filamentItems}
            unit="g"
            emptyHint="Cadastre filamentos em Estoque → Novo item."
          />
          <MaterialSection title="Componentes por peça (opcional)" addLabel="Componente" rows={form.components} onChange={(rows) => set('components', rows)} items={componentItems} unit="un" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Tempo de impressão da mesa" className="sm:col-span-2">
              <DurationInput value={form.minutes} onChange={(minutes) => set('minutes', minutes)} />
            </Field>
            <Field label="Peças por mesa">
              <DecimalInput decimals={0} value={form.unitsPerPlate} onValueChange={(v) => set('unitsPerPlate', v)} />
            </Field>
            <Field label="Impressora" hint="Define a taxa de custo por hora. Em branco: a primeira impressora ativa." className="sm:col-span-3">
              <Select value={form.equipmentId ?? ''} onChange={(e) => set('equipmentId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Padrão</option>
                {(equipment.data ?? [])
                  .filter((e) => e.kind === 'PRINTER' && e.status !== 'BAIXADO')
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
        </fieldset>
        {showCosts ? (
          <section className="space-y-2 border-t border-line p-4" aria-label="Custo estimado">
            <h3 className="text-sm font-semibold">Custo por peça</h3>
            {lines.length === 0 || form.minutes <= 0 ? (
              <p className="text-sm text-muted">Informe o filamento (gramas) e o tempo de impressão para ver o custo.</p>
            ) : (
              <>
                <CostBreakdown estimate={preview.data?.estimate} loading={preview.isFetching} unitsPerPlate={unitsPerPlate} />
                {suggested !== null ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span>
                      Preço sugerido: <Money value={suggested} className="font-semibold" />{' '}
                      <span className="text-xs text-muted">(margem alvo {Math.round(toNumber(preview.data?.margin_target_pct) * 100)}%)</span>
                    </span>
                    {write && String(suggested) !== price ? (
                      <Button size="sm" variant="outline" onClick={() => setPrice(String(suggested))}>
                        Usar na proposta
                      </Button>
                    ) : null}
                  </p>
                ) : preview.data ? (
                  <p className="text-xs text-warning">Margem alvo impossível com as taxas deste canal.</p>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Proposta"
          description={quote.quoted_at ? `Última proposta registrada em ${formatDateBR(quote.quoted_at.slice(0, 10))}.` : 'Valor combinado, validade, imagens e o texto que vai para o cliente.'}
          actions={
            write ? (
              <Button size="sm" variant={proposalDirty ? 'primary' : 'outline'} loading={saving} disabled={!proposalDirty} onClick={saveDraft}>
                <Save /> Salvar valor combinado
              </Button>
            ) : undefined
          }
        />
        <fieldset disabled={!write} className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={quote.qty > 1 ? 'Valor da venda combinado (por peça)' : 'Valor da venda combinado'} hint={suggested !== null && price === null ? `Sugerido: ${formatBRL(suggested)}` : undefined}>
              <MoneyInput value={price} onValueChange={setPrice} placeholder={suggested !== null ? formatBRL(suggested) : 'R$'} />
            </Field>
            <Field label="Válida até">
              <Input type="date" min={today()} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
            {quote.qty > 1 && priceNumber > 0 ? (
              <p className="text-sm sm:col-span-2">
                {quote.qty} peças = <strong className="num">{formatBRL(Math.round(priceNumber * quote.qty * 100) / 100)}</strong>
              </p>
            ) : null}
          </div>
          <ProposalPhotosField photos={photos} name={quote.number} editable={write} />
          <Field label="Descrição para o cliente" hint="Material, acabamento, o que está incluso. Tamanho, cor e quantidade entram sozinhos.">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} className="min-h-20" placeholder="Ex.: Moto esportiva em PLA, acabamento liso, pintura não inclusa." />
          </Field>
          <Field label="Texto da mensagem" hint={`Atualiza sozinho com o valor combinado e os dados acima. ${settings.pix_key ? 'Já inclui o PIX cadastrado em Configurações.' : 'Cadastre a chave PIX em Configurações para ela entrar no texto.'}`}>
            <Textarea value={message} readOnly className="min-h-44 bg-subtle text-sm" onFocus={(e) => e.currentTarget.select()} />
          </Field>
          {!settings.pix_key ? (
            <p className="text-xs text-warning">
              Sem chave PIX: a proposta sai sem o bloco de pagamento.{' '}
              {can('settings') ? (
                <Link to="/configuracoes/empresa" className="underline underline-offset-2">
                  Cadastrar agora
                </Link>
              ) : null}
            </p>
          ) : null}
        </fieldset>
        {error ? (
          <p role="alert" className="mx-4 mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {write ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <Button onClick={sendWhatsApp} loading={saving} disabled={!phone} title={phone ? undefined : 'Anote o WhatsApp do cliente'}>
              <MessageCircle /> {quote.status === 'PROPOSTA_ENVIADA' ? 'Reenviar pelo WhatsApp' : 'Enviar pelo WhatsApp'}
            </Button>
            {canShareFiles(photos.files) ? (
              <Button variant="outline" onClick={() => void shareWithPhotos()} disabled={saving}>
                <Images /> Enviar com imagens
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void copyText()} disabled={saving}>
              <ClipboardCopy /> Copiar texto
            </Button>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setError(null);
                const problem = validateProposal();
                if (problem) return setError(problem);
                registerSend();
              }}
            >
              <Send /> Só registrar o envio
            </Button>
            <span className="flex-1" />
            <Button variant="accent" onClick={turnIntoOrder} loading={createItem.isPending}>
              <ShoppingBag /> Virar pedido
            </Button>
          </div>
        ) : null}
        {write && !analysisReady ? <p className="border-t border-line px-4 py-2 text-xs text-muted">Sem a análise completa (filamento e tempo), o pedido leva uma linha avulsa e não vai para a produção.</p> : null}
      </Card>
    </>
  );
}

function NextStepCard({ quote, today, onContact, onFollowUp }: { quote: QuoteRow; today: string; onContact: () => void; onFollowUp: () => void }) {
  return (
    <Card>
      <CardHeader title="Retomada" description="Quando procurar o cliente de novo." />
      <div className="space-y-3 p-4 text-sm">
        {quote.follow_up_at ? (
          <p>
            Próximo retorno: <strong>{formatDateBR(quote.follow_up_at)}</strong>
            <br />
            <FollowUpText quote={quote} today={today} />
          </p>
        ) : (
          <p className="text-muted">Sem retorno marcado. Ele é marcado ao enviar a proposta ou ao registrar um contato.</p>
        )}
        <p className="text-xs text-muted">
          {quote.follow_up_count === 0 ? 'Nenhum retorno registrado ainda.' : `${quote.follow_up_count} ${quote.follow_up_count === 1 ? 'retorno registrado' : 'retornos registrados'}.`}
          {quote.last_contact_at ? ` Última conversa em ${formatDateBR(quote.last_contact_at.slice(0, 10))}.` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onContact}>
            <PhoneCall /> Chamei
          </Button>
          <Button size="sm" variant="outline" onClick={onFollowUp}>
            <CalendarClock /> Marcar retorno
          </Button>
        </div>
      </div>
    </Card>
  );
}

const EVENT_LABELS: Record<QuoteEvent['kind'], string> = { NOTA: 'Anotação', CONTATO: 'Contato', STATUS: 'Status', PRECO: 'Proposta' };

function TimelineCard({ quote, write }: { quote: QuoteRow; write: boolean }) {
  const { settings } = useMember();
  const events = useQuoteEvents(quote.id);
  const [text, setText] = useState('');
  const add = useAddQuoteNote(() => setText(''));
  return (
    <Card>
      <CardHeader title="Linha do tempo" />
      <div className="space-y-3 p-4">
        {write ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) add.mutate({ quoteId: quote.id, text });
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Anotar algo…" aria-label="Nova anotação" />
            <Button type="submit" variant="outline" loading={add.isPending} disabled={!text.trim()}>
              Anotar
            </Button>
          </form>
        ) : null}
        {events.isError ? (
          <ErrorState error={events.error} />
        ) : !events.data ? (
          <LoadingBlock rows={2} />
        ) : (
          <ol className="space-y-3">
            {events.data.map((e) => (
              <li key={e.id} className="text-sm">
                <p className="flex items-center gap-2 text-xs text-muted">
                  <Badge tone={e.kind === 'CONTATO' ? 'info' : e.kind === 'PRECO' ? 'accent' : 'neutral'}>{EVENT_LABELS[e.kind]}</Badge>
                  {formatDateTimeBR(e.created_at, settings.timezone)}
                </p>
                <p className="mt-0.5 whitespace-pre-line">{e.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
