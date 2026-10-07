import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { site, siteMetadataPlugin } from './config/site.ts'

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), tailwindcss(), siteMetadataPlugin(loadEnv(mode, process.cwd(), ''), command === 'build'), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
    manifest: {
      id: '/', name: site.name, short_name: site.name,
      description: site.description, lang: 'en', dir: 'ltr',
      theme_color: site.themeColor, background_color: site.themeColor,
      display: 'standalone', start_url: '/', scope: '/',
      categories: ['developer', 'productivity'],
      prefer_related_applications: false,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      // The app has one route. Missing assets and helper endpoints must stay 404s.
      navigateFallbackAllowlist: [/^\/(?:index\.html)?(?:\?.*)?$/],
      navigateFallbackDenylist: [/^\/api(?:\/|$)/],
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      globIgnores: ['**/og-image.*'],
    },
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5180, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4318' } },
  preview: { port: 4173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4318' } },
}))
