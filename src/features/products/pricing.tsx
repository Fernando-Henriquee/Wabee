import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Money } from '@/components/shared/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type ChannelPricing, useChannelPrices, useSetChannelPrice, useVariantPricing, type VariantRow } from '@/data/products';
import { useMember } from '@/features/member/member-context';
import { unitContributionMargin } from '@/lib/calc';
import { formatDateBR } from '@/lib/dates';
import { formatBRL, formatPercent, toNumber } from '@/lib/money';

/** Preços por canal, margem unitária, margem por hora de máquina e preço sugerido (US-4.5, RN-13, RN-15, RN-17). */
export function ChannelPricingCard({ variant }: { variant: VariantRow }) {
  const { can, settings } = useMember();
  const pricing = useVariantPricing(variant.id);
  const history = useChannelPrices(variant.id);
  const [editing, setEditing] = useState<{ pricing: ChannelPricing; suggested: boolean } | null>(null);
  const canApply = (c: ChannelPricing) => c.suggested_price !== null && toNumber(c.suggested_price) !== toNumber(c.price);
  // Abre o diálogo já com o sugerido: o preço só muda depois de conferir a margem e salvar.
  const applySuggested = (c: ChannelPricing) => setEditing({ pricing: c, suggested: true });

  if (pricing.isError) return <ErrorState error={pricing.error} onRetry={() => void pricing.refetch()} />;
  if (!pricing.data) return <LoadingBlock rows={3} />;
  const data = pricing.data;
  const channelName = (id: number) => data.channels.find((c) => c.channel_id === id)?.channel_name ?? `Canal ${id}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Preço e margem por canal"
          description={`Custo de referência ${data.unit_cost === null ? '—' : formatBRL(data.unit_cost)} por unidade (custo médio em estoque ou, sem estoque, o estimado pela ficha). Margem alvo ${formatPercent(data.margin_target_pct)}.`}
        />
        {data.channels.length === 0 ? (
          <EmptyState className="m-4" title="Nenhum canal ativo" description="Ative ou cadastre canais em Configurações → Canais e taxas." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-subtle text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Canal</th>
                    <th className="px-3 py-2 text-right font-medium">Preço</th>
                    <th className="px-3 py-2 text-right font-medium">Taxas</th>
                    <th className="px-3 py-2 text-right font-medium">Embalagem</th>
                    <th className="px-3 py-2 text-right font-medium">Margem unit.</th>
                    <th className="px-3 py-2 text-right font-medium" title="Margem de contribuição por hora de impressora">Por hora de máquina</th>
                    <th className="px-3 py-2 text-right font-medium">Preço sugerido</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.channels.map((c) => (
                    <tr key={c.channel_id} className={toNumber(c.contribution_margin) < 0 ? 'bg-danger-soft/60' : undefined}>
                      <td className="px-3 py-2.5 font-medium">{c.channel_name}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Money value={c.price} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted" title={`${formatPercent(c.fee_pct)} do canal + ${formatPercent(c.payment_fee_pct)} de pagamento + ${formatBRL(c.fee_fixed)} fixo${toNumber(c.tax) > 0 ? ` + ${formatBRL(c.tax)} de imposto` : ''}`}>
                        <Money value={toNumber(c.fees) + toNumber(c.tax)} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        <Money value={c.packaging} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <MarginCell pricing={c} target={settings.margin_target_pct} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {c.margin_per_machine_hour === null ? <span className="text-muted">—</span> : <Money value={c.margin_per_machine_hour} estimated hint="Margem unitária ÷ horas de máquina por unidade (média das últimas impressões ou a ficha)" />}
                      </td>
                      <td className="px-3 py-2.5 text-right">{c.suggested_price === null ? <span className="text-xs text-muted">margem impossível</span> : <Money value={c.suggested_price} />}</td>
                      <td className="px-3 py-2.5 text-right">
                        {can('write') ? (
                          <span className="inline-flex gap-1">
                            {canApply(c) ? (
                              <Button size="sm" variant="outline" onClick={() => applySuggested(c)}>
                                Aplicar sugerido
                              </Button>
                            ) : null}
                            <Button size="sm" variant="ghost" onClick={() => setEditing({ pricing: c, suggested: false })}>
                              <Pencil /> Preço
                            </Button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {data.channels.map((c) => (
                <li key={c.channel_id} className={toNumber(c.contribution_margin) < 0 ? 'space-y-1.5 bg-danger-soft/60 px-4 py-3' : 'space-y-1.5 px-4 py-3'}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{c.channel_name}</span>
                    <Money value={c.price} className="text-sm font-semibold" />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span>
                      Margem <MarginCell pricing={c} target={settings.margin_target_pct} />
                    </span>
                    <span>Sugerido {c.suggested_price === null ? '—' : formatBRL(c.suggested_price)}</span>
                  </div>
                  {can('write') ? (
                    <div className="flex gap-2">
                      {canApply(c) ? (
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => applySuggested(c)}>
                          Aplicar sugerido
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditing({ pricing: c, suggested: false })}>
                        <Pencil /> Alterar preço
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Margem unitária = preço − custo − taxas do canal e do pagamento − embalagem − imposto. Preço sugerido = (custo + embalagem + taxa fixa) ÷ (1 − taxas − imposto − margem alvo).
        </p>
      </Card>

      {history.data && history.data.length > 0 ? (
        <Card>
          <CardHeader title="Histórico de preços dos canais" />
          <ul className="divide-y divide-line text-sm">
            {history.data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span>
                  {channelName(h.channel_id)}
                  <span className="block text-xs text-muted">
                    {formatDateBR(h.valid_from)} {h.valid_to ? `a ${formatDateBR(h.valid_to)}` : 'em diante'}
                  </span>
                </span>
                <span className="inline-flex items-center gap-2">
                  {h.valid_to === null ? <Badge tone="success">vigente</Badge> : null}
                  <Money value={h.price} className="font-medium" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {editing ? (
        <ChannelPriceDialog variant={variant} pricing={editing.pricing} useSuggested={editing.suggested} unitCost={data.unit_cost} onOpenChange={(open) => !open && setEditing(null)} />
      ) : null}
    </div>
  );
}

function MarginCell({ pricing, target }: { pricing: ChannelPricing; target: number }) {
  if (pricing.contribution_margin === null) return <span className="text-muted">—</span>;
  const low = pricing.contribution_margin_pct !== null && toNumber(pricing.contribution_margin_pct) < toNumber(target);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Money value={pricing.contribution_margin} signed />
      {pricing.contribution_margin_pct !== null ? <span className={low ? 'text-xs font-medium text-warning' : 'text-xs text-muted'}>({formatPercent(pricing.contribution_margin_pct)})</span> : null}
    </span>
  );
}

function ChannelPriceDialog({
  variant,
  pricing,
  unitCost,
  useSuggested,
  onOpenChange,
}: {
  variant: VariantRow;
  pricing: ChannelPricing;
  unitCost: number | null;
  useSuggested?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { today, settings } = useMember();
  const initial = useSuggested && pricing.suggested_price !== null ? pricing.suggested_price : pricing.price;
  const [price, setPrice] = useState<string | null>(initial === null ? null : String(initial));
  const [validFrom, setValidFrom] = useState(today());
  const save = useSetChannelPrice(() => onOpenChange(false));
  const taxPct = settings.tax_regime === 'SIMPLES' ? settings.sales_tax_pct : 0;
  const margin =
    price === null
      ? null
      : unitContributionMargin({ price, unitCost, packaging: pricing.packaging, feeFixed: pricing.fee_fixed, feePct: pricing.fee_pct, paymentFeePct: pricing.payment_fee_pct, taxPct });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`Preço em ${pricing.channel_name}`}
        description={variant.full_name}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={price === null} onClick={() => save.mutate({ variantId: variant.id, channelId: pricing.channel_id, price: price!, validFrom })}>
              Salvar preço
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Novo preço" required hint={pricing.price !== null ? `Atual: ${formatBRL(pricing.price)}` : undefined}>
              <MoneyInput value={price} onValueChange={setPrice} autoFocus />
            </Field>
            <Field label="Vale a partir de" hint="O preço anterior fica no histórico até o dia anterior.">
              <Input type="date" value={validFrom} min={today()} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
          </div>
          {pricing.suggested_price !== null ? (
            <button type="button" className="text-sm underline decoration-accent decoration-2 underline-offset-4" onClick={() => setPrice(String(pricing.suggested_price))}>
              Usar o preço sugerido ({formatBRL(pricing.suggested_price)})
            </button>
          ) : null}
          {margin !== null ? (
            <p className="rounded-lg bg-subtle px-3 py-2 text-sm">
              Margem unitária com esse preço: <Money value={margin} signed className="font-semibold" />
              {toNumber(price) > 0 ? <span className="text-muted"> ({formatPercent(toNumber(margin) / toNumber(price))})</span> : null}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
