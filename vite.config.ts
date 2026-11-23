import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Entrelinhas',
        short_name: 'Entrelinhas',
        description: 'Um espaço para observar padrões ao longo do tempo.',
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
