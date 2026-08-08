import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*": ["./src/*"] — vitest doesn't read
    // tsconfig path mappings on its own, and engine.test.ts imports
    // src/lib/dataIntegrity/engine.ts, which imports from '@/lib/...'.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Migration + reconciliation-rule tests spin up a real throwaway
    // embedded Postgres per test file (initdb + ~78 migrations) — slower
    // than typical unit tests, so the default 5s timeout isn't enough.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // These integration tests share one Postgres port range and can't run
    // concurrently against each other safely.
    fileParallelism: false,
  },
})
