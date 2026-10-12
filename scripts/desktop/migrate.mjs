// Applies pending supabase/migrations/*.sql files to a Postgres instance,
// tracking what's already applied in a schema_migrations table. Used by the
// desktop launcher (scripts/desktop/start.mjs) before it starts the app, but
// kept dependency-free so it can also run standalone during development.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const { Client } = pg

/**
 * @param {{ connectionString: string, migrationsDir: string, log?: (msg: string) => void, skipFilenames?: Set<string>, bestEffortFilenames?: Set<string> }} opts
 *   skipFilenames: never run (test harness). bestEffortFilenames: run, but if
 *   one fails, roll it back, record it as done and continue instead of
 *   stopping (desktop launcher — see productionDataMigrations.mjs).
 * @returns {Promise<{ appliedCount: number, alreadyAppliedCount: number, totalFiles: number, skippedCount: number, bestEffortSkipped: string[] }>}
 */
export async function runPendingMigrations({ connectionString, migrationsDir, log = console.log, skipFilenames, bestEffortFilenames }) {
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
    let skippedCount = 0
    const bestEffortSkipped = []
    for (const filename of files) {
      if (applied.has(filename)) continue
      if (skipFilenames?.has(filename)) {
        skippedCount++
        continue
      }

      const sql = readFileSync(join(migrationsDir, filename), 'utf-8')
      log(`Applying migration ${filename}...`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        const message = err instanceof Error ? err.message : String(err)
        if (bestEffortFilenames?.has(filename)) {
          // A one-off repair of production rows this database doesn't hold
          // (see productionDataMigrations.mjs). Nothing of it was applied;
          // record it so it isn't retried on every launch, and carry on.
          log(`Skipped ${filename} — a one-off repair of live-system data that doesn't apply to this database (${message.split('\n')[0]}).`)
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [filename])
          bestEffortSkipped.push(filename)
          continue
        }
        throw new Error(`Migration ${filename} failed: ${message}`)
      }
      appliedCount++
    }

    return {
      appliedCount,
      alreadyAppliedCount: files.length - appliedCount - skippedCount - bestEffortSkipped.length,
      totalFiles: files.length,
      skippedCount,
      bestEffortSkipped,
    }
  } finally {
    await client.end()
  }
}
