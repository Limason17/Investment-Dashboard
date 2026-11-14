import { defineConfig } from 'vitest/config'

// Datenbankregeln gegen den Firestore-Emulator: npm run test:rules (braucht Java)
export default defineConfig({
  test: { environment: 'node', include: ['rules/**/*.test.ts'], env: { VITE_BACKEND: 'cloud', VITE_FIREBASE_CONFIG: JSON.stringify({ apiKey: 'demo-key', authDomain: 'demo-depot.firebaseapp.com', projectId: 'demo-depot', appId: 'demo' }), VITE_FIREBASE_EMULATOR: '127.0.0.1' }, testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
})
