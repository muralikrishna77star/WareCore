// One-off switch-over to multi-customer mode, and safe to run again.
//
//   node --env-file=.env.local scripts/tenants/setup-control.mjs \
//     --slug saisteels --name "Sai Steels" --db neondb \
//     --host saisteels.warecore.space --extra-host warecore.vercel.app --google \
//     --baseline --owner-email you@example.com --owner-name "Your Name"
//
// 1. Creates the customer registry database (warecore_control) on the same
//    server as DATABASE_URL, and applies supabase/control-migrations.
// 2. Registers an existing database as a customer (--slug/--name/--db) with
//    its addresses (--host is the main one; --extra-host keeps an old address
//    working). Doesn't touch any data in that database.
// 3. --baseline: the existing database was migrated by hand and has no
//    schema_migrations table. Records every migration file present now as
//    done there, so scripts/tenants/migrate-all.mjs only runs newer ones.
//    Refuses if the table already has rows or the latest migration's tables
//    are missing.
// 4. --owner-email: creates an owner console account. The password comes from
//    OWNER_PASSWORD, or a random one is printed once.
//
// --dry-run prints what would happen and changes nothing.

import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { runPendingMigrations } from '../desktop/migrate.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const CONTROL_MIGRATIONS = join(ROOT, 'supabase', 'control-migrations')
const CONTROL_DB = process.env.CONTROL_DB_NAME || 'warecore_control'
// The tables migration 181 creates: proof the database is fully migrated before baselining.
const LATEST_MIGRATION_TABLES = ['tracking_offline_actions', 'tracking_stock_counts']

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const dry = flag('dry-run')

const base = opt('database-url') || process.env.DATABASE_URL
if (!base) throw new Error('DATABASE_URL is not set (use --env-file=.env.local or --database-url)')
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString() }
const direct = (url) => { const u = new URL(url); u.hostname = u.hostname.replace('-pooler.', '.'); return u.toString() }
const say = (m) => console.log(dry ? `[dry run] ${m}` : m)

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}

// 1. Registry database
await withClient(direct(base), async (c) => {
  const { rowCount } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [CONTROL_DB])
  if (rowCount) say(`Registry database ${CONTROL_DB} already exists.`)
  else if (dry) say(`Would create registry database ${CONTROL_DB}.`)
  else { await c.query(`CREATE DATABASE "${CONTROL_DB}"`); say(`Created registry database ${CONTROL_DB}.`) }
})
const controlUrl = direct(withDb(base, CONTROL_DB))
if (!dry) {
  const r = await runPendingMigrations({ connectionString: controlUrl, migrationsDir: CONTROL_MIGRATIONS, log: () => {} })
  say(`Registry migrations: ${r.appliedCount} applied, ${r.alreadyAppliedCount} already there.`)
}

// 2. Register an existing database as a customer
const slug = opt('slug')
if (slug) {
  const name = opt('name'), db = opt('db'), host = opt('host')?.toLowerCase(), extra = opt('extra-host')?.toLowerCase()
  if (!name || !db || !host) throw new Error('--slug needs --name, --db and --host')
  const exists = await withClient(direct(base), (c) => c.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]))
  if (!exists.rowCount) throw new Error(`Database ${db} doesn't exist`)
  if (dry) say(`Would register ${name} (${slug}) -> database ${db} at ${host}${extra ? ` and ${extra}` : ''}.`)
  else await withClient(controlUrl, async (c) => {
    await c.query('BEGIN')
    const { rows } = await c.query(
      `INSERT INTO tenants (slug, display_name, db_name, status, google_sign_in, created_by)
       VALUES ($1, $2, $3, 'active', $4, 'setup-control')
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id, db_name`,
      [slug, name, db, flag('google')],
    )
    if (rows[0].db_name !== db) throw new Error(`${slug} is already registered with database ${rows[0].db_name}`)
    const id = rows[0].id
    await c.query(
      `INSERT INTO tenant_domains (host, tenant_id, is_primary) VALUES ($1, $2, true)
       ON CONFLICT (host) DO NOTHING`, [host, id])
    if (extra) await c.query(`INSERT INTO tenant_domains (host, tenant_id, is_primary) VALUES ($1, $2, false) ON CONFLICT (host) DO NOTHING`, [extra, id])
    const owners = await c.query('SELECT host, tenant_id = $1 AS mine FROM tenant_domains WHERE host = ANY($2)', [id, [host, extra].filter(Boolean)])
    for (const o of owners.rows) if (!o.mine) throw new Error(`${o.host} already belongs to another customer`)
    await c.query(`INSERT INTO tenant_events (tenant_id, owner_email, action, detail) VALUES ($1, 'setup-control', 'registered', $2)`,
      [id, `existing database ${db} at ${[host, extra].filter(Boolean).join(', ')}`])
    await c.query('COMMIT')
    say(`Registered ${name} (${slug}) -> database ${db} at ${host}${extra ? ` and ${extra}` : ''}.`)
  })

  // 3. Baseline the existing database's migration record
  if (flag('baseline')) {
    await withClient(direct(withDb(base, db)), async (c) => {
      const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
      const hasTable = (await c.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS t`)).rows[0].t
      const count = hasTable ? (await c.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n : 0
      if (count > 0) { say(`Database ${db} already records ${count} migrations; not baselining.`); return }
      for (const t of LATEST_MIGRATION_TABLES) {
        const ok = (await c.query('SELECT to_regclass($1) IS NOT NULL AS t', [`public.${t}`])).rows[0].t
        if (!ok) throw new Error(`Database ${db} has no ${t} table: it isn't on the latest migration, so it can't be baselined`)
      }
      if (dry) { say(`Would record ${files.length} migrations (${files[0]} … ${files.at(-1)}) as done in ${db}.`); return }
      await c.query('BEGIN')
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
      for (const f of files) await c.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [f])
      await c.query('COMMIT')
      say(`Recorded ${files.length} migrations (${files[0]} … ${files.at(-1)}) as done in ${db}.`)
    })
  }
}

// 4. Owner account
const ownerEmail = opt('owner-email')?.toLowerCase().trim()
if (ownerEmail) {
  const ownerName = opt('owner-name') || ownerEmail
  const generated = !process.env.OWNER_PASSWORD
  const password = process.env.OWNER_PASSWORD || randomBytes(12).toString('base64url')
  if (password.length < 10) throw new Error('OWNER_PASSWORD must be at least 10 characters')
  if (dry) say(`Would create owner account ${ownerEmail}.`)
  else await withClient(controlUrl, async (c) => {
    const { rowCount } = await c.query(
      `INSERT INTO owner_users (email, full_name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [ownerEmail, ownerName, await bcrypt.hash(password, 12)],
    )
    if (!rowCount) say(`Owner account ${ownerEmail} already exists; password unchanged.`)
    else say(`Created owner account ${ownerEmail}.${generated ? ` Password (shown once): ${password}` : ''}`)
  })
}
