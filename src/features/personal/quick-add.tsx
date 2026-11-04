import { Mic, MicOff, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { DecimalInput } from '@/components/ui/money-input';
import {
  type PfAccount,
  type PfCategory,
  type PfTxKind,
  useAddTransactions,
  useLearnWords,
  usePfAccounts,
  usePfCategories,
  usePfTransactions,
  usePfWordRules,
  useSavePlan,
} from '@/data/personal';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { addDays, addMonths, isValidISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatBRL, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { learnableWords, type ParsedEntry, parseSpoken } from './parse-expense';
import { useSpeech } from './use-speech';

interface Draft {
  uid: string;
  kind: PfTxKind;
  amount: string | null;
  description: string;
  categoryId: number | null;
  accountId: number | null;
  toAccountId: number | null;
  date: string;
  /** "em 3x de 100": vira um parcelado em Parcelas e contas. */
  installments: { count: string | null; firstDue: string } | null;
  /** Categoria sugerida pelo interpretador (para ensinar quando a pessoa troca). */
  suggestedCategoryId: number | null;
  uncertain: ParsedEntry['uncertain'];
  fromVoice: boolean;
}

const KIND_LABELS: Record<PfTxKind, string> = { GASTO: 'Gasto', ENTRADA: 'Entrada', TRANSFERENCIA: 'Transferência' };

const blank = (today: string, accountId: number | null): Draft => ({
  uid: crypto.randomUUID(),
  kind: 'GASTO',
  amount: null,
  description: '',
  categoryId: null,
  accountId,
  toAccountId: null,
  date: today,
  installments: null,
  suggestedCategoryId: null,
  uncertain: [],
  fromVoice: false,
});

function fromParsed(entry: ParsedEntry, defaultAccount: number | null): Draft {
  return {
    uid: crypto.randomUUID(),
    kind: entry.kind,
    // Em compra parcelada o valor do lançamento é o de cada parcela.
    amount: (entry.installments?.amount ?? entry.amount) === null ? null : String(entry.installments?.amount ?? entry.amount),
    description: entry.description,
    categoryId: entry.categoryId,
    accountId: entry.accountId ?? defaultAccount,
    toAccountId: null,
    date: entry.date,
    installments: entry.installments ? { count: String(entry.installments.count), firstDue: addMonths(entry.date, 1) } : null,
    suggestedCategoryId: entry.categoryId,
    uncertain: entry.uncertain,
    fromVoice: true,
  };
}

/**
 * Lançamento rápido: a pessoa fala ou digita uma frase ("gastei 45 no mercado e 20 de uber ontem"),
 * confere o que foi entendido e salva. Também serve para preencher na mão.
 */
export function QuickAddDialog({ open, onOpenChange, initialDate }: { open: boolean; onOpenChange: (open: boolean) => void; initialDate?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <QuickAdd onClose={() => onOpenChange(false)} initialDate={initialDate} /> : null}
    </Dialog>
  );
}

function QuickAdd({ onClose, initialDate }: { onClose: () => void; initialDate?: string }) {
  const { today: todayFn } = useMember();
  const today = todayFn();
  const accounts = usePfAccounts();
  const categories = usePfCategories();
  const rules = usePfWordRules();
  const lastTx = usePfTransactions({ limit: 1 });
  const activeAccounts = useMemo(() => (accounts.data ?? []).filter((a) => a.active), [accounts.data]);
  const defaultAccount = lastTx.data?.[0]?.account_id ?? activeAccounts[0]?.id ?? null;
  const [drafts, setDrafts] = useState<Draft[]>(() => [{ ...blank(initialDate ?? today, null) }]);
  const [sentence, setSentence] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId, renew] = useRequestId();
  const add = useAddTransactions();
  const savePlan = useSavePlan();
  const learn = useLearnWords();
  const voiceUsed = drafts.some((d) => d.fromVoice);

  const understand = (text: string) => {
    setError(null);
    setNote(null);
    const cats = (categories.data ?? []).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, kind: c.kind, keywords: c.keywords }));
    const list = parseSpoken(text, {
      today,
      categories: cats,
      accounts: activeAccounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      learned: rules.data ?? [],
    });
    if (list.length === 0) return setNote('Não entendi. Tente algo como "gastei 45 no mercado".');
    setDrafts(list.map((e) => fromParsed(e, defaultAccount)));
    if (list.some((e) => e.amount === null)) setNote('Faltou o valor em algum gasto: preencha abaixo.');
  };

  const speech = useSpeech((text) => {
    setSentence(text);
    understand(text);
  });

  const update = (uid: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.uid === uid ? { ...d, ...patch } : d)));
  const effectiveAccount = (d: Draft) => d.accountId ?? defaultAccount;

  const save = async () => {
    setError(null);
    for (const d of drafts) {
      if (toNumber(d.amount) <= 0) return setError('Informe o valor de cada lançamento.');
      if (!isValidISODate(d.date)) return setError('Data inválida.');
      if (d.date > today) return setError('A data não pode ser futura.');
      if (!effectiveAccount(d)) return setError('Cadastre uma conta em Ajustes para lançar.');
      if (d.kind === 'TRANSFERENCIA' && (!d.toAccountId || d.toAccountId === effectiveAccount(d))) return setError('Escolha a conta de destino da transferência.');
      if (d.installments && (toNumber(d.installments.count) < 2 || !isValidISODate(d.installments.firstDue))) return setError('Informe as parcelas e a data da primeira.');
    }
    const plain = drafts.filter((d) => !d.installments);
    const parceled = drafts.filter((d) => d.installments);
    try {
      if (plain.length > 0) {
        await add.mutateAsync({
          requestId,
          txs: plain.map((d) => ({
            kind: d.kind,
            account_id: effectiveAccount(d),
            to_account_id: d.kind === 'TRANSFERENCIA' ? d.toAccountId : null,
            category_id: d.kind === 'TRANSFERENCIA' ? null : d.categoryId,
            amount: d.amount!,
            date: d.date,
            description: d.description.trim() || null,
            source: d.fromVoice ? 'VOZ' : 'MANUAL',
            transcript: d.fromVoice ? sentence.trim().slice(0, 500) || null : null,
          })),
        });
      }
      for (const d of parceled) {
        await savePlan.mutateAsync({
          kind: 'PARCELADO',
          name: d.description.trim() || 'Compra parcelada',
          amount: d.amount,
          installments_total: Math.round(toNumber(d.installments!.count)),
          first_due: d.installments!.firstDue,
          account_id: effectiveAccount(d),
          category_id: d.categoryId,
        });
      }
    } catch (e) {
      return setError(describeError(e));
    }
    // Ensina o interpretador quando a pessoa escolheu ou trocou a categoria.
    const rulesToLearn = drafts
      .filter((d) => d.categoryId !== null && d.categoryId !== d.suggestedCategoryId && d.kind !== 'TRANSFERENCIA')
      .flatMap((d) => learnableWords(d.description).map((word) => ({ word, category_id: d.categoryId! })));
    if (rulesToLearn.length > 0) learn.mutate(rulesToLearn);
    renew();
    onClose();
  };

  const total = drafts.reduce((sum, d) => sum + (d.kind === 'GASTO' ? toNumber(d.amount) : 0), 0);

  return (
    <DialogContent
      title="Lançar"
      description="Fale ou escreva o que gastou. Você confere antes de salvar."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={add.isPending || savePlan.isPending}>
            {drafts.length > 1 ? `Salvar ${drafts.length} lançamentos` : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section aria-label="Falar ou digitar" className="space-y-2 rounded-xl border border-line bg-subtle p-3">
          <div className="flex items-start gap-2">
            <Textarea
              value={speech.listening ? speech.interim : sentence}
              onChange={(e) => setSentence(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && sentence.trim()) {
                  e.preventDefault();
                  understand(sentence);
                }
              }}
              placeholder='Fale ou digite: "gastei 45 no mercado e 20 de uber ontem"'
              aria-label="Frase com o gasto"
              className="min-h-14 flex-1 bg-panel"
              readOnly={speech.listening}
            />
            {speech.supported ? (
              <Button
                type="button"
                variant={speech.listening ? 'danger' : 'accent'}
                size="icon"
                aria-label={speech.listening ? 'Parar de ouvir' : 'Falar o gasto'}
                aria-pressed={speech.listening}
                onClick={speech.listening ? speech.stop : speech.start}
                className={cn('shrink-0', speech.listening && 'animate-pulse')}
              >
                {speech.listening ? <MicOff /> : <Mic />}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {speech.listening
                ? 'Ouvindo… fale o gasto.'
                : speech.supported
                  ? 'Toque no microfone, ou use o microfone do teclado do celular.'
                  : 'Use o microfone do teclado do celular para ditar.'}
            </p>
            <Button type="button" size="sm" variant="outline" disabled={!sentence.trim() || speech.listening} onClick={() => understand(sentence)}>
              <Sparkles /> Entender
            </Button>
          </div>
          {speech.error ? (
            <p role="alert" className="text-xs text-danger">
              {speech.error}
            </p>
          ) : null}
          {note ? <p className="text-xs text-warning">{note}</p> : null}
        </section>

        <ul className="space-y-3">
          {drafts.map((d, index) => (
            <DraftCard
              key={d.uid}
              draft={d}
              index={index}
              total={drafts.length}
              today={today}
              accounts={activeAccounts}
              categories={(categories.data ?? []).filter((c) => c.active)}
              defaultAccount={defaultAccount}
              onChange={(patch) => update(d.uid, patch)}
              onRemove={() => setDrafts((list) => list.filter((x) => x.uid !== d.uid))}
            />
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setDrafts((list) => [...list, blank(initialDate ?? today, null)])}>
            <Plus /> Adicionar outro
          </Button>
          {drafts.length > 1 && total > 0 ? <span className="text-sm text-muted">Total dos gastos: {formatBRL(total)}</span> : null}
        </div>
        {voiceUsed ? <p className="text-xs text-muted">Confira o valor, a categoria e a data antes de salvar.</p> : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </DialogContent>
  );
}

function DraftCard({
  draft: d,
  index,
  total,
  today,
  accounts,
  categories,
  defaultAccount,
  onChange,
  onRemove,
}: {
  draft: Draft;
  index: number;
  total: number;
  today: string;
  accounts: PfAccount[];
  categories: PfCategory[];
  defaultAccount: number | null;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const options = categories.filter((c) => c.kind === (d.kind === 'ENTRADA' ? 'ENTRADA' : 'GASTO'));
  const doubt = (field: 'amount' | 'category') => d.uncertain.includes(field) && (field === 'amount' ? toNumber(d.amount) <= 0 : d.categoryId === null);
  const yesterday = addDays(today, -1);
  return (
    <li className="space-y-3 rounded-xl border border-line bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Tipo do lançamento" className="inline-flex overflow-x-auto rounded-lg border border-line bg-subtle p-0.5">
          {(Object.keys(KIND_LABELS) as PfTxKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={d.kind === kind}
              onClick={() => onChange({ kind, categoryId: null, suggestedCategoryId: null })}
              className={cn('h-7 rounded-md px-2.5 text-xs font-medium', d.kind === kind ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink')}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        {total > 1 ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover lançamento ${index + 1}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Valor" required error={doubt('amount') ? 'Não entendi o valor.' : undefined}>
          <MoneyInput value={d.amount} onValueChange={(v) => onChange({ amount: v })} className="text-lg font-semibold" autoFocus={index === 0 && !d.fromVoice} />
        </Field>
        <Field label="Descrição">
          <Input value={d.description} onChange={(e) => onChange({ description: e.target.value })} maxLength={200} placeholder="Ex.: mercado, uber…" />
        </Field>
      </div>

      {d.kind !== 'TRANSFERENCIA' ? (
        <div className="space-y-1.5">
          <span className={cn('text-sm font-medium', doubt('category') ? 'text-warning' : 'text-ink')}>Categoria{doubt('category') ? ' (escolha uma)' : ''}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Categoria">
            {options.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={d.categoryId === c.id}
                onClick={() => onChange({ categoryId: d.categoryId === c.id ? null : c.id })}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  d.categoryId === c.id ? 'border-accent bg-accent-soft font-medium text-accent-ink' : 'border-line bg-panel text-ink-soft hover:bg-subtle',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={d.kind === 'TRANSFERENCIA' ? 'Sai da conta' : d.kind === 'ENTRADA' ? 'Entra na conta' : 'Paga com'}>
          <Select value={d.accountId ?? defaultAccount ?? ''} onChange={(e) => onChange({ accountId: e.target.value ? Number(e.target.value) : null })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {d.kind === 'TRANSFERENCIA' ? (
          <Field label="Vai para a conta">
            <Select value={d.toAccountId ?? ''} onChange={(e) => onChange({ toAccountId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Escolha…</option>
              {accounts
                .filter((a) => a.id !== (d.accountId ?? defaultAccount))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Data">
          <div className="flex flex-wrap items-center gap-1.5">
            <Input type="date" max={today} value={d.date} onChange={(e) => onChange({ date: e.target.value })} className="w-auto" />
            <Button type="button" size="sm" variant={d.date === today ? 'primary' : 'outline'} onClick={() => onChange({ date: today })}>
              Hoje
            </Button>
            <Button type="button" size="sm" variant={d.date === yesterday ? 'primary' : 'outline'} onClick={() => onChange({ date: yesterday })}>
              Ontem
            </Button>
          </div>
        </Field>
      </div>

      {d.installments ? (
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-info-soft p-3 text-sm text-info">
          <p className="col-span-2">
            Compra parcelada: o valor acima é de <strong>cada parcela</strong>. Ela entra em Parcelas e contas e some do seu limite do dia só no mês que vencer.
          </p>
          <Field label="Parcelas">
            <DecimalInput decimals={0} value={d.installments.count} onValueChange={(v) => onChange({ installments: { ...d.installments!, count: v } })} />
          </Field>
          <Field label="1ª parcela vence">
            <Input type="date" value={d.installments.firstDue} onChange={(e) => onChange({ installments: { ...d.installments!, firstDue: e.target.value } })} />
          </Field>
        </div>
      ) : null}
    </li>
  );
}
