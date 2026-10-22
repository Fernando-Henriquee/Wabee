import { AlertTriangle, ArrowLeft, Gauge, Lock, Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { Stat } from '@/components/shared/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/states';
import { EQUIPMENT_KIND_LABELS, type EquipmentRow, RATE_MODE_LABELS, RATE_TYPE_LABELS, rateUnit, useCostRates, useEquipment, useEquipmentJobs, useRates } from '@/data/production';
import { useMember } from '@/features/member/member-context';
import { formatDateBR } from '@/lib/dates';
import { formatCost, formatNumber, formatPercent, toNumber } from '@/lib/money';
import { EquipmentStatusBadge, Info, JobMobileCard } from './bits';
import { formatHours } from './helpers';
import { historyExportColumns, useHistoryColumns } from './job-table';

export function EquipmentDetailPage() {
  const { id } = useParams();
  const equipment = useEquipment(Number(id));
  if (equipment.isError) return <Page><ErrorState error={equipment.error} onRetry={() => void equipment.refetch()} /></Page>;
  if (equipment.data === undefined) return <Page><LoadingBlock /></Page>;
  if (equipment.data === null)
    return (
      <Page>
        <EmptyState title="Equipamento não encontrado" action={<Button asChild variant="outline"><Link to="/producao/equipamentos">Equipamentos</Link></Button>} />
      </Page>
    );
  return <EquipmentDetail eq={equipment.data} />;
}

function EquipmentDetail({ eq }: { eq: EquipmentRow }) {
  const { can, settings } = useMember();
  const showCosts = can('costs');
  const jobs = useEquipmentJobs(eq.id);
  const columns = useHistoryColumns(showCosts, settings.timezone, false);
  const hoursUsed = toNumber(eq.hours_used);
  const printedHours = hoursUsed - toNumber(eq.initial_hours);
  const lifePct = eq.useful_life_hours ? hoursUsed / eq.useful_life_hours : null;
  const maintenancePct = eq.maintenance_interval_hours ? toNumber(eq.hours_since_maintenance) / eq.maintenance_interval_hours : null;

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/producao/equipamentos" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Equipamentos
          </Link>
        }
        title={eq.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {[EQUIPMENT_KIND_LABELS[eq.kind], eq.brand, eq.model].filter(Boolean).join(' · ')} <EquipmentStatusBadge status={eq.status} />
            {eq.printing_code ? <Badge tone="accent">imprimindo {eq.printing_code}</Badge> : null}
            {eq.fully_depreciated ? <Badge tone="info">totalmente depreciado</Badge> : null}
          </span>
        }
        actions={
          <>
            {showCosts ? (
              <Button asChild variant="outline">
                <Link to={`/producao/taxas?equipamento=${eq.id}`}>
                  <Gauge /> Taxas
                </Link>
              </Button>
            ) : null}
            {can('write') ? (
              <Button asChild>
                <Link to={`/producao/equipamentos/${eq.id}/editar`}>
                  <Pencil /> Editar
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {eq.maintenance_due ? (
        <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Manutenção próxima: {formatHours(eq.hours_since_maintenance)} desde a última, intervalo de {eq.maintenance_interval_hours} h.
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Horímetro (horas de uso)"
          value={eq.hours_used}
          format={(v) => formatHours(v)}
          hint={`${formatHours(eq.initial_hours)} iniciais + ${formatHours(printedHours)} de impressões${lifePct !== null ? ` · ${formatPercent(lifePct)} da vida útil` : ''}`}
        />
        <Stat label="Horas este mês" value={eq.hours_this_month} format={(v) => formatHours(v)} hint={`Ocupação ${formatPercent(eq.occupancy_month)} das horas do mês até agora`} />
        <Stat
          label="Desde a manutenção"
          value={eq.hours_since_maintenance}
          format={(v) => formatHours(v)}
          tone={eq.maintenance_due ? 'warning' : 'default'}
          hint={
            eq.maintenance_interval_hours
              ? `Intervalo ${eq.maintenance_interval_hours} h (${formatPercent(maintenancePct)})${eq.last_maintenance_at ? ` · última em ${formatDateBR(eq.last_maintenance_at)}` : ''}`
              : 'Sem intervalo de manutenção cadastrado'
          }
        />
        {showCosts ? (
          <Stat
            label="Valor contábil"
            value={eq.book_value}
            estimated
            estimatedHint="Valor de aquisição menos a depreciação lançada nas impressões"
            hint={
              <>
                Aquisição <Money value={eq.acquisition_cost} /> · depreciação acumulada <Money value={eq.accumulated_depreciation} />
              </>
            }
          />
        ) : null}
      </div>

      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">Impressões</TabsTrigger>
          {showCosts ? <TabsTrigger value="rates">Taxas vigentes</TabsTrigger> : null}
          <TabsTrigger value="data">Cadastro</TabsTrigger>
        </TabsList>
        <TabsContent value="jobs">
          {jobs.isError ? (
            <ErrorState error={jobs.error} />
          ) : !jobs.data ? (
            <LoadingBlock />
          ) : (
            <DataTable
              rows={jobs.data}
              columns={columns}
              getRowId={(r) => String(r.id)}
              rowHref={(r) => `/producao/impressoes/${r.id}`}
              searchText={(r) => `${r.code} ${r.outputs_summary ?? ''}`}
              searchPlaceholder="Pesquisar impressão…"
              initialSort={{ key: 'date', direction: 'desc' }}
              toolbar={<ExportMenu rows={jobs.data} columns={historyExportColumns(showCosts, settings.timezone)} fileName={`impressoes-${eq.name.toLowerCase().replace(/\s+/g, '-')}`} />}
              emptyTitle="Nenhuma impressão nesta máquina"
              emptyDescription="O horímetro soma o tempo de cada impressão concluída ou com falha."
              mobileCard={(r) => <JobMobileCard job={r} showCosts={showCosts} timeZone={settings.timezone} />}
            />
          )}
        </TabsContent>
        {showCosts ? (
          <TabsContent value="rates">
            <CurrentRates eq={eq} />
          </TabsContent>
        ) : null}
        <TabsContent value="data">
          <Card>
            <CardHeader title="Cadastro" />
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              <Info label="Tipo" value={EQUIPMENT_KIND_LABELS[eq.kind]} />
              <Info label="Marca / modelo" value={[eq.brand, eq.model].filter(Boolean).join(' ') || '—'} />
              <Info label="Número de série" value={eq.serial || '—'} />
              <Info label="Data de aquisição" value={formatDateBR(eq.acquired_at)} />
              {showCosts ? (
                <>
                  <Info
                    label="Valor de aquisição"
                    value={
                      <span className="inline-flex items-center gap-1">
                        <Money value={eq.acquisition_cost} />
                        {eq.purchase_line_id ? <Lock className="size-3.5 text-muted" aria-label="Valor da compra (travado)" /> : null}
                      </span>
                    }
                  />
                  <Info label="Valor residual" value={<Money value={eq.residual_value} />} />
                </>
              ) : null}
              <Info label="Vida útil" value={eq.useful_life_hours ? `${formatNumber(eq.useful_life_hours, 0)} h` : '—'} />
              <Info label="Potência média" value={eq.avg_power_w ? `${eq.avg_power_w} W` : '—'} />
              <Info label="Horas iniciais" value={formatHours(eq.initial_hours)} />
              <Info label="Intervalo de manutenção" value={eq.maintenance_interval_hours ? `${eq.maintenance_interval_hours} h` : '—'} />
              {eq.purchase_line_id ? <Info label="Origem" value="Recebimento de compra" /> : null}
              {eq.notes ? <Info label="Observações" value={<span className="whitespace-pre-line font-normal">{eq.notes}</span>} className="sm:col-span-2" /> : null}
            </dl>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function CurrentRates({ eq }: { eq: EquipmentRow }) {
  const { today } = useMember();
  const rates = useRates(eq.id, today());
  const list = useCostRates();
  const own = (list.data ?? []).filter((r) => r.equipment_id === eq.id && r.is_current);
  const r = rates.data;
  return (
    <Card>
      <CardHeader
        title="Taxas por hora vigentes hoje"
        description={r ? RATE_MODE_LABELS[r.mode] : undefined}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={`/producao/taxas?equipamento=${eq.id}`}>Ver vigências</Link>
          </Button>
        }
      />
      <div className="p-4">
        {!r ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Info label="Energia" value={r.mode === 'SPLIT' ? `${formatCost(r.energy_h, 4)}/h` : '—'} />
              <Info label="Depreciação" value={r.mode === 'SPLIT' ? `${formatCost(r.depreciation_h, 4)}/h` : '—'} />
              <Info label="Operacional combinada" value={r.mode === 'COMBINED' ? `${formatCost(r.operational_h, 4)}/h` : '—'} />
              <Info label="Trabalho (acabamento)" value={toNumber(r.labor_h) > 0 ? `${formatCost(r.labor_h, 2)}/h` : '—'} />
            </dl>
            <p className="mt-3 text-xs text-muted">
              {r.mode === 'COMBINED'
                ? 'A taxa combinada cobre energia e depreciação juntas. Em Taxas dá para dividi-la em energia + depreciação.'
                : r.mode === 'SPLIT'
                  ? 'Energia e depreciação separadas. Taxas deste equipamento valem antes das globais.'
                  : 'Sem taxa vigente: impressões terão custo operacional zero até uma taxa ser cadastrada.'}
              {r.fully_depreciated ? ' A depreciação está zerada: as horas de uso alcançaram a vida útil.' : ''}
            </p>
            {own.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-ink-soft">
                {own.map((rate) => (
                  <li key={rate.id}>
                    Específica desta máquina: {RATE_TYPE_LABELS[rate.rate_type]} {formatCost(rate.value, 4)}
                    {rateUnit(rate.rate_type)} desde {formatDateBR(rate.valid_from)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
