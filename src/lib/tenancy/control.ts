import { Pool } from 'pg'
import { controlDbName, databaseUrlFor, normaliseHost } from './config'

// The customer registry (supabase/control-migrations). Values come back as
// pg's native types here; nothing in the registry goes through the GraphQL
// or run_sql stand-ins.

let controlPool: Pool | null = null

export function controlDatabaseUrl(): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL is not set')
  return databaseUrlFor(base, controlDbName())
}

export function getControlPool(): Pool {
  if (!controlPool) {
    controlPool = new Pool({ connectionString: controlDatabaseUrl(), max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 })
    controlPool.on('error', (err) => console.error('[control-db] idle connection error:', err.message))
  }
  return controlPool
}

export async function closeControlPool(): Promise<void> {
  const p = controlPool
  controlPool = null
  forgetTenantCache()
  if (p) await p.end()
}

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'failed'

/** What the app needs about a customer on every request: no logo bytes. */
export interface TenantInfo {
  id: string
  slug: string
  displayName: string
  dbName: string
  status: TenantStatus
  brandColor: string | null
  hasLogo: boolean
  googleSignIn: boolean
  /** Changes whenever the name, logo or colour changes: busts the logo's browser cache. */
  version: string
  primaryHost: string | null
}

const TENANT_COLUMNS = `
  t.id::text, t.slug, t.display_name, t.db_name, t.status, t.brand_color,
  (t.logo IS NOT NULL) AS has_logo, t.google_sign_in,
  extract(epoch FROM t.updated_at)::bigint::text AS version,
  (SELECT d.host FROM tenant_domains d WHERE d.tenant_id = t.id AND d.is_primary) AS primary_host`

function toTenant(r: Record<string, unknown>): TenantInfo {
  return {
    id: r.id as string,
    slug: r.slug as string,
    displayName: r.display_name as string,
    dbName: r.db_name as string,
    status: r.status as TenantStatus,
    brandColor: (r.brand_color as string | null) ?? null,
    hasLogo: Boolean(r.has_logo),
    googleSignIn: Boolean(r.google_sign_in),
    version: r.version as string,
    primaryHost: (r.primary_host as string | null) ?? null,
  }
}

// Host and slug lookups happen on every request, so keep answers briefly per
// server instance. A suspended customer is locked out within CACHE_MS.
const CACHE_MS = 30_000
const byHost = new Map<string, { at: number; tenant: TenantInfo | null }>()
const bySlug = new Map<string, { at: number; tenant: TenantInfo | null }>()

export function forgetTenantCache(): void {
  byHost.clear()
  bySlug.clear()
}

export async function findTenantByHost(host: string): Promise<TenantInfo | null> {
  const h = normaliseHost(host)
  const hit = byHost.get(h)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant
  const { rows } = await getControlPool().query(
    `SELECT ${TENANT_COLUMNS} FROM tenant_domains d0 JOIN tenants t ON t.id = d0.tenant_id WHERE d0.host = $1`,
    [h],
  )
  const tenant = rows[0] ? toTenant(rows[0]) : null
  byHost.set(h, { at: Date.now(), tenant })
  return tenant
}

export async function findTenantBySlug(slug: string, { fresh = false } = {}): Promise<TenantInfo | null> {
  const hit = bySlug.get(slug)
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.tenant
  const { rows } = await getControlPool().query(`SELECT ${TENANT_COLUMNS} FROM tenants t WHERE t.slug = $1`, [slug])
  const tenant = rows[0] ? toTenant(rows[0]) : null
  bySlug.set(slug, { at: Date.now(), tenant })
  return tenant
}

export async function listTenants(): Promise<(TenantInfo & { createdAt: string; provisionError: string | null; hosts: string[] })[]> {
  const { rows } = await getControlPool().query(
    `SELECT ${TENANT_COLUMNS}, t.created_at, t.provision_error,
            ARRAY(SELECT host FROM tenant_domains d WHERE d.tenant_id = t.id ORDER BY d.is_primary DESC, d.host) AS hosts
       FROM tenants t ORDER BY t.display_name`,
  )
  return rows.map((r) => ({
    ...toTenant(r),
    createdAt: (r.created_at as Date).toISOString(),
    provisionError: (r.provision_error as string | null) ?? null,
    hosts: r.hosts as string[],
  }))
}

export async function listActiveTenants(): Promise<TenantInfo[]> {
  const { rows } = await getControlPool().query(`SELECT ${TENANT_COLUMNS} FROM tenants t WHERE t.status = 'active' ORDER BY t.slug`)
  return rows.map(toTenant)
}

export async function getTenantLogo(slug: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const { rows } = await getControlPool().query(
    `SELECT logo, logo_mime FROM tenants WHERE slug = $1 AND logo IS NOT NULL`,
    [slug],
  )
  return rows[0] ? { bytes: rows[0].logo as Buffer, mime: rows[0].logo_mime as string } : null
}

export async function logTenantEvent(tenantId: string | null, ownerEmail: string | null, action: string, detail?: string): Promise<void> {
  await getControlPool().query(
    `INSERT INTO tenant_events (tenant_id, owner_email, action, detail) VALUES ($1, $2, $3, $4)`,
    [tenantId, ownerEmail, action, detail ?? null],
  )
}
