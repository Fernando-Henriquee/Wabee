import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestEnv } from './env';

/** Fotos de produtos e itens: bucket público, escrita só na pasta da própria empresa, caminho validado. */

let env: TestEnv;
let dono: string;
let membro: string;
let estranho: string;
let company: string;
let productId: number;
let itemId: number;

const insertObject = (name: string) =>
  `insert into storage.objects (bucket_id, name) values ('product-photos', '${name}')`;
const path = (folder: string, file: string) => `${company}/${folder}/${file}`;

beforeAll(async () => {
  env = await TestEnv.create();
  company = await env.defaultCompany();
  dono = await env.createMember('dono@wabee.test', 'dono');
  membro = await env.createMember('membro@wabee.test', 'membro');
  estranho = await env.createUser('estranho@outra.test');
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

  it('membro envia e remove arquivos nas pastas permitidas da própria empresa', async () => {
    await env.as(membro, async (s) => {
      await s.query(insertObject(path('products', 'abelha.jpg')));
      await s.query(insertObject(path('items', 'filamento.webp')));
      await s.query(insertObject(path('quotes', 'ref-1.png')));
      expect((await s.query(`select 1 from storage.objects where name = '${path('products', 'abelha.jpg')}'`)).length).toBe(1);
    });
    await env.as(dono, async (s) => {
      await s.query(`delete from storage.objects where name = '${path('quotes', 'ref-1.png')}'`);
      expect((await s.query(`select 1 from storage.objects where name = '${path('quotes', 'ref-1.png')}'`)).length).toBe(0);
    });
  });

  it('pasta fora da lista, caminho antigo sem empresa e outra empresa são recusados', async () => {
    await expect(env.as(dono, (s) => s.query(insertObject(path('outra', 'x.jpg'))))).rejects.toThrow(/row-level security/);
    await expect(env.as(dono, (s) => s.query(insertObject('products/sem-empresa.jpg')))).rejects.toThrow(/row-level security/);
    await expect(env.as(estranho, (s) => s.query(insertObject(path('products', 'invasor.jpg'))))).rejects.toThrow(/row-level security/);
    const outra = await env.createCompany(estranho, 'Empresa do estranho');
    await expect(env.as(estranho, (s) => s.query(insertObject(path('products', 'invasor.jpg'))), { company: outra })).rejects.toThrow(/row-level security/);
    await env.as(estranho, (s) => s.query(insertObject(`${outra}/products/dele.jpg`)), { company: outra });
  });

  it('só enxerga e remove arquivos da própria empresa', async () => {
    const outra = (await env.admin().one<{ id: string }>(`select id from public.companies where name = 'Empresa do estranho'`)).id;
    expect((await env.as(estranho, (s) => s.query(`select 1 from storage.objects where name = '${path('products', 'abelha.jpg')}'`), { company: outra })).length).toBe(0);
    await env.as(estranho, (s) => s.query(`delete from storage.objects where name = '${path('products', 'abelha.jpg')}'`), { company: outra });
    expect((await env.admin().query(`select 1 from storage.objects where name = '${path('products', 'abelha.jpg')}'`)).length).toBe(1);
  });

  it('set_product_photo grava, propaga ao item de cada variação e remove a foto', async () => {
    await env.as(dono, async (s) => {
      await s.rpc('set_product_photo', { p_product_id: productId, p_path: path('products', 'abelha.jpg') });
      expect((await s.one<{ photo_path: string }>(`select photo_path from public.products where id = $1`, [productId])).photo_path).toBe(path('products', 'abelha.jpg'));
      expect((await s.one<{ photo_path: string }>(`select photo_path from public.v_product_variants where product_id = $1`, [productId])).photo_path).toBe(path('products', 'abelha.jpg'));
      expect((await s.one<{ photo_path: string }>(`select photo_path from public.items where id = $1`, [itemId])).photo_path).toBe(path('products', 'abelha.jpg'));
      await s.rpc('save_product', { p_product: { id: productId, name: 'Chaveiro Abelha', category: 'CHAVEIRO', variants: [{ name: 'preto', reference_price: 5 }] } });
      const novo = await s.one<{ photo_path: string }>(`select i.photo_path from public.items i join public.product_variants v on v.item_id = i.id where v.product_id = $1 and v.name = 'preto'`, [productId]);
      expect(novo.photo_path).toBe(path('products', 'abelha.jpg'));
      await s.rpc('set_product_photo', { p_product_id: productId, p_path: null });
      expect((await s.one<{ photo_path: string | null }>(`select photo_path from public.items where id = $1`, [itemId])).photo_path).toBeNull();
      expect((await s.one<{ photo_path: string | null }>(`select photo_path from public.products where id = $1`, [productId])).photo_path).toBeNull();
    });
  });

  it('set_item_photo grava a foto do item', async () => {
    await env.as(dono, async (s) => {
      await s.rpc('set_item_photo', { p_item_id: itemId, p_path: path('items', 'filamento.webp') });
      expect((await s.one<{ photo_path: string }>(`select photo_path from public.items where id = $1`, [itemId])).photo_path).toBe(path('items', 'filamento.webp'));
    });
  });

  it('caminhos inválidos, de outra empresa e quem não é membro são recusados', async () => {
    await env.as(dono, async (s) => {
      await expect(s.rpc('set_product_photo', { p_product_id: productId, p_path: '../segredo.jpg' })).rejects.toThrow(/inválido/);
    });
    await env.as(dono, async (s) => {
      await expect(s.rpc('set_product_photo', { p_product_id: productId, p_path: path('items', 'trocado.jpg') })).rejects.toThrow(/inválido/);
    });
    await env.as(dono, async (s) => {
      await expect(s.rpc('set_product_photo', { p_product_id: productId, p_path: 'products/antigo-sem-empresa.jpg' })).rejects.toThrow(/inválido/);
    });
    await env.as(dono, async (s) => {
      await expect(s.rpc('set_product_photo', { p_product_id: productId, p_path: `${crypto.randomUUID()}/products/de-outra-empresa.jpg` })).rejects.toThrow(/inválido/);
    });
    await env.as(dono, async (s) => {
      await expect(s.rpc('set_item_photo', { p_item_id: 999999, p_path: path('items', 'x.jpg') })).rejects.toThrow(/não encontrado/);
    });
    await env.as(estranho, async (s) => {
      await expect(s.rpc('set_product_photo', { p_product_id: productId, p_path: path('products', 'x.jpg') })).rejects.toThrow(/inválido|permissão/);
    });
  });
});
