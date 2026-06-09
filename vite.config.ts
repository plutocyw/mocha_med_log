import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Mocha Med Log',
        short_name: 'Mocha Med',
        description: 'Track whether Mocha has received medication at 8:30 AM, 4:30 PM, and 11:30 PM.',
        theme_color: '#6f2f1d',
        background_color: '#f6efe8',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}']
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true
  }
});

