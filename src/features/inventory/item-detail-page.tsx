import { ArrowDownToLine, ArrowLeft, Ban, MinusCircle, Pencil, RotateCcw, Scale, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { ExportMenu } from '@/components/shared/export-menu';
import { ColorDot, Qty, RemainingBar } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  KIND_LABELS,
  LOT_STATUS_LABELS,
  type LotRow,
  MATERIAL_LABELS,
  MOVEMENT_LABELS,
  type MovementRow,
  movementSourceHref,
  TOOL_CONDITION_LABELS,
  useDiscardLot,
  useItem,
  useLots,
  useMovements,
  useOpenLot,
  useReverseMovement,
  useSetItemActive,
} from '@/data/inventory';
import { useMember } from '@/features/member/member-context';
import { cn } from '@/lib/cn';
import { formatDateBR, formatDateTimeBR, startOfMonth } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatNumber, formatQty, toNumber } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';
import { AdjustStockDialog, OpeningBalanceDialog, StockIssueDialog } from './stock-dialogs';

function Kardex({ itemId, unit }: { itemId: number; unit: string }) {
  const { today, can, settings } = useMember();
  const [range, setRange] = useState({ from: startOfMonth(today()), to: today() });
  const [filtered, setFiltered] = useState(false);
  const movements = useMovements(itemId, filtered ? range : undefined);
  const [reversing, setReversing] = useState<MovementRow | null>(null);
  const reverse = useReverseMovement(() => setReversing(null));
  const rows = movements.data?.rows ?? [];
  const entries = rows.filter((m) => toNumber(m.qty) > 0).reduce((s, m) => s + toNumber(m.qty), 0);
  const exits = rows.filter((m) => toNumber(m.qty) < 0).reduce((s, m) => s + toNumber(m.qty), 0);
  const opening = movements.data?.opening ?? 0;
  const exportColumns: ExportColumn<MovementRow>[] = [
    { header: 'Data', value: (m) => formatDateTimeBR(m.occurred_at, settings.timezone) },
    { header: 'Tipo', value: (m) => MOVEMENT_LABELS[m.type] },
    { header: 'Quantidade', value: (m) => m.qty, kind: 'number' },
    { header: 'Custo unitário', value: (m) => m.unit_cost_total, kind: 'number' },
    { header: 'Saldo após', value: (m) => m.qty_after, kind: 'number' },
    { header: 'Custo médio após', value: (m) => m.avg_cost_after, kind: 'number' },
    { header: 'Origem', value: (m) => m.source_ref ?? m.reason ?? '' },
    { header: 'Usuário', value: (m) => m.created_by_name ?? '' },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">
          De
          <Input type="date" className="h-9 w-auto" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </label>
        <label className="text-xs text-muted">
          Até
          <Input type="date" className="h-9 w-auto" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </label>
        <Button size="sm" variant={filtered ? 'primary' : 'outline'} onClick={() => setFiltered((f) => !f)}>
          {filtered ? 'Mostrando o período' : 'Filtrar período'}
        </Button>
        <ExportMenu rows={rows} columns={exportColumns} fileName={`extrato-item-${itemId}`} />
      </div>
      {filtered ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Saldo inicial do período" value={opening} format={(v) => formatQty(v, unit)} />
          <Stat label="Entradas" value={entries} format={(v) => formatQty(v, unit)} />
          <Stat label="Saídas" value={-exits} format={(v) => formatQty(v, unit)} />
          <Stat label="Saldo final" value={opening + entries + exits} format={(v) => formatQty(v, unit)} />
        </div>
      ) : null}
      {movements.isError ? (
        <ErrorState error={movements.error} />
      ) : !movements.data ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title="Sem movimentações" description="Entradas e saídas aparecem aqui, da mais recente para a mais antiga." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel">
          {rows.map((m) => {
            const href = movementSourceHref(m);
            const positive = toNumber(m.qty) > 0;
            return (
              <li key={m.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm', m.is_reversed && 'opacity-60')}>
                <span className="w-32 shrink-0 text-xs text-muted">{formatDateTimeBR(m.occurred_at, settings.timezone)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{MOVEMENT_LABELS[m.type]}</span>
                  {m.lot_code ? <span className="ml-1.5 text-xs text-muted">{m.lot_code}</span> : null}
                  {m.is_reversed ? <Badge className="ml-1.5">estornado</Badge> : null}
                  <span className="block truncate text-xs text-muted">
                    {href && m.source_ref ? (
                      <Link to={href} className="underline decoration-accent decoration-2 underline-offset-2">
                        {m.source_ref}
                      </Link>
                    ) : null}
                    {m.reason ? `${m.source_ref ? ' · ' : ''}${m.reason}` : ''}
                    {m.created_by_name ? ` · ${m.created_by_name}` : ''}
                  </span>
                </span>
                <span className={cn('num w-24 text-right font-semibold', positive ? 'text-success' : 'text-ink')}>
                  {positive ? '+' : ''}
                  {formatQty(m.qty, unit)}
                </span>
                {can('costs') ? (
                  <span className="num w-24 text-right text-xs text-muted" title="Custo unitário">
                    <Money value={m.unit_cost_total} cost />
                  </span>
                ) : null}
                <span className="num w-24 text-right text-xs text-muted" title="Saldo após">
                  {formatQty(m.qty_after, unit)}
                </span>
                {can('write') && m.is_standalone && !m.is_reversed && m.type !== 'REVERSAL' ? (
                  <Button size="icon-sm" variant="ghost" aria-label="Estornar" title="Estornar" onClick={() => setReversing(m)}>
                    <RotateCcw />
                  </Button>
                ) : (
                  <span className="w-8" />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted">Movimentações geradas por compras, impressões e vendas são estornadas pelo documento de origem.</p>
      <ReasonDialog
        open={reversing !== null}
        onOpenChange={(open) => !open && setReversing(null)}
        title="Estornar movimentação?"
        description={reversing ? `Cria o movimento inverso de "${MOVEMENT_LABELS[reversing.type]}" (${formatQty(reversing.qty, unit)}) com o mesmo custo. Nada é apagado.` : ''}
        confirmLabel="Estornar"
        onConfirm={(reason) => reverse.mutateAsync({ movementId: reversing!.id, reason })}
      />
    </div>
  );
}

const LOT_ORDER: Record<LotRow['status'], number> = { ABERTO: 0, FECHADO: 1, ESGOTADO: 2, DESCARTADO: 3 };

function Lots({ itemId, onWeigh }: { itemId: number; onWeigh: (lot: LotRow) => void }) {
  const { can } = useMember();
  const lots = useLots(itemId);
  const [requestId, renew] = useRequestId();
  const [discarding, setDiscarding] = useState<LotRow | null>(null);
  const discard = useDiscardLot(() => {
    renew();
    setDiscarding(null);
  });
  const open = useOpenLot();
  if (!lots.data) return <LoadingBlock rows={2} />;
  if (lots.data.length === 0) return <EmptyState title="Nenhum carretel" description="Carretéis entram pelo saldo inicial ou pelo recebimento de compras." />;
  return (
    <>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[...lots.data].sort((a, b) => LOT_ORDER[a.status] - LOT_ORDER[b.status]).map((lot) => (
          <li key={lot.id} className={cn('rounded-[var(--radius-card)] border border-line bg-panel p-3', ['ESGOTADO', 'DESCARTADO'].includes(lot.status) && 'opacity-60')}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{lot.lot_code}</span>
              <Badge tone={lot.status === 'ABERTO' ? 'accent' : lot.status === 'FECHADO' ? 'neutral' : 'danger'}>{LOT_STATUS_LABELS[lot.status]}</Badge>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <RemainingBar pct={lot.remaining_pct} />
              <span className="num shrink-0 text-sm font-medium">{formatQty(lot.qty_remaining, 'G')}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              de {formatQty(lot.qty_initial, 'G')} · recebido {formatDateBR(lot.received_at.slice(0, 10))}
              {lot.opened_at ? ` · aberto ${formatDateBR(lot.opened_at.slice(0, 10))}` : ''}
              {lot.reference_cost ? ' · custo de referência' : ''}
            </p>
            {['ABERTO', 'FECHADO'].includes(lot.status) && toNumber(lot.qty_remaining) > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {can('write') ? (
                  <Button size="sm" variant="outline" onClick={() => onWeigh(lot)}>
                    <Scale /> Pesar
                  </Button>
                ) : null}
                {lot.status === 'FECHADO' && can('production') ? (
                  <Button size="sm" variant="ghost" onClick={() => open.mutate(lot.id)}>
                    Marcar aberto
                  </Button>
                ) : null}
                {can('production') ? (
                  <Button size="sm" variant="ghost" onClick={() => setDiscarding(lot)}>
                    <Trash2 /> Descartar resto
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <ReasonDialog
        open={discarding !== null}
        onOpenChange={(o) => !o && setDiscarding(null)}
        title="Descartar o resto do carretel?"
        description={discarding ? `Os ${formatQty(discarding.qty_remaining, 'G')} restantes de ${discarding.lot_code} saem como perda.` : ''}
        confirmLabel="Descartar"
        reasonLabel="Motivo (ex.: umidade)"
        onConfirm={(reason) => discard.mutateAsync({ requestId, lotId: discarding!.id, reason })}
      />
    </>
  );
}

export function ItemDetailPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const { can } = useMember();
  const item = useItem(itemId);
  const [dialog, setDialog] = useState<'opening' | 'issue' | 'adjust' | null>(null);
  const [weighLot, setWeighLot] = useState<number | undefined>();
  const [deactivating, setDeactivating] = useState(false);
  const setActive = useSetItemActive();

  if (item.isError) return <Page><ErrorState error={item.error} onRetry={() => void item.refetch()} /></Page>;
  if (!item.data) return <Page><LoadingBlock /></Page>;
  const it = item.data;
  const filament = it.kind === 'FILAMENT';

  return (
    <Page>
      <PageHeader
        back={
          <Link to={`/estoque?tipo=${it.kind}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Estoque
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-2.5">
            {filament ? <ColorDot hex={it.color_hex} className="size-5" /> : null}
            {it.name}
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {it.sku} <Badge>{KIND_LABELS[it.kind]}</Badge> {!it.active ? <Badge tone="danger">desativado</Badge> : null}
            {it.below_minimum ? <Badge tone="warning">abaixo do mínimo</Badge> : null}
          </span>
        }
        actions={
          can('write') || can('production') ? (
            <>
              {can('write') && it.last_movement_at === null ? (
                <Button variant="outline" onClick={() => setDialog('opening')}>
                  <ArrowDownToLine /> Saldo inicial
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setDialog('issue')}>
                <MinusCircle /> Saída avulsa
              </Button>
              {can('write') ? (
                <Button variant="outline" onClick={() => setDialog('adjust')}>
                  <Scale /> {filament ? 'Pesar / ajustar' : 'Ajustar'}
                </Button>
              ) : null}
              {can('write') && it.kind !== 'FINISHED_GOOD' ? (
                <Button asChild>
                  <Link to={`/estoque/itens/${it.id}/editar`}>
                    <Pencil /> Editar
                  </Link>
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo" value={it.qty_on_hand} format={(v) => formatQty(v, it.unit)} hint={toNumber(it.qty_reserved) > 0 ? `${formatQty(it.qty_reserved, it.unit)} reservado(s)` : undefined} />
        {can('costs') ? (
          <>
            <Stat
              label={filament ? 'Custo médio por kg' : 'Custo médio'}
              value={filament ? toNumber(it.avg_cost_total) * 1000 : it.avg_cost_total}
              estimated={it.reference_cost}
              estimatedHint="Inclui carretéis com custo de referência"
            />
            <Stat label="Valor em estoque" value={it.kind === 'TOOL' ? it.tool_acquisition_value : it.value_total} hint={it.kind === 'TOOL' ? 'Valor de aquisição (informativo)' : undefined} />
          </>
        ) : null}
        <Stat
          label="Cobertura"
          value={it.coverage_days}
          format={(v) => (v === null || v === undefined ? '—' : `${formatNumber(v, 0)} dias`)}
          hint={it.daily_consumption ? `Consumo médio ${formatQty(it.daily_consumption, it.unit)}/dia (30 dias)` : 'Sem consumo nos últimos 30 dias'}
        />
      </div>

      <Tabs defaultValue={filament ? 'lots' : 'movements'}>
        <TabsList>
          {filament ? <TabsTrigger value="lots">Carretéis</TabsTrigger> : null}
          <TabsTrigger value="movements">Movimentações</TabsTrigger>
          <TabsTrigger value="data">Dados</TabsTrigger>
        </TabsList>
        {filament ? (
          <TabsContent value="lots">
            <Lots
              itemId={it.id}
              onWeigh={(lot) => {
                setWeighLot(lot.id);
                setDialog('adjust');
              }}
            />
          </TabsContent>
        ) : null}
        <TabsContent value="movements">
          <Kardex itemId={it.id} unit={it.unit} />
        </TabsContent>
        <TabsContent value="data">
          <Card>
            <CardHeader title="Cadastro" />
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              {filament ? (
                <>
                  <Info label="Material" value={it.material ? MATERIAL_LABELS[it.material] : '—'} />
                  <Info label="Marca" value={it.brand || '—'} />
                  <Info label="Cor" value={it.color_name ?? '—'} />
                  <Info label="Diâmetro" value={`${formatNumber(it.diameter_mm, 2)} mm`} />
                  <Info label="Densidade" value={`${formatNumber(it.density_g_cm3, 3)} g/cm³`} />
                  <Info label="Carretel nominal / tara" value={`${formatQty(it.nominal_spool_g, 'G')} / ${formatQty(it.empty_spool_tare_g, 'G')}`} />
                  <Info label="Precisa secar" value={it.needs_drying ? 'Sim' : 'Não'} />
                </>
              ) : null}
              {it.kind === 'TOOL' ? <Info label="Condição" value={it.tool_condition ? TOOL_CONDITION_LABELS[it.tool_condition] : '—'} /> : null}
              <Info label="Unidade" value={it.unit.toLowerCase()} />
              <Info label="Estoque mínimo" value={toNumber(it.min_qty) > 0 ? <Qty value={it.min_qty} unit={it.unit} /> : '—'} />
              <Info label="Recompra sugerida" value={toNumber(it.reorder_qty) > 0 ? <Qty value={it.reorder_qty} unit={it.unit} /> : '—'} />
              <Info label="Local" value={it.location ?? '—'} />
              <Info label="Fornecedor padrão" value={it.default_supplier_name ?? '—'} />
              {it.notes ? <Info label="Observações" value={it.notes} /> : null}
            </dl>
            {can('write') && it.kind !== 'FINISHED_GOOD' ? (
              <div className="border-t border-line p-4">
                <Button variant={it.active ? 'danger-outline' : 'outline'} size="sm" onClick={() => (it.active ? setDeactivating(true) : setActive.mutate({ id: it.id, active: true }))}>
                  <Ban /> {it.active ? 'Desativar item' : 'Reativar item'}
                </Button>
              </div>
            ) : null}
          </Card>
        </TabsContent>
      </Tabs>

      <OpeningBalanceDialog item={it} open={dialog === 'opening'} onOpenChange={(o) => setDialog(o ? 'opening' : null)} />
      <StockIssueDialog item={it} open={dialog === 'issue'} onOpenChange={(o) => setDialog(o ? 'issue' : null)} />
      <AdjustStockDialog
        key={weighLot ?? 'none'}
        item={it}
        initialLotId={weighLot}
        open={dialog === 'adjust'}
        onOpenChange={(o) => {
          setDialog(o ? 'adjust' : null);
          if (!o) setWeighLot(undefined);
        }}
      />
      <ConfirmDialog
        open={deactivating}
        onOpenChange={setDeactivating}
        title="Desativar este item?"
        description="Ele some das listas de seleção (compras, fichas, vendas), mas continua nos relatórios e no histórico. Dá para reativar depois."
        confirmLabel="Desativar"
        onConfirm={() => setActive.mutateAsync({ id: it.id, active: false })}
      />
    </Page>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
