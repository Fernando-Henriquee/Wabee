import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestEnv } from './env';

/** Fotos de produtos e itens: bucket público, escrita só do dono, caminho validado. */

let env: TestEnv;
let dono: string;
let leitura: string;
let productId: number;
let itemId: number;

const insertObject = (name: string) =>
  `insert into storage.objects (bucket_id, name) values ('product-photos', '${name}')`;

beforeAll(async () => {
  env = await TestEnv.create();
  dono = await env.createMember('dono@wabee.test', 'dono');
  leitura = await env.createMember('leitura@wabee.test', 'leitura');
  await env.as(dono, async (s) => {
    productId = await s.rpc<number>('save_product', {
      p_product: { name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'amarelo', reference_price: 5 }] },
    });
    itemId = (await s.one<{ id: number }>(`select item_id as id from public.product_variants where product_id = $1`, [productId])).id;
  });
});

afterAll(async () => {
  await env.close();
});

describe('fotos', () => {
  it('o bucket é público e só aceita imagens', async () => {
    const bucket = await env.admin().one<{ public: boolean; allowed_mime_types: string[] }>(
      `select public, allowed_mime_types from storage.buckets where id = 'product-photos'`,
    );
    expect(bucket.public).toBe(true);
    expect(bucket.allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('dono envia e remove arquivos nas pastas permitidas', async () => {
    await env.as(dono, async (s) => {
      await s.query(insertObject('products/abelha.jpg'));
      await s.query(insertObject('items/filamento.webp'));
      await s.query(insertObject('quotes/ref-1.png'));
      expect((await s.query(`select 1 from storage.objects where name = 'products/abelha.jpg'`)).length).toBe(1);
    });
    await env.as(dono, async (s) => {
      await s.query(`delete from storage.objects where name = 'quotes/ref-1.png'`);
      expect((await s.query(`select 1 from storage.objects where name = 'quotes/ref-1.png'`)).length).toBe(0);
    });
  });

  it('pasta fora da lista e perfil sem escrita são recusados', async () => {
    await expect(env.as(dono, (s) => s.query(insertObject('outra/x.jpg')))).rejects.toThrow(/row-level security/);
    await expect(env.as(leitura, (s) => s.query(insertObject('products/leitura.jpg')))).rejects.toThrow(/row-level security/);
  });

  it('set_product_photo grava, propaga ao item de cada variação e remove a foto', async () => {
    await env.as(dono, async (s) => {
      await s.rpc('set_product_photo', { p_product_id: productId, p_path: 'products/abelha.jpg' });
      expect((await s.one<{ photo_path: string }>(`select photo_path from public.products where id = $1`, [productId])).photo_path).toBe('products/abelha.jpg');
      expect((await s.one<{ photo_path: string }>(`select photo_path from public.v_product_variants where product_id = $1`, [productId])).photo_path).toBe('products/abelha.jpg');
      expect((await s.one<{ photo_path: string }>(`select photo_path from public.items where id = $1`, [itemId])).photo_path).toBe('products/abelha.jpg');
      await s.rpc('save_product', { p_product: { id: productId, name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'preto', reference_price: 5 }] } });
      const novo = await s.one<{ photo_path: string }>(`select i.photo_path from public.items i join public.product_variants v on v.item_id = i.id where v.product_id = $1 and v.name = 'preto'`, [productId]);
      expect(novo.photo_path).toBe('products/abelha.jpg');
      await s.rpc('set_product_photo', { p_product_id: productId, p_path: null });
      expect((await s.one<{ photo_path: string | null }>(`select photo_path from public.items where id = $1`, [itemId])).photo_path).toBeNull();
      expect((await s.one<{ photo_path: string | null }>(`select photo_path from public.products where id = $1`, [productId])).photo_path).toBeNull();
    });
  });

  it('set_item_photo grava a foto do item', async () => {
    await env.as(dono, async (s) => {
      await s.rpc('set_item_photo', { p_item_id: itemId, p_path: 'items/filamento.webp' });
      expect((await s.one<{ photo_path: string }>(`select photo_path from public.items where id = $1`, [itemId])).photo_path).toBe('items/filamento.webp');
    });
  });

  it('caminhos inválidos e perfis sem permissão são recusados', async () => {
    await env.as(dono, async (s) => {
      await expect(s.rpc('set_product_photo', { p_product_id: productId, p_path: '../segredo.jpg' })).rejects.toThrow(/inválido/);
    });
    await env.as(dono, async (s) => {
      await expect(s.rpc('set_product_photo', { p_product_id: productId, p_path: 'items/trocado.jpg' })).rejects.toThrow(/inválido/);
    });
    await env.as(dono, async (s) => {
      await expect(s.rpc('set_item_photo', { p_item_id: 999999, p_path: 'items/x.jpg' })).rejects.toThrow(/não encontrado/);
    });
    await env.as(leitura, async (s) => {
      await expect(s.rpc('set_product_photo', { p_product_id: productId, p_path: 'products/x.jpg' })).rejects.toThrow(/permissão/);
    });
  });
});
