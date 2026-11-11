import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { depotApi } from './server/depot-api.ts'

// Echte Daten liegen in data/. Mit «--mode demo» (npm run demo) liest und schreibt die Seite
// stattdessen die Testdaten in data-demo/, auf einem eigenen Port.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  const port = demo ? 5175 : 5173
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Schlüssel aus .env.local (nur lokal, nie im Browser). Die Testdaten-Vorschau zeigt Live-Kurse, schreibt aber nichts fest.
      depotApi(path.resolve(import.meta.dirname, demo ? 'data-demo' : 'data'), { env: loadEnv(mode, import.meta.dirname, 'ALPACA_'), persistCloses: !demo }),
    ],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    cacheDir: demo ? 'node_modules/.vite-demo' : 'node_modules/.vite',
    server: { port, strictPort: demo, host: 'localhost' },
    preview: { port, host: 'localhost' },
  }
})
