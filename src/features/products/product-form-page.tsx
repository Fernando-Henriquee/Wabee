import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  CATEGORY_LABELS,
  MODEL_SOURCE_LABELS,
  type ModelSource,
  type Product,
  type ProductCategory,
  type ProductInput,
  useProduct,
  useSaveProduct,
  useVariants,
  type VariantRow,
} from '@/data/products';
import { useMember } from '@/features/member/member-context';
import { describeError } from '@/lib/errors';
import { Warning } from './bits';

interface VariantDraft {
  key: string;
  id?: number;
  name: string;
  sku: string;
  reference_price: string | null;
  active: boolean;
}

interface FormState {
  name: string;
  category: ProductCategory;
  description: string;
  model_source: ModelSource;
  license_notes: string;
  license_allows_commercial: boolean | null;
  active: boolean;
  variants: VariantDraft[];
}

let draftKey = 0;
const newVariant = (): VariantDraft => ({ key: `n${++draftKey}`, name: '', sku: '', reference_price: null, active: true });

function stateFrom(product: Product | null, variants: VariantRow[]): FormState {
  if (!product) {
    return { name: '', category: 'CHAVEIRO', description: '', model_source: 'PROPRIO', license_notes: '', license_allows_commercial: null, active: true, variants: [newVariant()] };
  }
  return {
    name: product.name,
    category: product.category,
    description: product.description ?? '',
    model_source: product.model_source,
    license_notes: product.license_notes ?? '',
    license_allows_commercial: product.license_allows_commercial,
    active: product.active,
    variants: variants.map((v) => ({ key: `v${v.id}`, id: v.id, name: v.name, sku: v.sku, reference_price: v.reference_price === null ? null : String(v.reference_price), active: v.active })),
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="space-y-4 p-4">{children}</div>
    </Card>
  );
}

export function ProductFormPage() {
  const { id } = useParams();
  const productId = id ? Number(id) : undefined;
  const product = useProduct(productId);
  const variants = useVariants({ productId });
  if (productId && (product.isError || variants.isError)) return <Page><ErrorState error={product.error ?? variants.error} /></Page>;
  if (productId && (!product.data || !variants.data)) return <Page><LoadingBlock /></Page>;
  return <ProductForm key={id ?? 'new'} productId={productId} initial={stateFrom(product.data ?? null, variants.data ?? [])} />;
}

