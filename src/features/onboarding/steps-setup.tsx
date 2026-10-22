import { ArrowRight, CreditCard, Landmark, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { DecimalInput, MoneyInput, PercentInput } from '@/components/ui/money-input';
import {
  type AccountKind,
  type OnboardingAccount,
  type OnboardingSnapshot,
  TAX_REGIME_LABELS,
  type TaxRegime,
  useCreatePaymentAccount,
  useCreateOperationalRate,
  useSavePrinter,
  useSaveSettings,
} from '@/data/settings';
import { useMember } from '@/features/member/member-context';
import { ChoiceCards, FormError } from '@/features/settings/bits';
import { formatDateBR, isValidISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, formatCost, toNumber } from '@/lib/money';
import { hasCurrentMachineRate } from './onboarding-logic';
import { DoneNote, Explain, StepFooter, type StepNav } from './step-ui';

const KIND_LABELS: Record<AccountKind, string> = { BANCO: 'Conta bancária / Pix', CARTEIRA: 'Carteira digital', DINHEIRO: 'Dinheiro em espécie', CARTAO_CREDITO: 'Cartão de crédito' };

// -----------------------------------------------------------------------------
// 1. Empresa
// -----------------------------------------------------------------------------

export function StepCompany({ nav }: { nav: StepNav }) {
  const { settings, today } = useMember();
  const [name, setName] = useState(settings.company_name);
  const [goLive, setGoLive] = useState(settings.go_live_date ?? today());
  const [regime, setRegime] = useState<TaxRegime>(settings.tax_regime);
  const [tax, setTax] = useState<string | null>(String(settings.sales_tax_pct ?? 0));
  const [das, setDas] = useState<string | null>(String(settings.mei_monthly_das ?? 0));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveSettings({ success: 'Dados da empresa salvos.', onSuccess: nav.complete });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Informe o nome da empresa.');
    if (!isValidISODate(goLive)) return setError('Informe a data de início do uso.');
    if (regime === 'SIMPLES' && (toNumber(tax) < 0 || toNumber(tax) >= 1)) return setError('O imposto precisa ficar entre 0% e 99,99%.');
    save.mutate(
      {
        company_name: name.trim(),
        go_live_date: goLive,
        tax_regime: regime,
        ...(regime === 'SIMPLES' ? { sales_tax_pct: tax ?? '0' } : {}),
        ...(regime === 'MEI' ? { mei_monthly_das: das ?? '0' } : {}),
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="space-y-4 p-4">
        <Explain>
          Comece pelo básico. A <strong>data de início do uso</strong> é o dia a partir do qual tudo passa a ser lançado aqui. Compras e vendas de antes dela entram como{' '}
          <strong>“anteriores ao sistema”</strong> (passo “Compras já feitas”) e não mexem no caixa de hoje. Use hoje, ou o dia 1º do mês para fechar meses inteiros.
        </Explain>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome da empresa" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="organization" />
          </Field>
          <Field label="Início do uso do sistema" required>
            <Input type="date" value={goLive} onChange={(e) => setGoLive(e.target.value)} />
          </Field>
        </div>
        <ChoiceCards
          name="regime-assistente"
          legend="Regime tributário"
          value={regime}
          onChange={setRegime}
          options={[
            { value: 'CPF_SEM_CNPJ', label: TAX_REGIME_LABELS.CPF_SEM_CNPJ, description: 'Ainda sem CNPJ: sem imposto nas vendas.' },
            { value: 'MEI', label: TAX_REGIME_LABELS.MEI, description: 'Imposto fixo mensal (DAS).' },
            { value: 'SIMPLES', label: TAX_REGIME_LABELS.SIMPLES, description: 'Percentual sobre cada venda.' },
          ]}
        />
        {regime === 'SIMPLES' ? (
          <Field label="Imposto sobre vendas" hint="Alíquota efetiva do Simples; entra no preço sugerido e na margem." className="sm:max-w-xs">
            <PercentInput value={tax} onValueChange={setTax} />
          </Field>
        ) : null}
        {regime === 'MEI' ? (
          <Field label="DAS mensal" hint="Valor de referência do boleto mensal do MEI." className="sm:max-w-xs">
            <MoneyInput value={das} onValueChange={setDas} />
          </Field>
        ) : null}
        <p className="text-xs text-muted">
          Margem alvo, canal padrão e outras regras ficam em <Link to="/configuracoes/empresa" className="underline">Configurações → Empresa e regras</Link>.
        </p>
        <FormError>{error}</FormError>
      </div>
      <StepFooter nav={nav}>
        <Button type="submit" loading={save.isPending || nav.busy}>
          Salvar e continuar <ArrowRight />
        </Button>
      </StepFooter>
    </form>
  );
}

// -----------------------------------------------------------------------------
// 2. Contas
// -----------------------------------------------------------------------------

function AccountList({ accounts }: { accounts: OnboardingAccount[] }) {
  if (accounts.length === 0) return null;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
          {a.kind === 'CARTAO_CREDITO' ? <CreditCard className="size-4 shrink-0 text-muted" aria-hidden /> : <Landmark className="size-4 shrink-0 text-muted" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{a.name}</span>
            <span className="block text-xs text-muted">
              {KIND_LABELS[a.kind]}
              {a.kind === 'CARTAO_CREDITO' && a.card_closing_day ? ` · fecha dia ${a.card_closing_day}, vence dia ${a.card_due_day}` : ''}
            </span>
          </span>
          <Badge tone={a.owner === 'EMPRESA' ? 'success' : 'accent'}>{a.owner === 'EMPRESA' ? 'empresa' : 'dono'}</Badge>
        </li>
      ))}
    </ul>
  );
}

