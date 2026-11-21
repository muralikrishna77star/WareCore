import { AsyncLocalStorage } from 'node:async_hooks'
import { DB_NAME_PATTERN, TENANT_DB_HEADER, TENANT_HEADER, isMultiTenant } from './config'

/** Which customer a piece of server work is for. */
export interface TenantRef {
  slug: string
  dbName: string
}

const store = new AsyncLocalStorage<TenantRef>()

/**
 * Runs `fn` against one customer's database, for work no web request belongs
 * to: the nightly scan looping over every customer, set-up, scripts.
 */
export function runWithTenant<T>(tenant: TenantRef, fn: () => Promise<T>): Promise<T> {
  return store.run(tenant, fn)
}

/**
 * The customer this server work is for, or null in single-customer mode.
 *
 * In multi-customer mode it never falls back to a default customer: no
 * customer means an error, so a missed code path fails loudly instead of
 * reading or writing another customer's data.
 */
export async function currentTenant(): Promise<TenantRef | null> {
  if (!isMultiTenant()) return null
  const scoped = store.getStore()
  if (scoped) return scoped

  let slug: string | null = null
  let dbName: string | null = null
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    slug = h.get(TENANT_HEADER)
    dbName = h.get(TENANT_DB_HEADER)
  } catch (err) {
    // Next's own "render this per request" signal must reach Next.
    const { unstable_rethrow } = await import('next/navigation')
    unstable_rethrow(err)
    // Otherwise: not inside a web request.
  }
  if (slug && dbName && DB_NAME_PATTERN.test(dbName)) return { slug, dbName }
  throw new Error('No WareCore customer is selected for this request')
}

/** The customer's slug for this request (null in single-customer mode). */
export async function currentTenantSlug(): Promise<string | null> {
  return (await currentTenant())?.slug ?? null
}
