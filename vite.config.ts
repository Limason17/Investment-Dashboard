import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { depotApi } from './server/depot-api.ts'

// Lokal («npm run dev»): echte Daten in data/, Kurse über den lokalen Server.
// «--mode demo» (npm run demo): Testdaten in data-demo/, eigener Port.
// Online-Build («npm run build»): Konten und Daten in Firebase, Kurse über den Cloudflare Worker, als PWA installierbar.
// «--mode local» baut die lokale Version (npm start).
export default defineConfig(({ command, mode }) => {
  const demo = mode === 'demo'
  const env = loadEnv(mode, import.meta.dirname, ['ALPACA_', 'VITE_'])
  const backend = env.VITE_BACKEND || (mode === 'cloud' || (command === 'build' && mode === 'production') ? 'cloud' : 'local')
  const cloud = backend === 'cloud'
  // GitHub Pages liefert die Seite unter /Investment-Dashboard/ aus; BASE_PATH ändert das für andere Hosts.
  const base = cloud && command === 'build' ? (process.env.BASE_PATH ?? '/Investment-Dashboard/') : '/'
  const port = demo ? 5175 : 5173
  return {
    base,
    define: { 'import.meta.env.VITE_BACKEND': JSON.stringify(backend) },
    plugins: [
      react(),
      tailwindcss(),
      // Schlüssel aus .env.local (nur lokal, nie im Browser). Die Testdaten-Vorschau zeigt Live-Kurse, schreibt aber nichts fest.
      !cloud && depotApi(path.resolve(import.meta.dirname, demo ? 'data-demo' : 'data'), { env, persistCloses: !demo }),
      cloud &&
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
          manifest: {
            id: base,
            name: 'Depot',
            short_name: 'Depot',
            description: 'Portfolio-Dashboard: Positionen, Dividenden, Limits und Plan.',
            lang: 'de',
            start_url: base,
            scope: base,
            display: 'standalone',
            background_color: '#08090c',
            theme_color: '#08090c',
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
            globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*'],
            navigateFallback: 'index.html',
          },
        }),
    ],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    cacheDir: demo ? 'node_modules/.vite-demo' : cloud ? 'node_modules/.vite-cloud' : 'node_modules/.vite',
    server: { port: cloud ? 5177 : port, strictPort: demo, host: 'localhost' },
    preview: { port: cloud ? 4173 : port, host: 'localhost' },
  }
})
