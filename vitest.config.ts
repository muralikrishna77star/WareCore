import { defineConfig } from 'vitest/config'

export default defineConfig({
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
