import { CheckCircle2, History, PackageSearch, Plus, Settings, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { EntityPicker, type PickerOption } from '@/components/shared/entity-picker';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput } from '@/components/ui/money-input';
import { EmptyState } from '@/components/ui/states';
import { useAccounts } from '@/data/finance';
import { useRegisterHistoricalSale, useSalesChannels } from '@/data/sales';
import { useMember } from '@/features/member/member-context';
import { addDays, formatDateBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, formatPercent, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { estimateMargin, lineTotal } from './cart';
import { BackLink, CustomerField, ValueRow } from './sales-bits';
import { type CustomerChoice, customerRef, NO_CUSTOMER } from './sales-utils';
import { useCatalog } from './use-catalog';

interface HistLine {
  uid: string;
  variantId: number | null;
  description: string;
  qty: string | null;
  price: string | null;
  cost: string | null;
}

const newLine = (): HistLine => ({ uid: crypto.randomUUID(), variantId: null, description: '', qty: null, price: null, cost: null });

/** Vendas anteriores ao sistema (US-6.11): entram no resultado com o custo informado, sem mexer no estoque. */
export function HistoricalSalePage() {
  const { can, settings } = useMember();
  if (!can('write')) {
    return (
      <Page>
        <PageHeader title="Venda anterior ao sistema" />
        <EmptyState title="Sem permissão" description="Só o perfil Dono lança vendas." />
      </Page>
    );
  }
  if (!settings.go_live_date) {
    return (
      <Page className="max-w-3xl">
        <PageHeader back={<BackLink to="/vendas">Vendas</BackLink>} title="Venda anterior ao sistema" />
        <EmptyState
          icon={<Settings />}
          title="Defina primeiro a data de início do uso"
          description="Vendas antigas são as feitas antes do dia em que a Wabee começou a usar o sistema. Informe essa data em Configurações e volte aqui."
          action={
            <Button asChild>
              <Link to="/configuracoes">Abrir Configurações</Link>
            </Button>
          }
        />
      </Page>
    );
  }
  return <HistoricalForm goLive={settings.go_live_date} />;
}

function HistoricalForm({ goLive }: { goLive: string }) {
  const { settings } = useMember();
  const lastDay = addDays(goLive, -1);
  const channels = useSalesChannels();
  const accounts = useAccounts();
  const catalog = useCatalog();
  const companyAccounts = (accounts.data ?? []).filter((a) => a.owner === 'EMPRESA' && a.kind !== 'CARTAO_CREDITO');
  const [requestId, renew] = useRequestId();
  const [date, setDate] = useState(lastDay);
  const [channelId, setChannelId] = useState<number | null>(settings.default_channel_id);
  const [customer, setCustomer] = useState<CustomerChoice>(NO_CUSTOMER);
  const [accountId, setAccountId] = useState('');
  const [lines, setLines] = useState<HistLine[]>([newLine()]);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Array<{ id: number; number: string; total: number; date: string }>>([]);

  const update = (uid: string, patch: Partial<HistLine>) => setLines((list) => list.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  const preview = estimateMargin({ lines: lines.map((l) => ({ qty: l.qty, unitPrice: l.price, unitCost: l.cost })), fee: null, paymentFee: '0' });

  const options = useMemo<PickerOption[]>(
    () => catalog.products.filter((p) => p.variantId).map((p) => ({ id: String(p.variantId), label: p.fullName, description: p.sku, searchText: p.sku })),
    [catalog.products],
  );

  const save = useRegisterHistoricalSale((r) => {
    renew();
    setDone((list) => [{ id: r.order_id, number: r.number, total: Number(r.total), date }, ...list]);
    setLines([newLine()]);
    setCustomer(NO_CUSTOMER);
  });

  const submit = () => {
    setError(null);
    if (!date || date >= goLive) return setError(`A data precisa ser anterior a ${formatDateBR(goLive)} (início do uso do sistema).`);
    if (!channelId) return setError('Escolha o canal.');
    const filled = lines.filter((l) => l.description.trim() || l.variantId);
    if (filled.length === 0) return setError('Informe ao menos um item vendido.');
    for (const l of filled) {
      const name = l.description.trim() || 'item';
      if (toNumber(l.qty) <= 0) return setError(`Informe a quantidade de ${name}.`);
      if (l.price === null) return setError(`Informe o preço de ${name}.`);
      if (l.cost === null) return setError(`Informe o custo unitário conhecido de ${name}.`);
    }
    save.mutate(
      {
        requestId,
        sale: {
          date,
          channel_id: channelId,
          ...customerRef(customer),
          lines: filled.map((l) => ({ variant_id: l.variantId, custom_description: l.variantId ? null : l.description.trim(), qty: l.qty!, unit_price: l.price, unit_cost: l.cost })),
          account_id: accountId ? Number(accountId) : null,
        },
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  return (
    <Page className="max-w-4xl">
      <PageHeader
        back={<BackLink to="/vendas">Vendas</BackLink>}
        title="Venda anterior ao sistema"
        description={`Vendas feitas antes de ${formatDateBR(goLive)}: entram como entregues e recebidas, com o custo que você conhece, sem mexer no estoque atual.`}
      />

      {done.length > 0 ? (
        <Card className="mb-4 p-3">
          <p className="mb-1 flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" /> Lançadas agora
          </p>
          <ul className="space-y-0.5 text-sm">
            {done.map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <Link to={`/vendas/${d.id}`} className="underline decoration-accent decoration-2 underline-offset-4">
                  {d.number} · {formatDateBR(d.date)}
                </Link>
                <Money value={d.total} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="space-y-4">
        <Card>
          <CardHeader title="Venda" />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <Field label="Data da venda" required hint={`Até ${formatDateBR(lastDay)}.`}>
              <Input type="date" value={date} max={lastDay} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Canal" required>
              <Select value={channelId ?? ''} onChange={(e) => setChannelId(Number(e.target.value) || null)}>
                <option value="">Escolha…</option>
                {(channels.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-soft">Cliente</span>
              <CustomerField value={customer} onChange={setCustomer} />
            </div>
            <Field label="Onde o dinheiro entrou" hint={accountId ? 'Entra no caixa desta conta na data da venda.' : 'Recebida antes do sistema: conta no resultado, mas fica fora do caixa atual.'}>
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Recebida antes do sistema (fora do caixa)</option>
                {companyAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Itens vendidos"
            description="Descreva a peça ou escolha o produto. O custo unitário é o que você sabe que gastou (ex.: material)."
            actions={
              <Button size="sm" variant="outline" onClick={() => setLines((list) => [...list, newLine()])}>
                <Plus /> Item
              </Button>
            }
          />
          <ul className="divide-y divide-line">
            {lines.map((l, index) => (
              <li key={l.uid} className="space-y-2 p-4">
                <div className="flex items-end gap-2">
                  <Field label="Descrição" className="min-w-0 flex-1">
                    {l.variantId ? (
                      <div className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-subtle px-3 text-sm">
                        <span className="min-w-0 flex-1 truncate">{l.description}</span>
                        <button type="button" aria-label="Trocar por descrição livre" onClick={() => update(l.uid, { variantId: null, description: '' })} className="text-muted hover:text-ink">
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <Input value={l.description} onChange={(e) => update(l.uid, { description: e.target.value })} placeholder={index === 0 ? 'Ex.: Peça (antes do sistema)' : 'Descrição da peça'} maxLength={200} />
                    )}
                  </Field>
                  <Button variant="outline" size="icon" aria-label="Escolher produto cadastrado" title="Escolher produto cadastrado" onClick={() => setPicking(l.uid)}>
                    <PackageSearch />
                  </Button>
                  {lines.length > 1 ? (
                    <Button variant="ghost" size="icon" aria-label="Remover item" onClick={() => setLines((list) => list.filter((x) => x.uid !== l.uid))}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Quantidade">
                    <DecimalInput decimals={3} value={l.qty} onValueChange={(qty) => update(l.uid, { qty })} placeholder={index === 0 ? '2' : undefined} />
                  </Field>
                  <Field label="Preço unitário">
                    <MoneyInput value={l.price} onValueChange={(price) => update(l.uid, { price })} placeholder={index === 0 ? '5,00' : undefined} />
                  </Field>
                  <Field label="Custo unitário">
                    <MoneyInput value={l.cost} onValueChange={(cost) => update(l.uid, { cost })} placeholder={index === 0 ? '1,66' : undefined} />
                  </Field>
                  <div className="flex h-10 items-center justify-end self-end text-sm font-semibold">
                    <Money value={lineTotal({ qty: l.qty, unitPrice: l.price })} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            Exemplo: a primeira venda da Wabee — 2 peças a R$ 5,00, com custo de R$ 1,66 cada → receita R$ 10,00, CMV R$ 3,32 e margem R$ 6,68 (66,8%).
          </p>
        </Card>

        <Card className="p-4">
          <ValueRow label="Receita" value={formatBRL(preview.total)} />
          <ValueRow label="CMV (custo informado)" value={`−${formatBRL(preview.cogs)}`} muted />
          <ValueRow
            strong
            label="Margem"
            value={
              <>
                {formatBRL(preview.margin)}
                {preview.marginPct !== null ? <span className="ml-1 text-sm font-normal text-muted">({formatPercent(preview.marginPct)})</span> : null}
              </>
            }
          />
          {error ? (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button asChild variant="outline">
              <Link to="/vendas">Voltar</Link>
            </Button>
            <Button onClick={submit} loading={save.isPending}>
              <History /> Lançar venda anterior
            </Button>
          </div>
        </Card>
      </div>

      <EntityPicker
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        title="Produto cadastrado"
        loading={catalog.loading}
        options={options}
        onSelect={(option) => {
          const product = catalog.byKey.get(`v${option.id}`);
          if (picking && product) update(picking, { variantId: product.variantId, description: product.fullName });
        }}
      />
    </Page>
  );
}
