import { describe, expect, it } from 'vitest';
import { photoUrl } from './photo-url';

describe('photoUrl', () => {
  const base = 'https://abc.supabase.co';

  it('monta o endereço público a partir do caminho no bucket', () => {
    expect(photoUrl('products/abelha.jpg', base)).toBe('https://abc.supabase.co/storage/v1/object/public/product-photos/products/abelha.jpg');
  });

  it('mantém endereços completos e ignora vazios', () => {
    expect(photoUrl('https://cdn.exemplo.com/a.jpg', base)).toBe('https://cdn.exemplo.com/a.jpg');
    expect(photoUrl('blob:http://localhost/1', base)).toBe('blob:http://localhost/1');
    expect(photoUrl(null, base)).toBeNull();
    expect(photoUrl('', base)).toBeNull();
  });

  it('sem URL do projeto não monta endereço', () => {
    expect(photoUrl('products/a.jpg', '')).toBeNull();
  });
});