function CompanyAccountForm({ onDone }: { onDone: () => void }) {
  const { settings, today } = useMember();
  const [name, setName] = useState('Pix (empresa)');
  const [kind, setKind] = useState<AccountKind>('BANCO');
  const [balance, setBalance] = useState<string | null>('0');
  const [date, setDate] = useState(settings.go_live_date ?? today());
  const [error, setError] = useState<string | null>(null);
  const save = useCreatePaymentAccount(onDone);
  return (
    <section className="space-y-3 rounded-xl border border-line p-3 sm:p-4" aria-label="Conta da empresa">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Landmark className="size-4 text-accent-ink" aria-hidden /> Conta da empresa
      </h3>
      <p className="text-xs text-muted">Onde entra o dinheiro das vendas e de onde saem os pagamentos. Entra no caixa.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Tipo">
          <Select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {(['BANCO', 'CARTEIRA', 'DINHEIRO'] as AccountKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Saldo no início" hint="Quanto havia na conta na data ao lado.">
          <MoneyInput value={balance} onValueChange={setBalance} />
        </Field>
        <Field label="Data do saldo">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <FormError>{error}</FormError>
      <div className="flex justify-end">
        <Button
          variant="accent"
          loading={save.isPending}
          onClick={() => {
            setError(null);
            if (!name.trim()) return setError('Informe o nome da conta.');
            if (!isValidISODate(date)) return setError('Informe a data do saldo.');
            save.mutate({ name: name.trim(), kind, owner: 'EMPRESA', opening_balance: balance ?? '0', opening_date: date }, { onError: (e) => setError(describeError(e)) });
          }}
        >
          <Plus /> Cadastrar conta
        </Button>
      </div>
    </section>
  );
}

function dayValue(value: string | null): number | null {
  if (value === null) return null;
  const n = Math.round(toNumber(value));
  return n >= 1 && n <= 31 ? n : null;
}

function OwnerCardForm({ onDone }: { onDone: () => void }) {
  const { settings } = useMember();
  const [name, setName] = useState('Cartão (pessoal do dono)');
  const [closing, setClosing] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useCreatePaymentAccount(onDone);
  const funding = settings.default_owner_funding_type === 'OWNER_LOAN' ? 'empréstimo do dono' : 'aporte do dono';
  return (
    <section className="space-y-3 rounded-xl border border-line p-3 sm:p-4" aria-label="Cartão pessoal do dono">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CreditCard className="size-4 text-accent-ink" aria-hidden /> Cartão de crédito pessoal do dono
      </h3>
      <p className="text-xs text-muted">
        Compras da empresa pagas neste cartão não saem do caixa: cada parcela paga vira {funding} (dá para mudar em Empresa e regras).
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Nome" required className="sm:col-span-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Dia de fechamento" hint="Da fatura (1 a 31)">
          <DecimalInput decimals={0} value={closing} onValueChange={setClosing} placeholder="Ex.: 5" />
        </Field>
        <Field label="Dia de vencimento" hint="Da fatura (1 a 31)">
          <DecimalInput decimals={0} value={due} onValueChange={setDue} placeholder="Ex.: 15" />
        </Field>
      </div>
      <FormError>{error}</FormError>
      <div className="flex justify-end">
        <Button
          variant="accent"
          loading={save.isPending}
          onClick={() => {
            setError(null);
            if (!name.trim()) return setError('Informe o nome do cartão.');
            const closingDay = dayValue(closing);
            const dueDay = dayValue(due);
            if (closingDay === null || dueDay === null) return setError('Informe os dias de fechamento e de vencimento (1 a 31).');
            save.mutate(
              { name: name.trim(), kind: 'CARTAO_CREDITO', owner: 'DONO', card_closing_day: closingDay, card_due_day: dueDay },
              { onError: (e) => setError(describeError(e)) },
            );
          }}
        >
          <Plus /> Cadastrar cartão
        </Button>
      </div>
    </section>
  );
}

export function StepAccounts({ nav, snapshot }: { nav: StepNav; snapshot: OnboardingSnapshot }) {
  const hasCompany = snapshot.accounts.some((a) => a.owner === 'EMPRESA');
  const hasOwnerCard = snapshot.accounts.some((a) => a.owner === 'DONO' && a.kind === 'CARTAO_CREDITO');
  const [moreCompany, setMoreCompany] = useState(false);
  const [moreCard, setMoreCard] = useState(false);
  return (
    <div>
      <div className="space-y-4 p-4">
        <Explain>
          Separe o dinheiro da empresa do dinheiro do dono. A <strong>conta da empresa</strong> (ex.: o Pix) forma o caixa. O <strong>cartão pessoal do dono</strong> só registra que
          ele pagou algo da empresa: vira investimento do dono, nunca saldo de caixa.
        </Explain>
        <AccountList accounts={snapshot.accounts} />
        {!hasCompany || moreCompany ? (
          <CompanyAccountForm onDone={() => setMoreCompany(false)} />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setMoreCompany(true)}>
            <Plus /> Outra conta da empresa
          </Button>
        )}
        {!hasOwnerCard || moreCard ? (
          <OwnerCardForm onDone={() => setMoreCard(false)} />
        ) : (
          <Button variant="outline" size="sm" className="ml-2" onClick={() => setMoreCard(true)}>
            <Plus /> Outro cartão do dono
          </Button>
        )}
        <p className="text-xs text-muted">
          Depois você ajusta tudo em <Link to="/financeiro/contas" className="underline">Financeiro → Contas e cartões</Link>.
        </p>
      </div>
      <StepFooter nav={nav}>
        {hasCompany ? (
          <Button onClick={nav.complete} loading={nav.busy}>
            Continuar <ArrowRight />
          </Button>
        ) : null}
      </StepFooter>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 3. Impressora
// -----------------------------------------------------------------------------

type PrinterMode = 'agora' | 'compra';

export function StepPrinter({ nav, snapshot }: { nav: StepNav; snapshot: OnboardingSnapshot }) {
  const hasPrinter = snapshot.printers.length > 0;
  const [mode, setMode] = useState<PrinterMode>('agora');
  const [name, setName] = useState('Impressora 1');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [power, setPower] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useSavePrinter(() => nav.complete());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Já cadastrada, ou vai entrar pela compra anterior: só confirma o passo.
    if (hasPrinter || mode === 'compra') return nav.complete();
    if (!name.trim()) return setError('Informe o nome da impressora.');
    save.mutate({ name: name.trim(), brand: brand.trim() || null, model: model.trim() || null, avg_power_w: power }, { onError: (e) => setError(describeError(e)) });
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="space-y-4 p-4">
        <Explain>
          Cadastre a impressora 3D para planejar as impressões e acompanhar as horas de uso. Se ela foi comprada <strong>antes do início do uso</strong> e você vai lançar essa
          compra no passo “Compras já feitas”, deixe que ela seja cadastrada por lá: entra com o valor pago e não fica duplicada.
        </Explain>
        {hasPrinter ? (
          <DoneNote>
            {snapshot.printers.map((p) => p.name).join(', ')} {snapshot.printers.length === 1 ? 'já está cadastrada' : 'já estão cadastradas'}.{' '}
            <Link to="/producao/equipamentos" className="underline">
              Ver equipamentos
            </Link>
          </DoneNote>
        ) : (
          <>
            <ChoiceCards
              name="impressora-modo"
              legend="Como cadastrar"
              columns={2}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'agora', label: 'Cadastrar agora', description: 'A compra da impressora não vai ser lançada no sistema.' },
                { value: 'compra', label: 'Pela compra já feita', description: 'Ela é cadastrada sozinha ao receber a compra, com o valor pago.' },
              ]}
            />
            {mode === 'agora' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nome" required hint="Como aparece no quadro de produção.">
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </Field>
                <Field label="Potência média (W)" hint="Opcional; usada se um dia separar a energia.">
                  <DecimalInput decimals={0} value={power} onValueChange={setPower} />
                </Field>
                <Field label="Marca">
                  <Input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} placeholder="Ex.: Bambu Lab" />
                </Field>
                <Field label="Modelo">
                  <Input value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} placeholder="Ex.: A1" />
                </Field>
              </div>
            ) : (
              <p className="text-sm text-muted">Sem impressora cadastrada, o planejamento de impressões fica indisponível até a compra ser recebida.</p>
            )}
          </>
        )}
        <FormError>{error}</FormError>
      </div>
      <StepFooter nav={nav}>
        <Button type="submit" loading={save.isPending || nav.busy}>
          {hasPrinter || mode === 'compra' ? 'Continuar' : 'Salvar e continuar'} <ArrowRight />
        </Button>
      </StepFooter>
    </form>
  );
}

