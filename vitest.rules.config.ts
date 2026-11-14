import { defineConfig } from 'vitest/config'

// Datenbankregeln gegen den Firestore-Emulator: npm run test:rules (braucht Java)
export default defineConfig({
  test: { environment: 'node', include: ['rules/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
})
