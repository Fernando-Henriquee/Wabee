import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ColorDot } from '@/components/shared/item-bits';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { LoadingBlock } from '@/components/ui/states';
import { useItems } from '@/data/inventory';
import { useBomLines, useCopyBom, type VariantRow } from '@/data/products';
import { formatQty } from '@/lib/money';

/**
 * Copia a ficha ativa de outra variação para esta, trocando os filamentos (ex.: a
 * Abelha amarela vira a Abelha rosa trocando o PLA amarelo pelo rosa). Nasce em rascunho.
 */
export function CopyBomDialog({ target, sources, onOpenChange }: { target: VariantRow; sources: VariantRow[]; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [sourceId, setSourceId] = useState(String(sources[0]?.id ?? ''));
  const source = sources.find((s) => String(s.id) === sourceId);
  const lines = useBomLines(source?.active_bom_id);
  const filaments = useItems({ kind: 'FILAMENT' });
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const copy = useCopyBom((id) => {
    onOpenChange(false);
    navigate(`/produtos/${target.product_id}/fichas/${id}`);
  });
  const filamentLines = (lines.data ?? []).filter((l) => l.line_kind.startsWith('FILAMENT'));
  // Uma troca por filamento de origem (o mesmo PLA pode aparecer como peça e suporte).
  const originItems = [...new Map(filamentLines.map((l) => [l.item_id, l])).values()];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`Copiar ficha para ${target.name}`}
        description="Os componentes, embalagens e tempos vêm iguais; escolha o filamento de cada cor. Você revisa antes de ativar."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              loading={copy.isPending}
              disabled={!source?.active_bom_id}
              onClick={() =>
                copy.mutate({
                  bomId: source!.active_bom_id!,
                  targetVariantId: target.id,
                  swaps: Object.fromEntries(Object.entries(swaps).filter(([, to]) => to).map(([from, to]) => [from, Number(to)])),
                })
              }
            >
              Criar rascunho
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Copiar a ficha de">
            <Select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSwaps({});
              }}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (versão {s.active_bom_version})
                </option>
              ))}
            </Select>
          </Field>
          {!lines.data ? (
            <LoadingBlock rows={2} />
          ) : originItems.length === 0 ? (
            <p className="text-sm text-muted">A ficha de origem não tem filamentos.</p>
          ) : (
            <ul className="space-y-3">
              {originItems.map((l) => (
                <li key={l.item_id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                  <span className="inline-flex items-center gap-2 text-sm">
                    <ColorDot hex={l.color_hex} />
                    <span>
                      {l.item_name}
                      <span className="block text-xs text-muted">{formatQty(l.qty_per_unit, l.unit)} por unidade</span>
                    </span>
                  </span>
                  <ArrowRight className="hidden size-4 text-muted sm:block" aria-hidden />
                  <Select aria-label={`Trocar ${l.item_name} por`} value={swaps[String(l.item_id)] ?? ''} onChange={(e) => setSwaps((s) => ({ ...s, [String(l.item_id)]: e.target.value }))}>
                    <option value="">Manter o mesmo</option>
                    {(filaments.data ?? [])
                      .filter((f) => f.id !== l.item_id)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </Select>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