// -----------------------------------------------------------------------------
// 4. Taxa operacional
// -----------------------------------------------------------------------------

export function StepRate({ nav, snapshot }: { nav: StepNav; snapshot: OnboardingSnapshot }) {
  const { settings, today } = useMember();
  const hasRate = hasCurrentMachineRate(snapshot);
  const currentRate = snapshot.rates.find((r) => r.rate_type === 'OPERATIONAL_PER_HOUR' && r.valid_to === null && r.equipment_id === null);
  const [rate, setRate] = useState<string | null>('1.2');
  const [validFrom, setValidFrom] = useState(settings.go_live_date ?? today());
  const [error, setError] = useState<string | null>(null);
  const save = useCreateOperationalRate(() => nav.complete());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (hasRate) return nav.complete();
    if (rate === null || toNumber(rate) <= 0) return setError('Informe a taxa por hora (ex.: 1,20).');
    if (!isValidISODate(validFrom)) return setError('Informe desde quando a taxa vale.');
    save.mutate({ value: rate, validFrom }, { onError: (e) => setError(describeError(e)) });
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="space-y-4 p-4">
        <Explain>
          <strong>R$ 1,20 por hora</strong> é a taxa que vocês já usam hoje: junta a <strong>energia elétrica</strong> e o <strong>desgaste da impressora</strong> (depreciação) numa
          taxa só. Cada hora de impressão soma esse valor ao custo das peças. Depois, em Produção → Taxas, dá para separar energia e depreciação ou mudar o valor com nova vigência
          (o que já foi impresso não muda).
        </Explain>
        {hasRate ? (
          <DoneNote>
            {currentRate
              ? `Taxa combinada de ${formatCost(currentRate.value, 4)}/h vigente desde ${formatDateBR(currentRate.valid_from)}.`
              : 'Já há taxas por hora vigentes (energia e depreciação separadas).'}{' '}
            <Link to="/producao/taxas" className="underline">
              Ver taxas
            </Link>
          </DoneNote>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Taxa combinada por hora" required hint={rate ? `Vale para todas as impressoras: ${formatBRL(toNumber(rate) * 10)} a cada 10 horas impressas.` : 'Vale para todas as impressoras.'}>
              <DecimalInput decimals={4} prefix="R$" suffix="/h" value={rate} onValueChange={setRate} />
            </Field>
            <Field label="Vale a partir de" required hint="Normalmente, a data de início do uso.">
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
          </div>
        )}
        <FormError>{error}</FormError>
      </div>
      <StepFooter nav={nav}>
        <Button type="submit" loading={save.isPending || nav.busy}>
          {hasRate ? 'Continuar' : 'Salvar e continuar'} <ArrowRight />
        </Button>
      </StepFooter>
    </form>
  );
}
