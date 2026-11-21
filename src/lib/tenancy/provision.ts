import path from 'node:path'
import { Client } from 'pg'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
// The same runner and skip list the desktop app uses for a fresh install.
import { runPendingMigrations } from '../../../scripts/desktop/migrate.mjs'
import { skipFilenamesFor } from '../../../scripts/tenants/customerMigrations.mjs'
import { DB_NAME_PATTERN, databaseUrlFor, directUrl } from './config'
import { forgetTenantCache, getControlPool, logTenantEvent } from './control'

export const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

export interface FirstAdmin {
  fullName: string
  email: string
  password: string
}

export interface ProvisionResult {
  ok: boolean
  migrationsApplied: number
  adminCreated: boolean
  domain: DomainResult
  error?: string
}

export type DomainResult =
  | { state: 'added' | 'already-added' }
  | { state: 'manual'; reason: string }
  | { state: 'failed'; reason: string }

function baseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

/** Creates the customer's database if it isn't there yet. The name is checked, never interpolated unchecked. */
export async function ensureDatabase(dbName: string): Promise<boolean> {
  if (!DB_NAME_PATTERN.test(dbName)) throw new Error(`Invalid database name: ${dbName}`)
  const admin = new Client({ connectionString: directUrl(baseUrl()) })
  await admin.connect()
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (rowCount) return false
    await admin.query(`CREATE DATABASE "${dbName}"`)
    return true
  } finally {
    await admin.end()
  }
}

/** The customer's first admin, only while the customer has no users at all. */
export async function ensureFirstAdmin(dbName: string, a: FirstAdmin): Promise<boolean> {
  const c = new Client({ connectionString: directUrl(databaseUrlFor(baseUrl(), dbName)) })
  await c.connect()
  try {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM user_profiles')
    if (rows[0].n > 0) return false
    // Login lower-cases and trims what is typed; store it the same way.
    await c.query(
      `INSERT INTO user_profiles (id, full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'admin', true)`,
      [randomUUID(), a.fullName.trim(), a.email.toLowerCase().trim(), await bcrypt.hash(a.password, 12)],
    )
    return true
  } finally {
    await c.end()
  }
}

/**
 * Tells Vercel to serve (and get a certificate for) the customer's address.
 * Needs WARECORE_VERCEL_TOKEN; without it the owner adds the address by hand.
 * The DNS side is a one-off wildcard record (*.warecore.space) at the registrar.
 */
export async function addVercelDomain(host: string): Promise<DomainResult> {
  const token = process.env.WARECORE_VERCEL_TOKEN?.trim()
  const projectId = process.env.WARECORE_VERCEL_PROJECT_ID?.trim() || process.env.VERCEL_PROJECT_ID?.trim()
  const teamId = process.env.WARECORE_VERCEL_TEAM_ID?.trim()
  if (!token || !projectId) {
    return { state: 'manual', reason: `Add ${host} to the Vercel project (Settings → Domains, or \`vercel domains add ${host}\`).` }
  }
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  try {
    const res = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/domains${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: host }),
    })
    if (res.ok) return { state: 'added' }
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
    const code = body.error?.code ?? ''
    if (res.status === 409 || code === 'domain_already_in_use_by_project' || code === 'domain_already_exists') {
      return { state: 'already-added' }
    }
    return { state: 'failed', reason: body.error?.message ?? `Vercel answered ${res.status}` }
  } catch (err) {
    return { state: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Sets a registered customer up end to end, and can be run again after a
 * failure: each step skips what's already done (database exists, migrations
 * recorded in schema_migrations, admin already there).
 */
export async function provisionTenant(tenantId: string, admin: FirstAdmin, ownerEmail: string): Promise<ProvisionResult> {
  const pool = getControlPool()
  const { rows } = await pool.query(
    `SELECT t.slug, t.db_name, (SELECT host FROM tenant_domains d WHERE d.tenant_id = t.id AND d.is_primary) AS host
       FROM tenants t WHERE t.id = $1`,
    [tenantId],
  )
  const t = rows[0] as { slug: string; db_name: string; host: string | null } | undefined
  if (!t) throw new Error('Customer not found')

  let migrationsApplied = 0
  let adminCreated = false
  let domain: DomainResult = { state: 'manual', reason: 'Not reached' }
  try {
    await pool.query(`UPDATE tenants SET status = 'provisioning', provision_error = NULL, updated_at = now() WHERE id = $1`, [tenantId])
    const created = await ensureDatabase(t.db_name)
    if (created) await logTenantEvent(tenantId, ownerEmail, 'database_created', t.db_name)

    const result = await runPendingMigrations({
      connectionString: directUrl(databaseUrlFor(baseUrl(), t.db_name)),
      migrationsDir: MIGRATIONS_DIR,
      // One-off repairs of other customers' own rows never run here.
      skipFilenames: skipFilenamesFor(t.slug, MIGRATIONS_DIR),
      log: () => {},
    })
    migrationsApplied = result.appliedCount
    await logTenantEvent(tenantId, ownerEmail, 'migrations_applied', `${result.appliedCount} applied, ${result.alreadyAppliedCount} already there`)

    adminCreated = await ensureFirstAdmin(t.db_name, admin)
    if (adminCreated) await logTenantEvent(tenantId, ownerEmail, 'admin_created', admin.email.toLowerCase().trim())

    domain = t.host ? await addVercelDomain(t.host) : { state: 'manual', reason: 'No address registered' }
    await logTenantEvent(tenantId, ownerEmail, 'domain', `${t.host}: ${domain.state}${'reason' in domain ? ` (${domain.reason})` : ''}`)

    await pool.query(`UPDATE tenants SET status = 'active', updated_at = now() WHERE id = $1`, [tenantId])
    forgetTenantCache()
    return { ok: true, migrationsApplied, adminCreated, domain }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await pool.query(`UPDATE tenants SET status = 'failed', provision_error = $2, updated_at = now() WHERE id = $1`, [tenantId, message.slice(0, 2000)])
    await logTenantEvent(tenantId, ownerEmail, 'setup_failed', message.slice(0, 2000)).catch(() => {})
    forgetTenantCache()
    return { ok: false, migrationsApplied, adminCreated, domain, error: message }
  }
}
