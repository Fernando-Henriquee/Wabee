import { Ban, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { PeriodPresets, useDateRange } from '@/components/shared/period-presets';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { MoneyInput, PercentInput } from '@/components/ui/money-input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useSuppliers } from '@/data/inventory';
import {
  EXPENSE_NATURES,
  FUNDING_LABELS,
  type InstallmentRow,
  type OwnerFundingType,
  type Payable,
  type Payer,
  useAccounts,
  useCancelExpense,
  useCategories,
  useCreateExpense,
  useInstallments,
  usePayables,
} from '@/data/finance';
import { useMember } from '@/features/member/member-context';
import { sumMoney } from '@/lib/calc';
import { formatDateBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { formatBRL, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { FinanceNav } from './finance-nav';
import { PayInstallmentDialog } from './installment-dialogs';

const STATUS: Record<Payable['status'], { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  ABERTO: { label: 'A pagar', tone: 'warning' },
  PARCIAL: { label: 'Parcial', tone: 'warning' },
  QUITADO: { label: 'Paga', tone: 'success' },
  CANCELADO: { label: 'Cancelada', tone: 'danger' },
};

/** Despesas avulsas (US-7.6): internet, assinaturas, DAS, manutenção… com uso misto e pagamento pelo dono. */
export function ExpensesPage() {
  const { can } = useMember();
  const [range, setRange] = useDateRange('mes');
  const payables = usePayables({ sourceType: 'expense', from: range.from, to: range.to });
  const categories = useCategories();
  const open = useInstallments({ kind: 'PAGAR', status: 'ABERTA', sourceType: 'expense' });
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<InstallmentRow | null>(null);
  const [canceling, setCanceling] = useState<Payable | null>(null);
  const cancel = useCancelExpense(() => setCanceling(null));
  const categoryName = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, `${c.code} ${c.name}`])), [categories.data]);
  const openByPayable = useMemo(() => new Map((open.data ?? []).map((i) => [i.payable_id, i])), [open.data]);
  const rows = payables.data ?? [];
  const active = rows.filter((r) => r.status !== 'CANCELADO');

  const columns: Column<Payable>[] = [
    { key: 'date', header: 'Competência', sortValue: (r) => r.issue_date, cell: (r) => formatDateBR(r.issue_date) },
    {
      key: 'description',
      header: 'Despesa',
      sortValue: (r) => r.description,
      cell: (r) => (
        <span>
          {r.description}
          <span className="block text-xs text-muted">
            {r.number} · {categoryName.get(r.category_id) ?? ''}
          </span>
        </span>
      ),
    },
    { key: 'payer', header: 'Pagador', cell: (r) => (r.payer === 'DONO' ? <Badge tone="accent">dono{r.owner_funding_type ? ` · ${FUNDING_LABELS[r.owner_funding_type].toLowerCase()}` : ''}</Badge> : 'Empresa') },
    { key: 'status', header: 'Situação', cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    { key: 'total', header: 'Valor', align: 'right', sortValue: (r) => toNumber(r.total), cell: (r) => <Money value={r.total} className={r.status === 'CANCELADO' ? 'text-muted line-through' : 'font-medium'} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => <RowActions payable={r} installment={openByPayable.get(r.id)} canWrite={can('write')} onPay={setPaying} onCancel={setCanceling} />,
    },
  ];
  const exportColumns: ExportColumn<Payable>[] = [
    { header: 'Competência', value: (r) => formatDateBR(r.issue_date) },
    { header: 'Número', value: (r) => r.number },
    { header: 'Descrição', value: (r) => r.description },
    { header: 'Categoria', value: (r) => categoryName.get(r.category_id) ?? '' },
    { header: 'Pagador', value: (r) => (r.payer === 'DONO' ? 'Dono' : 'Empresa') },
    { header: 'Situação', value: (r) => STATUS[r.status].label },
    { header: 'Valor', value: (r) => r.total, kind: 'money' },
  ];

  return (
    <Page>
      <PageHeader
        title="Despesas"
        description="Gastos que não são compra de estoque. Uso misto (ex.: internet da casa) lança só a parte da empresa."
        actions={
          can('write') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nova despesa
            </Button>
          ) : undefined
        }
      />
      <FinanceNav />
      <div className="mb-4">
        <PeriodPresets range={range} onChange={setRange} />
      </div>
      {payables.isError ? (
        <ErrorState error={payables.error} onRetry={() => void payables.refetch()} />
      ) : !payables.data ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => String(r.id)}
          searchText={(r) => `${r.description} ${r.number} ${categoryName.get(r.category_id) ?? ''}`}
          initialSort={{ key: 'date', direction: 'desc' }}
          toolbar={<ExportMenu rows={rows} columns={exportColumns} fileName="despesas" />}
          emptyTitle="Nenhuma despesa no período"
          emptyDescription="Lance internet, assinaturas, DAS, manutenção e outros gastos do negócio."
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.description}</p>
                <p className="text-xs text-muted">
                  {formatDateBR(r.issue_date)} · {categoryName.get(r.category_id) ?? ''}
                </p>
                <p className="mt-1 flex gap-1">
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  {r.payer === 'DONO' ? <Badge tone="accent">dono</Badge> : null}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Money value={r.total} className="text-sm font-semibold" />
                <RowActions payable={r} installment={openByPayable.get(r.id)} canWrite={can('write')} onPay={setPaying} onCancel={setCanceling} />
              </div>
            </div>
          )}
          footer={
            <tr>
              <td className="px-3 py-2.5 text-sm font-medium" colSpan={4}>
                Total do período (sem canceladas)
              </td>
              <td className="px-3 py-2.5 text-right text-sm font-semibold">
                <Money value={sumMoney(active.map((r) => r.total))} />
              </td>
              <td />
            </tr>
          }
        />
      )}
      {creating ? <ExpenseDialog onOpenChange={setCreating} /> : null}
      {paying ? <PayInstallmentDialog installment={paying} onOpenChange={(o) => !o && setPaying(null)} /> : null}
      <ReasonDialog
        open={canceling !== null}
        onOpenChange={(o) => !o && setCanceling(null)}
        title="Cancelar esta despesa?"
        description={canceling ? `${canceling.description} (${formatBRL(canceling.total)}) sai do DRE e de contas a pagar.` : ''}
        confirmLabel="Cancelar despesa"
        onConfirm={(reason) => cancel.mutateAsync({ payableId: canceling!.id, reason })}
      />
    </Page>
  );
}

