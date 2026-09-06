import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Relative, so the build works both at a domain root and under the
  // /mazegen/ path GitHub Pages serves it from.
  base: './',
  plugins: [
    react(),
    VitePWA({
      // No update prompt. A dialog asking a child whether to install a new
      // version is noise, and the alternative — leaving a stale build in the
      // cache — is the failure this whole plugin exists to avoid.
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'mazegen',
        short_name: 'mazegen',
        description: 'Printable mazes, sized for paper and for the hand holding the crayon.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#e9ebef',
        theme_color: '#1d4ed8',
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: './icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The whole app is a few hundred kilobytes with no network calls of its
        // own, so precaching all of it gives genuine offline use rather than
        // partial.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Without this an old build's caches linger after every deploy.
        cleanupOutdatedCaches: true,
        navigateFallback: './index.html',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
