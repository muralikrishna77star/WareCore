import { Pool } from 'pg'

let pool: Pool | null = null

/** Singleton pg.Pool for LOCAL_MODE — connects to the embedded/local Postgres instance. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set (required when LOCAL_MODE=true)')
    pool = new Pool({ connectionString })
  }
  return pool
}

/**
 * Closes the singleton pool and clears it, so a later getPool() call opens
 * a fresh one against whatever DATABASE_URL is set at that point. Needed by
 * tests that spin up a new throwaway Postgres instance per file (engine.test.ts)
 * — without this, the pool's connections dangle when that instance shuts
 * down and surface as an unhandled ECONNRESET.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
