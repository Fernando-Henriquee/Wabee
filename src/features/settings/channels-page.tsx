import { History, Pencil, Plus, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Page, PageHeader } from '@/components/layout/page';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { CHANNEL_KIND_LABELS, type ChannelWithFees, FEE_FIXED_PER_LABELS, useSalesChannelsWithFees, useSaveSettings } from '@/data/settings';
import { useMember } from '@/features/member/member-context';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatBRL, formatPercent, toNumber } from '@/lib/money';
import { BackLink, NoAccess } from './bits';
import { ChannelDialog, FeeHistory } from './channel-dialog';
import { describeFee, payoutLabel } from './channel-format';

function ChannelName({ row, isDefault }: { row: ChannelWithFees; isDefault: boolean }) {
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
        {row.name}
        {isDefault ? <Badge tone="accent">padrão</Badge> : null}
        {row.active ? null : <Badge>inativo</Badge>}
      </span>
      <span className="block text-xs font-normal text-muted">{CHANNEL_KIND_LABELS[row.kind]}</span>
    </span>
  );
}

export function ChannelsPage() {
  const { can, today, settings } = useMember();
  const channels = useSalesChannelsWithFees(today());
  const [editing, setEditing] = useState<{ channel: ChannelWithFees | null } | null>(null);
  const [history, setHistory] = useState<ChannelWithFees | null>(null);
  const setDefault = useSaveSettings({ success: 'Canal padrão alterado.' });

  const rows = useMemo(() => [...(channels.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR')), [channels.data]);
  const isDefault = (row: ChannelWithFees) => row.id === settings.default_channel_id;

  const columns = useMemo<Column<ChannelWithFees>[]>(
    () => [
      { key: 'name', header: 'Canal', sortValue: (r) => r.name, cell: (r) => <ChannelName row={r} isDefault={r.id === settings.default_channel_id} /> },
      { key: 'fee', header: 'Taxa do canal', align: 'right', sortValue: (r) => toNumber(r.current?.fee_pct), cell: (r) => <span className="num">{formatPercent(r.current?.fee_pct ?? 0, 2)}</span> },
      {
        key: 'fixed',
        header: 'Taxa fixa',
        align: 'right',
        sortValue: (r) => toNumber(r.current?.fee_fixed),
        cell: (r) =>
          toNumber(r.current?.fee_fixed) > 0 ? (
            <span className="num">
              {formatBRL(r.current!.fee_fixed)} <span className="text-xs text-muted">{FEE_FIXED_PER_LABELS[r.current!.fee_fixed_per]}</span>
            </span>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      { key: 'payment', header: 'Pagamento', align: 'right', sortValue: (r) => toNumber(r.current?.payment_fee_pct), cell: (r) => <span className="num">{formatPercent(r.current?.payment_fee_pct ?? 0, 2)}</span> },
      { key: 'payout', header: 'Recebe', sortValue: (r) => r.payout_days, cell: (r) => payoutLabel(r.payout_days) },
      {
        key: 'since',
        header: 'Vigência',
        cell: (r) => (
          <span className="text-xs text-muted">
            {r.current ? `desde ${formatDateBR(r.current.valid_from)}` : 'sem tabela vigente'}
            {r.scheduled ? <span className="block text-info">nova tabela em {formatDateBR(r.scheduled.valid_from)}</span> : null}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (r) => (
          <span className="inline-flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={`Histórico de taxas de ${r.name}`} title="Histórico de taxas" onClick={() => setHistory(r)}>
              <History />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Editar ${r.name}`} title="Editar" onClick={() => setEditing({ channel: r })}>
              <Pencil />
            </Button>
          </span>
        ),
      },
    ],
    [settings.default_channel_id],
  );

  const exportColumns: ExportColumn<ChannelWithFees>[] = [
    { header: 'Canal', value: (r) => r.name },
    { header: 'Tipo', value: (r) => CHANNEL_KIND_LABELS[r.kind] },
    { header: 'Ativo', value: (r) => r.active, kind: 'boolean' },
    { header: 'Taxa do canal (%)', value: (r) => toNumber(r.current?.fee_pct) * 100, kind: 'number' },
    { header: 'Taxa fixa', value: (r) => r.current?.fee_fixed ?? 0, kind: 'money' },
    { header: 'Taxa fixa por', value: (r) => (r.current ? FEE_FIXED_PER_LABELS[r.current.fee_fixed_per] : '') },
    { header: 'Taxa de pagamento (%)', value: (r) => toNumber(r.current?.payment_fee_pct) * 100, kind: 'number' },
    { header: 'Dias para receber', value: (r) => r.payout_days, kind: 'number' },
    { header: 'Vigente desde', value: (r) => r.current?.valid_from ?? null, kind: 'date' },
  ];

  if (!can('settings')) return <NoAccess title="Canais e taxas" />;

  return (
    <Page>
      <PageHeader
        back={<BackLink />}
        title="Canais e taxas"
        description="Onde a Wabee vende. Mudou uma taxa? Edite o canal e diga desde quando vale: vendas anteriores continuam com a taxa antiga."
        actions={
          <Button onClick={() => setEditing({ channel: null })}>
            <Plus /> Novo canal
          </Button>
        }
      />
      {channels.isError ? (
        <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
      ) : !channels.data ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => String(r.id)}
          searchText={(r) => `${r.name} ${CHANNEL_KIND_LABELS[r.kind]}`}
          searchPlaceholder="Pesquisar canal…"
          toolbar={<ExportMenu rows={rows} columns={exportColumns} fileName="canais-de-venda" />}
          rowClassName={(r) => (r.active ? undefined : 'opacity-70')}
          emptyTitle="Nenhum canal cadastrado"
          emptyDescription="Cadastre onde você vende: venda direta, Instagram, feiras, Shopee…"
          mobileCard={(r) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <ChannelName row={r} isDefault={isDefault(r)} />
                <span className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Histórico de taxas de ${r.name}`} onClick={() => setHistory(r)}>
                    <History />
                  </Button>
                  <Button variant="outline" size="icon" aria-label={`Editar ${r.name}`} onClick={() => setEditing({ channel: r })}>
                    <Pencil />
                  </Button>
                </span>
              </div>
              <p className="num text-sm text-ink">{describeFee(r.current)}</p>
              <p className="text-xs text-muted">
                Recebe {payoutLabel(r.payout_days)}
                {r.current ? ` · taxas desde ${formatDateBR(r.current.valid_from)}` : ''}
                {r.scheduled ? ` · nova tabela em ${formatDateBR(r.scheduled.valid_from)}` : ''}
              </p>
            </div>
          )}
        />
      )}

      <ChannelDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        channel={editing?.channel ?? null}
        isDefault={editing?.channel ? isDefault(editing.channel) : false}
      />

      <Dialog open={history !== null} onOpenChange={(open) => !open && setHistory(null)}>
        {history ? (
          <DialogContent
            title={`Taxas — ${history.name}`}
            description="Cada venda usa a tabela vigente na data dela."
            footer={
              <>
                {history.active && !isDefault(history) ? (
                  <Button variant="outline" loading={setDefault.isPending} onClick={() => setDefault.mutate({ default_channel_id: history.id }, { onSuccess: () => setHistory(null) })}>
                    <Star /> Tornar padrão
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    const channel = history;
                    setHistory(null);
                    setEditing({ channel });
                  }}
                >
                  <Pencil /> Editar taxas
                </Button>
              </>
            }
          >
            <FeeHistory fees={history.fees} current={history.current} />
          </DialogContent>
        ) : null}
      </Dialog>
    </Page>
  );
}
