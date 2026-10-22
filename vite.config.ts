import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Versão do app (também invalida o cache local de dados entre publicações).
const appVersion = `${pkg.version}+${(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)}`;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },
  // Só variáveis PÚBLICAS: as do app (VITE_) e as públicas da integração Supabase ↔ Vercel
  // (NEXT_PUBLIC_). Nunca adicione prefixos como SUPABASE_ ou POSTGRES_ (são segredos).
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Atualização controlada: o usuário decide quando recarregar (sem perder formulários).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        id: '/',
        name: 'Wabee — Gestão',
        short_name: 'Wabee',
        description: 'Produção, estoque e financeiro da Wabee (impressão 3D).',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F4F2EC',
        theme_color: '#F4F2EC',
        categories: ['business', 'finance', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Nova venda', short_name: 'Vender', url: '/vendas/rapida', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Nova impressão', short_name: 'Imprimir', url: '/producao/impressoes/nova', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Finalizar impressão', short_name: 'Finalizar', url: '/producao?status=IMPRIMINDO', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Somente o app shell é armazenado pelo service worker. Respostas da API
        // (dados financeiros) NUNCA são cacheadas aqui: o cache de leitura fica no
        // IndexedDB com validade limitada e é apagado no logout.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        globIgnores: ['**/xlsx-*.js', '**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query', '@tanstack/react-query-persist-client', '@tanstack/query-async-storage-persister'],
          ui: ['radix-ui', 'sonner', 'lucide-react'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/.local-backend/**', '**/.claude/**', '**/test-results/**', '**/playwright-report/**'] },
  },
  preview: { port: 4173, strictPort: true },
});
