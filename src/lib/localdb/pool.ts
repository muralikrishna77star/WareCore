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
