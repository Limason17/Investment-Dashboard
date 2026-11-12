import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Tests der Rechenlogik (ohne Browser): npm test
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