function RowActions({
  payable,
  installment,
  canWrite,
  onPay,
  onCancel,
}: {
  payable: Payable;
  installment: InstallmentRow | undefined;
  canWrite: boolean;
  onPay: (i: InstallmentRow) => void;
  onCancel: (p: Payable) => void;
}) {
  if (!canWrite || payable.status === 'CANCELADO' || payable.status === 'QUITADO') return null;
  return (
    <span className="inline-flex gap-1">
      {installment ? (
        <Button size="sm" variant="outline" onClick={() => onPay(installment)}>
          Pagar
        </Button>
      ) : null}
      {payable.status === 'ABERTO' ? (
        <Button size="icon-sm" variant="ghost" aria-label="Cancelar despesa" title="Cancelar despesa" onClick={() => onCancel(payable)}>
          <Ban />
        </Button>
      ) : null}
    </span>
  );
}

function ExpenseDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { today, settings } = useMember();
  const [requestId, renew] = useRequestId();
  const categories = useCategories();
  const accounts = useAccounts();
  const suppliers = useSuppliers();
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>('1');
  const [competence, setCompetence] = useState(today());
  const [due, setDue] = useState(today());
  const [supplierId, setSupplierId] = useState('');
  const [paid, setPaid] = useState(true);
  const [paidOn, setPaidOn] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [payer, setPayer] = useState<Payer>('EMPRESA');
  const [funding, setFunding] = useState<OwnerFundingType>(settings.default_owner_funding_type);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateExpense(() => {
    renew();
    onOpenChange(false);
  });

  const groups = (categories.data ?? []).filter((c) => c.parent_id === null && EXPENSE_NATURES.includes(c.nature));
  const children = (categories.data ?? []).filter((c) => c.parent_id !== null && c.active && EXPENSE_NATURES.includes(c.nature));
  const account = accounts.data?.find((a) => String(a.id) === accountId);
  const effectivePayer: Payer = account?.owner === 'DONO' ? 'DONO' : payer;
  const companyShare = amount && share ? Math.round(toNumber(amount) * toNumber(share) * 100) / 100 : null;

  const submit = () => {
    setError(null);
    if (description.trim().length < 2) return setError('Descreva a despesa.');
    if (!categoryId) return setError('Escolha a categoria.');
    if (!amount || toNumber(amount) <= 0) return setError('Informe o valor.');
    if (paid && effectivePayer === 'EMPRESA' && !accountId) return setError('Escolha de qual conta saiu o dinheiro.');
    create.mutate(
      {
        requestId,
        description: description.trim(),
        category_id: Number(categoryId),
        amount,
        business_share_pct: share ?? '1',
        competence_date: competence,
        due_date: paid ? paidOn : due,
        supplier_id: supplierId ? Number(supplierId) : null,
        paid,
        paid_on: paid ? paidOn : null,
        account_id: accountId ? Number(accountId) : null,
        payer: effectivePayer,
        owner_funding_type: effectivePayer === 'DONO' ? funding : null,
      },
      { onError: (e) => setError(describeError(e)) },
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title="Nova despesa"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button loading={create.isPending} onClick={submit}>
              Lançar despesa
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Descrição" required className="sm:col-span-2">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Ex.: Internet de outubro" autoFocus />
            </Field>
            <Field label="Categoria" required>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Escolha…</option>
                {groups.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {children
                      .filter((c) => c.parent_id === g.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} {c.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Fornecedor">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">—</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Valor total" required>
              <MoneyInput value={amount} onValueChange={setAmount} />
            </Field>
            <Field label="Parte da empresa" hint={companyShare !== null && toNumber(share) < 1 ? `Lança ${formatBRL(companyShare)} (só esta parte entra no DRE)` : 'Uso misto? Ex.: 30% da internet da casa.'}>
              <PercentInput value={share} onValueChange={setShare} />
            </Field>
            <Field label="Competência" hint="Mês a que a despesa se refere (DRE).">
              <Input type="date" value={competence} onChange={(e) => setCompetence(e.target.value)} />
            </Field>
          </div>

          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Já foi paga
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {paid ? (
              <Field label="Pago em">
                <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </Field>
            ) : (
              <Field label="Vencimento">
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </Field>
            )}
            <Field label={paid ? 'De onde saiu o dinheiro' : 'Será paga por'}>
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">{paid ? 'Escolha…' : 'Definir no pagamento'}</option>
                {(accounts.data ?? [])
                  .filter((a) => a.owner === 'DONO' || a.kind !== 'CARTAO_CREDITO')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} {a.owner === 'DONO' ? '(dono)' : ''}
                    </option>
                  ))}
              </Select>
            </Field>
            {!account ? (
              <Field label="Quem paga">
                <Select value={payer} onChange={(e) => setPayer(e.target.value as Payer)}>
                  <option value="EMPRESA">Empresa</option>
                  <option value="DONO">Dono</option>
                </Select>
              </Field>
            ) : null}
            {effectivePayer === 'DONO' ? (
              <Field label="Como fica para o dono" hint="O dono pagou do próprio bolso.">
                <Select value={funding} onChange={(e) => setFunding(e.target.value as OwnerFundingType)}>
                  {(Object.keys(FUNDING_LABELS) as OwnerFundingType[]).map((f) => (
                    <option key={f} value={f}>
                      {FUNDING_LABELS[f]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
