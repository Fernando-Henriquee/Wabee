import { Info } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput, PercentInput } from '@/components/ui/money-input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useItems } from '@/data/inventory';
import {
  BRAZIL_TIMEZONES,
  FUNDING_TYPE_LABELS,
  type FundingType,
  type SettingsInput,
  TAX_REGIME_LABELS,
  type TaxRegime,
  useCompanySettings,
  useSalesChannelOptions,
  useSaveSettings,
} from '@/data/settings';
import { type AppSettings, useMember } from '@/features/member/member-context';
import { formatDateBR, isValidISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, toNumber } from '@/lib/money';
import { BackLink, ChoiceCards, FormError, NoAccess, Section, ToggleRow } from './bits';

interface CompanyForm {
  company_name: string;
  timezone: string;
  go_live_date: string;
  tax_regime: TaxRegime;
  sales_tax_pct: string | null;
  mei_monthly_das: string | null;
  margin_target_pct: string | null;
  default_channel_id: string;
  default_order_packaging_item_id: string;
  allow_negative_stock: boolean;
  absorb_scrap_cost: boolean;
  coverage_alert_days: string | null;
  filament_reference_cost_g: string | null;
  default_owner_funding_type: FundingType;
}

const str = (value: number | string | null | undefined) => (value === null || value === undefined ? null : String(value));

function formFrom(s: AppSettings): CompanyForm {
  return {
    company_name: s.company_name,
    timezone: s.timezone,
    go_live_date: s.go_live_date ?? '',
    tax_regime: s.tax_regime,
    sales_tax_pct: str(s.sales_tax_pct),
    mei_monthly_das: str(s.mei_monthly_das),
    margin_target_pct: str(s.margin_target_pct),
    default_channel_id: s.default_channel_id ? String(s.default_channel_id) : '',
    default_order_packaging_item_id: s.default_order_packaging_item_id ? String(s.default_order_packaging_item_id) : '',
    allow_negative_stock: s.allow_negative_stock,
    absorb_scrap_cost: s.absorb_scrap_cost,
    coverage_alert_days: str(s.coverage_alert_days),
    filament_reference_cost_g: str(s.filament_reference_cost_g),
    default_owner_funding_type: s.default_owner_funding_type,
  };
}

export function CompanyPage() {
  const { can } = useMember();
  const settings = useCompanySettings();
  if (!can('settings')) return <NoAccess title="Empresa e regras" />;
  if (settings.isError) return <Page><ErrorState error={settings.error} onRetry={() => void settings.refetch()} /></Page>;
  if (!settings.data) return <Page><LoadingBlock /></Page>;
  // Recria o formulário quando os dados salvos mudam (outra aba, outro aparelho).
  return <CompanyFormView key={settings.data.updated_at} initial={formFrom(settings.data)} />;
}

