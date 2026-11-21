// Multi-customer mode: one WareCore deployment serves several customers, each
// with its own database, picked by the web address (bsm.warecore.space).
//
// Off unless MULTI_TENANT=true. Off, everything works exactly as before: one
// database (DATABASE_URL), no customer registry, no owner console. The desktop
// app (LOCAL_MODE) and the test harness always run with it off.

const trim = (v?: string) => v?.trim() || ''

export function isMultiTenant(): boolean {
  return process.env.MULTI_TENANT === 'true' && process.env.LOCAL_MODE !== 'true'
}

/** The domain customer addresses sit under: <slug>.warecore.space. */
export function rootDomain(): string {
  return (trim(process.env.TENANT_ROOT_DOMAIN) || 'warecore.space').toLowerCase()
}

/** Where WareCore owners add and manage customers. */
export function ownerConsoleHost(): string {
  return (trim(process.env.OWNER_CONSOLE_HOST) || `console.${rootDomain()}`).toLowerCase()
}

/** Name of the customer registry database, on the same server as DATABASE_URL. */
export function controlDbName(): string {
  return trim(process.env.CONTROL_DB_NAME) || 'warecore_control'
}

// Set by the proxy on every request; any copy sent by a browser is removed first.
export const TENANT_HEADER = 'x-warecore-tenant'
export const TENANT_DB_HEADER = 'x-warecore-tenant-db'

/** Sub-domains a customer can't take: they are, or may become, WareCore's own. */
export const RESERVED_SLUGS = new Set([
  'www', 'console', 'admin', 'owner', 'api', 'app', 'apps', 'mail', 'email', 'smtp', 'ftp',
  'staging', 'stage', 'test', 'dev', 'demo', 'help', 'support', 'docs', 'status', 'blog',
  'static', 'assets', 'cdn', 'auth', 'login', 'billing', 'warecore',
])

export const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,29}$/
export const DB_NAME_PATTERN = /^[a-z][a-z0-9_]{1,62}$/

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.endsWith('-') && !slug.includes('--') && !RESERVED_SLUGS.has(slug)
}

/** wc_<slug>, so a customer's database is recognisable in the Neon console. */
export function dbNameForSlug(slug: string): string {
  return `wc_${slug.replace(/-/g, '_')}`
}

/** Host name of a request, lower-case and without port. */
export function normaliseHost(host: string | null | undefined): string {
  return (host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

/**
 * The same server and login as `base`, pointed at another database. Only the
 * database name changes, so no customer's password or host is ever stored.
 */
export function databaseUrlFor(base: string, dbName: string): string {
  if (!DB_NAME_PATTERN.test(dbName)) throw new Error(`Invalid database name: ${dbName}`)
  const url = new URL(base)
  url.pathname = `/${dbName}`
  return url.toString()
}

/**
 * Neon's pooled address (…-pooler…) can't run CREATE DATABASE reliably and
 * holds long migrations badly; set-up work uses the direct address instead.
 */
export function directUrl(url: string): string {
  const u = new URL(url)
  u.hostname = u.hostname.replace('-pooler.', '.')
  return u.toString()
}
