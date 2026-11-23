import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Diário',
        short_name: 'Diário',
        description: 'Registro diário e análise longitudinal',
        theme_color: '#f7f8fa',
        background_color: '#f7f8fa',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Só o shell é cacheado. Dados de saúde NUNCA passam pelo cache
        // do service worker: as chamadas ao Supabase são sempre de rede.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth/],
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        runtimeCaching: [],
      },
    }),
  ],
});
