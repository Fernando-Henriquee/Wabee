import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Gera os ícones PNG/ICO a partir de public/icon.svg: `npm run icons`.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#141414' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#141414' } },
  },
  images: ['public/icon.svg'],
});