function CompanyFormView({ initial }: { initial: CompanyForm }) {
  const navigate = useNavigate();
  const { today } = useMember();
  const [form, setForm] = useState<CompanyForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const channels = useSalesChannelOptions();
  const packaging = useItems({ kind: 'PACKAGING' });
  const save = useSaveSettings();
  const set = <K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  const activeChannels = (channels.data ?? []).filter((c) => c.active || String(c.id) === form.default_channel_id);
  const goLiveChanged = form.go_live_date !== initial.go_live_date && initial.go_live_date !== '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const name = form.company_name.trim();
    if (!name) return setError('Informe o nome da empresa.');
    if (form.go_live_date && !isValidISODate(form.go_live_date)) return setError('Data de início do uso inválida.');
    const margin = toNumber(form.margin_target_pct);
    if (form.margin_target_pct === null || margin < 0 || margin >= 1) return setError('A margem alvo precisa ficar entre 0% e 99,99%.');
    if (form.tax_regime === 'SIMPLES' && (toNumber(form.sales_tax_pct) < 0 || toNumber(form.sales_tax_pct) >= 1)) return setError('O imposto sobre vendas precisa ficar entre 0% e 99,99%.');
    const days = Math.round(toNumber(form.coverage_alert_days));
    if (form.coverage_alert_days === null || days < 0 || days > 365) return setError('O alerta de cobertura precisa ficar entre 0 e 365 dias.');
    if (form.filament_reference_cost_g === null || toNumber(form.filament_reference_cost_g) < 0) return setError('Informe o custo de referência do filamento.');
    const payload: SettingsInput = {
      company_name: name,
      timezone: form.timezone,
      go_live_date: form.go_live_date || null,
      tax_regime: form.tax_regime,
      margin_target_pct: form.margin_target_pct,
      allow_negative_stock: form.allow_negative_stock,
      absorb_scrap_cost: form.absorb_scrap_cost,
      coverage_alert_days: days,
      filament_reference_cost_g: form.filament_reference_cost_g,
      default_owner_funding_type: form.default_owner_funding_type,
      default_order_packaging_item_id: form.default_order_packaging_item_id ? Number(form.default_order_packaging_item_id) : null,
      ...(form.default_channel_id ? { default_channel_id: Number(form.default_channel_id) } : {}),
      ...(form.tax_regime === 'SIMPLES' ? { sales_tax_pct: form.sales_tax_pct ?? '0' } : {}),
      ...(form.tax_regime === 'MEI' ? { mei_monthly_das: form.mei_monthly_das ?? '0' } : {}),
    };
    save.mutate(payload, { onError: (e) => setError(describeError(e)) });
  };

  const exampleCost = 10;
  const suggested = (() => {
    const den = 1 - toNumber(form.margin_target_pct) - (form.tax_regime === 'SIMPLES' ? toNumber(form.sales_tax_pct) : 0);
    return den > 0 ? exampleCost / den : null;
  })();

  return (
    <Page className="max-w-3xl">
      <PageHeader
        back={<BackLink />}
        title="Empresa e regras"
        description="Mudanças valem para as próximas operações: o que já foi lançado não é recalculado."
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Section title="Empresa">
          <Field label="Nome da empresa" required className="sm:col-span-2">
            <Input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} maxLength={120} autoComplete="organization" />
          </Field>
          <Field
            label="Início do uso do sistema"
            hint={
              goLiveChanged
                ? `Antes era ${formatDateBR(initial.go_live_date)}. Confira as compras e vendas antigas depois de mudar.`
                : 'Data em que o sistema passa a valer: compras e vendas anteriores entram como “anteriores ao sistema”, sem mexer no caixa de hoje.'
            }
          >
            <Input type="date" value={form.go_live_date} max={today()} onChange={(e) => set('go_live_date', e.target.value)} />
          </Field>
          <Field label="Fuso horário" hint='Define o "hoje" das datas, vencimentos e relatórios.'>
            <Select value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {BRAZIL_TIMEZONES.some((t) => t.value === form.timezone) ? null : <option value={form.timezone}>{form.timezone}</option>}
              {BRAZIL_TIMEZONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section title="Impostos" description="O regime define se há imposto descontado em cada venda.">
          <ChoiceCards
            name="regime"
            legend="Regime tributário"
            className="sm:col-span-2"
            value={form.tax_regime}
            onChange={(value) => set('tax_regime', value)}
            options={[
              { value: 'CPF_SEM_CNPJ', label: TAX_REGIME_LABELS.CPF_SEM_CNPJ, description: 'Sem imposto nas vendas.' },
              { value: 'MEI', label: TAX_REGIME_LABELS.MEI, description: 'Imposto fixo mensal (DAS); nada por venda.' },
              { value: 'SIMPLES', label: TAX_REGIME_LABELS.SIMPLES, description: 'Percentual sobre cada venda.' },
            ]}
          />
          {form.tax_regime === 'SIMPLES' ? (
            <Field label="Imposto sobre vendas" hint="Alíquota efetiva do Simples. Sai de cada venda e entra no preço sugerido e na margem.">
              <PercentInput value={form.sales_tax_pct} onValueChange={(v) => set('sales_tax_pct', v)} />
            </Field>
          ) : null}
          {form.tax_regime === 'MEI' ? (
            <Field label="DAS mensal" hint="Valor de referência do boleto mensal. Lance o pagamento como despesa no Financeiro.">
              <MoneyInput value={form.mei_monthly_das} onValueChange={(v) => set('mei_monthly_das', v)} />
            </Field>
          ) : null}
        </Section>

        <Section title="Preço e vendas">
          <Field
            label="Margem alvo"
            hint={
              suggested !== null
                ? `Usada no preço sugerido de cada canal. Ex.: custo de ${formatBRL(exampleCost)} em venda direta sem taxas → sugere ${formatBRL(suggested)}.`
                : 'Margem impossível com o imposto atual: reduza a margem alvo.'
            }
          >
            <PercentInput value={form.margin_target_pct} onValueChange={(v) => set('margin_target_pct', v)} />
          </Field>
          <Field label="Canal padrão" hint={<>Já vem escolhido nas vendas novas. Taxas de cada canal em <Link to="/configuracoes/canais" className="underline">Canais e taxas</Link>.</>}>
            <Select value={form.default_channel_id} onChange={(e) => set('default_channel_id', e.target.value)}>
              {form.default_channel_id ? null : <option value="">Escolha um canal</option>}
              {activeChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? '' : ' (inativo)'}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Embalagem padrão do pedido"
            className="sm:col-span-2"
            hint={
              <>
                Sai do estoque em cada entrega (além das embalagens da ficha técnica) e entra na margem do pedido. Cadastre embalagens em{' '}
                <Link to="/estoque/itens/novo?tipo=PACKAGING" className="underline">
                  Estoque → Novo item
                </Link>
                .
              </>
            }
          >
            <Select value={form.default_order_packaging_item_id} onChange={(e) => set('default_order_packaging_item_id', e.target.value)}>
              <option value="">Nenhuma</option>
              {(packaging.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.sku})
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section title="Estoque e produção">
          <Field label="Custo de referência do filamento" hint="Por grama. Usado quando um filamento não tem custo de compra (saldo inicial sem custo, ficha sem compra). Valor estimado nos relatórios.">
            <DecimalInput decimals={4} prefix="R$" suffix="/g" value={form.filament_reference_cost_g} onValueChange={(v) => set('filament_reference_cost_g', v)} />
          </Field>
          <Field label="Alerta de cobertura (dias)" hint="Avisa quando o estoque de um item dura menos que estes dias, pelo consumo recente.">
            <DecimalInput decimals={0} value={form.coverage_alert_days} onValueChange={(v) => set('coverage_alert_days', v)} />
          </Field>
          <p className="-mt-2 text-xs text-muted sm:col-span-2">Referência atual: {formatBRL(toNumber(form.filament_reference_cost_g) * 1000)} por kg de filamento.</p>
          <ToggleRow
            className="sm:col-span-2"
            checked={form.allow_negative_stock}
            onChange={(v) => set('allow_negative_stock', v)}
            label="Permitir estoque negativo"
            description="Desligado (recomendado): uma saída maior que o saldo livre é recusada. Ligado: a saída passa e o saldo fica negativo até você corrigir com um ajuste."
          />
          <ToggleRow
            className="sm:col-span-2"
            checked={form.absorb_scrap_cost}
            onChange={(v) => set('absorb_scrap_cost', v)}
            label="Peças boas absorvem o custo das falhas"
            description="Ligado: o custo das peças que falharam numa impressão é dividido entre as boas (custo unitário maior). Desligado: o custo das falhas vai para perdas de produção no resultado."
          />
        </Section>

        <Section title="Dinheiro do dono" description="Quando o dono paga algo da empresa com dinheiro ou cartão pessoal.">
          <ChoiceCards
            name="aporte"
            legend="Como registrar, por padrão"
            className="sm:col-span-2"
            columns={2}
            value={form.default_owner_funding_type}
            onChange={(value) => set('default_owner_funding_type', value)}
            options={[
              { value: 'CAPITAL_CONTRIBUTION', label: FUNDING_TYPE_LABELS.CAPITAL_CONTRIBUTION, description: 'Vira investimento do dono na empresa; não precisa ser devolvido.' },
              { value: 'OWNER_LOAN', label: FUNDING_TYPE_LABELS.OWNER_LOAN, description: 'A empresa fica devendo ao dono e devolve quando tiver caixa.' },
            ]}
          />
          <p className="flex items-start gap-2 text-xs text-muted sm:col-span-2">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Dá para escolher outro tipo em cada compra ou despesa; este é só o valor que já vem marcado.
          </p>
        </Section>

        <FormError>{error}</FormError>
        <div className="sticky bottom-20 z-10 flex justify-end gap-2 rounded-xl border border-line bg-panel/95 p-2 shadow-[var(--shadow-pop)] backdrop-blur lg:bottom-4">
          <Button type="button" variant="outline" onClick={() => (dirty ? setForm(initial) : navigate('/configuracoes'))}>
            {dirty ? 'Descartar' : 'Voltar'}
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            Salvar configurações
          </Button>
        </div>
      </form>
    </Page>
  );
}
