// Applies pending supabase/migrations/*.sql files to a Postgres instance,
// tracking what's already applied in a schema_migrations table. Used by the
// desktop launcher (scripts/desktop/start.mjs) before it starts the app, but
// kept dependency-free so it can also run standalone during development.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const { Client } = pg

/**
 * @param {{ connectionString: string, migrationsDir: string, log?: (msg: string) => void }} opts
 * @returns {Promise<{ appliedCount: number, alreadyAppliedCount: number, totalFiles: number }>}
 */
export async function runPendingMigrations({ connectionString, migrationsDir, log = console.log }) {
  const client = new Client({ connectionString })
  await client.connect()

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    const { rows } = await client.query('SELECT filename FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.filename))

    let appliedCount = 0
    for (const filename of files) {
      if (applied.has(filename)) continue

      const sql = readFileSync(join(migrationsDir, filename), 'utf-8')
      log(`Applying migration ${filename}...`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${filename} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      appliedCount++
    }

    return { appliedCount, alreadyAppliedCount: files.length - appliedCount, totalFiles: files.length }
  } finally {
    await client.end()
  }
}
