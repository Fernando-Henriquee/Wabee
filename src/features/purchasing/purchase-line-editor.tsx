import Big from 'big.js';
import { ChevronsUpDown, PackagePlus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { ColorDot } from '@/components/shared/item-bits';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/money-input';
import type { FinancialCategory } from '@/data/finance';
import { type ItemRow, KIND_LABELS } from '@/data/inventory';
import { LINE_KIND_LABELS, type LineKind } from '@/data/purchasing';
import type { PurchaseLinePreview } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { formatNumber, formatQty, toNumber, unitLabel } from '@/lib/money';
import { type LineDraft, lineQty, lineUnitPrice, newLine, priceFactor, SPOOL_SIZES, spoolLabel } from './purchase-logic';
import { Segmented } from './segmented';

interface Props {
  line: LineDraft;
  index: number;
  item: ItemRow | undefined;
  preview: PurchaseLinePreview | undefined;
  /** Categorias filhas aceitas em linhas de despesa, agrupadas pela raiz. */
  categoryGroups: Array<{ parent: FinancialCategory; children: FinancialCategory[] }>;
  showCosts: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  onPickItem: () => void;
  onNewItem: () => void;
}

function round(value: Big, dp: number) {
  return value.round(dp, Big.roundHalfUp).toFixed();
}

function priceLabel(line: LineDraft, filament: boolean) {
  if (line.priceMode === 'total') return 'Valor total da linha';
  if (filament && line.kind === 'ITEM') return line.qtyMode === 'spools' ? 'Preço por carretel' : 'Preço por kg';
  return 'Preço unitário';
}

/** Centavos no preço por kg/carretel, total e equipamento/despesa; até 4 casas no preço unitário de itens (ex.: R$ 0,0125). */
function priceDecimals(line: LineDraft, filament: boolean) {
  return line.priceMode === 'total' || filament || line.kind !== 'ITEM' ? 2 : 4;
}

/** Para onde vai o valor da linha (estoque, equipamento ou despesa na data da compra). */
function destination(line: LineDraft, item: ItemRow | undefined) {
  if (line.kind === 'EQUIPMENT') return 'Vira equipamento (depreciação por hora), sem juros.';
  if (line.kind === 'EXPENSE') return 'Despesa na data da compra.';
  if (!item) return null;
  if (item.kind === 'TOOL') return 'Ferramenta pequena: despesa na compra; entra no estoque sem valor.';
  if (!item.is_stock_tracked) return 'Sem controle de saldo: despesa na compra.';
  return null;
}

/** Uma linha da compra: item do estoque, equipamento ou despesa, com rateio e custo de aquisição ao vivo (RN-02). */
export function PurchaseLineEditor({ line, index, item, preview, categoryGroups, showCosts, canRemove, onChange, onRemove, onPickItem, onNewItem }: Props) {
  const id = useId();
  const filament = line.kind === 'ITEM' && item?.kind === 'FILAMENT';
  const qty = lineQty(line, filament);
  const unit = line.kind === 'ITEM' ? (item?.unit ?? 'UN') : 'UN';
  const factor = priceFactor(line, filament);

  const changeKind = (kind: LineKind) => {
    const fresh = newLine(line.key, kind);
    onChange({ ...fresh, price: line.price, priceMode: line.priceMode });
  };

  const setQtyMode = (mode: LineDraft['qtyMode']) => {
    if (mode === line.qtyMode) return;
    const unitPrice = lineUnitPrice(line, filament);
    if (mode === 'units') {
      onChange({
        qtyMode: 'units',
        qty,
        price: line.priceMode === 'unit' && unitPrice ? round(new Big(unitPrice).times(1000), 2) : line.price,
      });
    } else {
      const size = Number(line.spoolSize) || item?.nominal_spool_g || 1000;
      const count = qty ? Math.max(1, Math.round(toNumber(qty) / size)) : 1;
      onChange({
        qtyMode: 'spools',
        spoolCount: String(count),
        spoolSize: String(size),
        price: line.priceMode === 'unit' && unitPrice ? round(new Big(unitPrice).times(size), 2) : line.price,
      });
    }
  };

  const setPriceMode = (mode: LineDraft['priceMode']) => {
    if (mode === line.priceMode) return;
    if (mode === 'total') onChange({ priceMode: 'total', price: preview && toNumber(qty) > 0 && line.price !== null ? preview.lineTotal : line.price });
    else {
      const unitPrice = lineUnitPrice(line, filament);
      onChange({ priceMode: 'unit', price: unitPrice ? round(new Big(unitPrice).times(factor), priceDecimals({ ...line, priceMode: 'unit' }, filament)) : null });
    }
  };

  const note = destination(line, item);
  const landed = preview ? toNumber(preview.landedUnitCost) : 0;
  const allowedSizes = item?.nominal_spool_g && !SPOOL_SIZES.includes(Number(item.nominal_spool_g)) ? [...SPOOL_SIZES, Number(item.nominal_spool_g)].sort((a, b) => a - b) : SPOOL_SIZES;

  return (
    <li className="@container rounded-[var(--radius-card)] border border-line bg-panel p-3 shadow-[var(--shadow-card)] sm:p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold text-ink-soft" aria-hidden>
          {index + 1}
        </span>
        <Select value={line.kind} onChange={(e) => changeKind(e.target.value as LineKind)} aria-label={`Tipo da linha ${index + 1}`} className="w-auto min-w-0 flex-1 sm:max-w-56 sm:flex-none">
          {(Object.keys(LINE_KIND_LABELS) as LineKind[]).map((k) => (
            <option key={k} value={k}>
              {LINE_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <Button type="button" variant="ghost" size="icon" className="ml-auto" aria-label={`Remover linha ${index + 1}`} title="Remover linha" disabled={!canRemove} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 @lg:grid-cols-2">
        {line.kind === 'ITEM' ? (
          <div className="flex flex-col gap-1.5 @lg:col-span-2">
            <span className="text-sm font-medium text-ink-soft" id={`${id}-item`}>
              Item<span className="ml-0.5 text-danger" aria-hidden>*</span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onPickItem}
                aria-labelledby={`${id}-item`}
                aria-describedby={`${id}-item-value`}
                className={cn(
                  'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-panel px-3 text-left text-sm hover:bg-subtle focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25',
                  !item && 'text-muted',
                )}
              >
                {item?.kind === 'FILAMENT' ? <ColorDot hex={item.color_hex} /> : null}
                <span id={`${id}-item-value`} className="min-w-0 flex-1 truncate">
                  {item ? item.name : 'Escolher item…'}
                </span>
                {item ? <span className="hidden shrink-0 text-xs text-muted @md:inline">{KIND_LABELS[item.kind]} · {item.sku}</span> : null}
                <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
              <Button type="button" variant="outline" size="icon" onClick={onNewItem} aria-label="Cadastrar novo item" title="Cadastrar novo item">
                <PackagePlus />
              </Button>
            </div>
          </div>
        ) : line.kind === 'EXPENSE' ? (
          <>
            <Field label="Categoria da despesa" required>
              <Select value={line.categoryId ? String(line.categoryId) : ''} onChange={(e) => onChange({ categoryId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Escolha…</option>
                {categoryGroups.map((group) => (
                  <optgroup key={group.parent.id} label={group.parent.name}>
                    {group.children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Descrição" required>
              <Input value={line.description} onChange={(e) => onChange({ description: e.target.value })} maxLength={200} placeholder="Ex.: assinatura, frete avulso" />
            </Field>
          </>
        ) : (
          <Field label="Descrição do equipamento" required className="@lg:col-span-2">
            <Input value={line.description} onChange={(e) => onChange({ description: e.target.value })} maxLength={200} placeholder="Ex.: Impressora Bambu Lab A1" />
          </Field>
        )}

        {filament ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-soft">Quantidade</span>
            <Segmented
              label="Como informar a quantidade"
              value={line.qtyMode}
              onChange={setQtyMode}
              options={[
                { value: 'spools', label: 'Carretéis' },
                { value: 'units', label: 'Gramas' },
              ]}
            />
            {line.qtyMode === 'spools' ? (
              <div className="flex items-center gap-2">
                <div className="w-20 shrink-0">
                  <DecimalInput decimals={0} value={line.spoolCount} onValueChange={(v) => onChange({ spoolCount: v })} aria-label="Número de carretéis" />
                </div>
                <span className="text-sm text-muted" aria-hidden>
                  ×
                </span>
                <Select value={line.spoolSize} onChange={(e) => onChange({ spoolSize: e.target.value })} aria-label="Tamanho do carretel" className="flex-1">
                  {allowedSizes.map((g) => (
                    <option key={g} value={g}>
                      {spoolLabel(g)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <DecimalInput decimals={3} suffix="g" value={line.qty} onValueChange={(v) => onChange({ qty: v })} aria-label="Quantidade em gramas" />
            )}
            <p className="text-xs text-muted">
              {qty && toNumber(qty) > 0 ? `= ${formatQty(qty, 'G')}${toNumber(qty) >= 1000 ? ` (${formatNumber(toNumber(qty) / 1000, 3)} kg)` : ''}` : 'Informe a quantidade'}
            </p>
          </div>
        ) : (
          <Field label="Quantidade" required>
            <DecimalInput decimals={line.kind === 'EQUIPMENT' ? 0 : 3} suffix={unitLabel(unit)} value={line.qty} onValueChange={(v) => onChange({ qty: v })} />
          </Field>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-price`} className="text-sm font-medium text-ink-soft">
            {priceLabel(line, filament)}
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          </label>
          <DecimalInput id={`${id}-price`} decimals={priceDecimals(line, filament)} prefix="R$" value={line.price} onValueChange={(v) => onChange({ price: v })} />
          <Segmented
            label="Como informar o preço"
            value={line.priceMode}
            onChange={setPriceMode}
            options={[
              { value: 'unit', label: filament ? (line.qtyMode === 'spools' ? 'Por carretel' : 'Por kg') : 'Unitário' },
              { value: 'total', label: 'Total' },
            ]}
          />
        </div>
      </div>

      {preview && (toNumber(preview.lineTotal) > 0 || note) ? (
        <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2 text-xs text-muted sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
          {showCosts ? (
            <>
              <span>
                Total <Money value={preview.lineTotal} className="font-medium text-ink" />
              </span>
              {toNumber(preview.freightAlloc) > 0 ? (
                <span>
                  + frete <Money value={preview.freightAlloc} />
                </span>
              ) : null}
              {toNumber(preview.discountAlloc) > 0 ? (
                <span>
                  − desconto <Money value={preview.discountAlloc} />
                </span>
              ) : null}
              {line.kind !== 'EXPENSE' && toNumber(qty) > 0 && landed > 0 ? (
                <span className="sm:ml-auto">
                  Custo de aquisição{' '}
                  <span className="font-semibold text-ink">
                    {filament ? (
                      <>
                        <Money value={landed * 1000} />
                        /kg
                      </>
                    ) : (
                      <>
                        <Money value={preview.landedUnitCost} cost />/{line.kind === 'EQUIPMENT' ? 'un' : unitLabel(unit)}
                      </>
                    )}
                  </span>
                </span>
              ) : null}
            </>
          ) : null}
          {note ? <span className="basis-full text-muted">{note}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