function ProductForm({ productId, initial }: { productId?: number; initial: FormState }) {
  const editing = Boolean(productId);
  const navigate = useNavigate();
  const { can } = useMember();
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveProduct((savedId) => navigate(`/produtos/${savedId}`, { replace: true }));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setVariant = (key: string, patch: Partial<VariantDraft>) => setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));
  const thirdParty = form.model_source !== 'PROPRIO';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('Informe o nome do produto.');
    const variants = form.variants.filter((v) => v.id || v.name.trim());
    if (variants.length === 0) return setError('Cadastre ao menos uma variação (ex.: a cor). Produto de cor única: use "único".');
    if (variants.some((v) => !v.name.trim())) return setError('Informe o nome de cada variação.');
    const names = variants.map((v) => v.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return setError('Há variações com o mesmo nome.');
    const payload: ProductInput = {
      id: productId,
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim() || null,
      model_source: form.model_source,
      license_notes: thirdParty ? form.license_notes.trim() || null : null,
      license_allows_commercial: thirdParty ? form.license_allows_commercial : null,
      active: editing ? form.active : undefined,
      variants: variants.map((v) => ({
        id: v.id,
        name: v.name.trim(),
        sku: v.id ? undefined : v.sku.trim().toUpperCase() || null,
        reference_price: v.reference_price,
        active: v.active,
      })),
    };
    save.mutate(payload, { onError: (e) => setError(describeError(e)) });
  };

  if (!can('write')) return <Page><ErrorState error={new Error('Seu perfil não pode cadastrar produtos.')} /></Page>;

  return (
    <Page className="max-w-3xl">
      <PageHeader
        back={
          <Link to={editing ? `/produtos/${productId}` : '/produtos'} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {editing ? 'Voltar ao produto' : 'Produtos'}
          </Link>
        }
        title={editing ? 'Editar produto' : 'Novo produto'}
        description="Cada variação vira um item de estoque (produto pronto) com SKU próprio."
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Section title="Produto">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder="Ex.: Chaveiro Abelha" autoFocus={!editing} />
            </Field>
            <Field label="Categoria">
              <Select value={form.category} onChange={(e) => set('category', e.target.value as ProductCategory)}>
                {(Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Origem do modelo 3D">
              <Select value={form.model_source} onChange={(e) => set('model_source', e.target.value as ModelSource)}>
                {(Object.keys(MODEL_SOURCE_LABELS) as ModelSource[]).map((m) => (
                  <option key={m} value={m}>
                    {MODEL_SOURCE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Descrição" className="sm:col-span-2">
              <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} className="min-h-16" />
            </Field>
          </div>
          {thirdParty ? (
            <div className="space-y-3 rounded-lg border border-line bg-subtle p-3">
              <Field label="Licença (autor, link, termos)" hint="Ex.: CC BY-NC 4.0, autor @fulano no Printables.">
                <Input value={form.license_notes} onChange={(e) => set('license_notes', e.target.value)} maxLength={500} />
              </Field>
              <label className="inline-flex items-center gap-2 text-sm">
                <Checkbox checked={form.license_allows_commercial === true} onChange={(e) => set('license_allows_commercial', e.target.checked)} /> A licença permite vender as peças
              </label>
              {form.license_allows_commercial !== true ? (
                <Warning>Modelos com licença "não comercial" (NC) não podem ser vendidos. Confirme a licença antes de anunciar.</Warning>
              ) : null}
            </div>
          ) : null}
          {editing ? (
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Produto ativo (aparece na venda e no planejamento)
            </label>
          ) : null}
        </Section>

        <Section title="Variações" description="Cor, tamanho ou acabamento. O preço de referência vale quando o canal não tem preço próprio.">
          <ul className="space-y-3">
            {form.variants.map((v, index) => (
              <li key={v.key} className="grid grid-cols-2 gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_10rem_9rem_auto] sm:items-start">
                <Field label={`Variação ${index + 1}`} required className="col-span-2 sm:col-span-1">
                  <Input value={v.name} onChange={(e) => setVariant(v.key, { name: e.target.value })} maxLength={60} placeholder="Ex.: amarelo" />
                </Field>
                <Field label="SKU" hint={v.id ? undefined : 'Vazio = automático'}>
                  <Input value={v.sku} onChange={(e) => setVariant(v.key, { sku: e.target.value.toUpperCase() })} disabled={Boolean(v.id)} maxLength={40} placeholder="PRD-…" />
                </Field>
                <Field label="Preço de referência">
                  <MoneyInput value={v.reference_price} onValueChange={(value) => setVariant(v.key, { reference_price: value })} />
                </Field>
                <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:pt-8">
                  {v.id ? (
                    <label className="inline-flex items-center gap-2 text-sm">
                      <Checkbox checked={v.active} onChange={(e) => setVariant(v.key, { active: e.target.checked })} /> Ativa
                    </label>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remover variação ${index + 1}`}
                      disabled={form.variants.length === 1}
                      onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((x) => x.key !== v.key) }))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, newVariant()] }))}>
            <Plus /> Adicionar variação
          </Button>
          {editing ? <p className="text-xs text-muted">Variações com histórico não são excluídas: desmarque "Ativa" para tirá-las da venda.</p> : null}
        </Section>

        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(editing ? `/produtos/${productId}` : '/produtos')}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Salvar alterações' : 'Cadastrar produto'}
          </Button>
        </div>
      </form>
    </Page>
  );
}
