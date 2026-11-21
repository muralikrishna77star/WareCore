import { NextRequest, NextResponse } from 'next/server'
import { TENANT_HEADER, isMultiTenant } from '@/lib/tenancy/config'
import { getTenantLogo } from '@/lib/tenancy/control'
import { DEFAULT_LOGO_URL } from '@/lib/tenancy/brandShared'

/** The logo of the customer this address opens; WareCore's own when it has none. */
export async function GET(request: NextRequest) {
  const slug = isMultiTenant() ? request.headers.get(TENANT_HEADER) : null
  const logo = slug ? await getTenantLogo(slug) : null
  if (!logo) return NextResponse.redirect(new URL(DEFAULT_LOGO_URL, request.url))
  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      'Content-Type': logo.mime,
      // The URL carries ?v=<last change>, so a new logo is a new URL.
      'Cache-Control': request.nextUrl.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
