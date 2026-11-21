import { TENANT_HEADER, isMultiTenant } from './config'
import { findTenantBySlug } from './control'
import { DEFAULT_BRAND, DEFAULT_LOGO_URL, type Brand } from './brandShared'

export * from './brandShared'

/** The brand for the current request. Never throws: a registry outage shows WareCore's own look. */
export async function getBrand(): Promise<Brand> {
  if (!isMultiTenant()) return DEFAULT_BRAND
  // Outside the try: reading the request is what makes Next render this page
  // per request (per customer) instead of once at build time.
  const { headers } = await import('next/headers')
  const slug = (await headers()).get(TENANT_HEADER)
  if (!slug) return DEFAULT_BRAND
  try {
    const t = await findTenantBySlug(slug)
    if (!t) return DEFAULT_BRAND
    return {
      displayName: t.displayName,
      isCustomer: true,
      logoUrl: t.hasLogo ? `/api/brand/logo?v=${t.version}` : DEFAULT_LOGO_URL,
      color: t.brandColor,
      googleSignIn: t.googleSignIn,
    }
  } catch (err) {
    console.error('[brand] lookup failed:', err instanceof Error ? err.message : err)
    return DEFAULT_BRAND
  }
}
