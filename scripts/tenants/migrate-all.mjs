// Applies new supabase/migrations files to EVERY customer's database.
// This replaces applying a migration to the one production database by hand.
//
//   node --env-file=.env.local scripts/tenants/migrate-all.mjs            # apply
//   node --env-file=.env.local scripts/tenants/migrate-all.mjs --dry-run  # list what's pending
//   node --env-file=.env.local scripts/tenants/migrate-all.mjs --only bsm
//
// Customers are migrated one at a time; the first failure stops the run, so
// the remaining customers stay on the previous migration rather than being
// left in different states. A failed migration is rolled back in full
// (each file runs in its own transaction).

import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { runPendingMigrations } from '../desktop/migrate.mjs'
import { skipFilenamesFor } from './customerMigrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const CONTROL_DB = process.env.CONTROL_DB_NAME || 'warecore_control'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

const base = process.env.DATABASE_URL
if (!base) throw new Error('DATABASE_URL is not set (use --env-file=.env.local)')
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString() }
const direct = (url) => { const u = new URL(url); u.hostname = u.hostname.replace('-pooler.', '.'); return u.toString() }

const control = new pg.Client({ connectionString: direct(withDb(base, CONTROL_DB)) })
await control.connect()
const { rows: tenants } = await control.query(
  `SELECT slug, db_name, status FROM tenants WHERE status IN ('active', 'suspended') ${only ? 'AND slug = $1' : ''} ORDER BY slug`,
  only ? [only] : [],
)
await control.end()
if (!tenants.length) { console.log(only ? `No active customer ${only}.` : 'No customers.'); process.exit(0) }

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
for (const t of tenants) {
  const url = direct(withDb(base, t.db_name))
  const skip = skipFilenamesFor(t.slug, MIGRATIONS)
  if (dry) {
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    const has = (await c.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS t`)).rows[0].t
    const done = has ? new Set((await c.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)) : new Set()
    await c.end()
    if (!has) { console.log(`${t.slug} (${t.db_name}): NO schema_migrations table — run setup-control.mjs --baseline first`); continue }
    const pending = files.filter((f) => !done.has(f) && !skip.has(f))
    console.log(`${t.slug} (${t.db_name}): ${pending.length ? pending.join(', ') : 'up to date'}`)
    continue
  }
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  const has = (await c.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS t`)).rows[0].t
  await c.end()
  // Without a record, every migration would run again on a live database.
  if (!has) throw new Error(`${t.slug} (${t.db_name}) has no schema_migrations table — run setup-control.mjs --baseline first`)
  const r = await runPendingMigrations({ connectionString: url, migrationsDir: MIGRATIONS, skipFilenames: skip, log: (m) => console.log(`  ${t.slug}: ${m}`) })
  console.log(`${t.slug} (${t.db_name}): ${r.appliedCount} applied, ${r.alreadyAppliedCount} already there`)
}
