import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie, SESSION_COOKIE_NAME, type SessionPayload } from '@/lib/auth/session'
import { OWNER_COOKIE_NAME, verifyOwnerToken } from '@/lib/tenancy/ownerSession'
import {
  TENANT_DB_HEADER, TENANT_HEADER, isMultiTenant, normaliseHost, ownerConsoleHost, rootDomain,
} from '@/lib/tenancy/config'
import { findTenantByHost } from '@/lib/tenancy/control'

// Explicit allowlist of paths reachable without a session, rather than an
// allowlist of protected prefixes — the prefix list had silently drifted out
// of sync with the sidebar (missing /accounts, /purchase-cancellations,
// /sale-cancellations, /profile), so new modules stayed unprotected by
// default instead of protected by default.
const PUBLIC_PAGE_PATHS = ['/', '/tour', '/setup', '/offline']

// Static files under public/ — brand/logo images, PWA manifest icons,
// manifest.json, and the service worker script all need to load before
// a session exists (e.g. the login/setup pages' own logo, or a PWA
// install prompt on the login screen).
function isStaticPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/help/screens/') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js'
  )
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PAGE_PATHS.includes(pathname) ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/') ||
    isStaticPath(pathname)
  )
}

const isOwnerPath = (pathname: string) =>
  pathname === '/owner' || pathname.startsWith('/owner/') || pathname.startsWith('/api/owner/')

/** The sign-in rules every customer's screens have always had. */
function appGate(request: NextRequest, session: SessionPayload | null, forwarded: Headers, dropSession: boolean) {
  const { pathname } = request.nextUrl
  let response: NextResponse

  if (!session && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    response = NextResponse.redirect(url)
  } else if (session && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    response = NextResponse.redirect(url)
  } else if (pathname === '/api/graphql' && !session) {
    // Require auth for /api/graphql
    response = NextResponse.json({ errors: [{ message: 'Unauthorized' }] }, { status: 401 })
  } else {
    response = NextResponse.next({ request: { headers: forwarded } })
  }

  if (dropSession) response.cookies.delete(SESSION_COOKIE_NAME)
  return response
}

/** Removes the session cookie from what the app's pages and API routes see. */
function withoutSessionCookie(headers: Headers): void {
  const kept = (headers.get('cookie') || '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (kept.length) headers.set('cookie', kept.join('; '))
  else headers.delete('cookie')
}

function unavailable(request: NextRequest, reason: 'unknown' | 'suspended' | 'setup' | 'error', status: number) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'No WareCore customer is available at this address' }, { status })
  }
  const url = request.nextUrl.clone()
  url.pathname = '/unavailable'
  url.search = `?reason=${reason}`
  return NextResponse.rewrite(url, { status })
}

function notFound(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const url = request.nextUrl.clone()
  url.pathname = '/unavailable'
  url.search = '?reason=unknown'
  return NextResponse.rewrite(url, { status: 404 })
}

/** console.warecore.space: the owner console and nothing else. */
async function ownerConsole(request: NextRequest, forwarded: Headers) {
  const { pathname } = request.nextUrl
  if (isStaticPath(pathname) || pathname === '/unavailable') return NextResponse.next({ request: { headers: forwarded } })
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/owner'
    return NextResponse.redirect(url)
  }
  if (!isOwnerPath(pathname)) return notFound(request)

  const owner = verifyOwnerToken(request.cookies.get(OWNER_COOKIE_NAME)?.value)
  const open = pathname === '/owner/login' || pathname === '/api/owner/login'
  if (!owner && !open) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = request.nextUrl.clone()
    url.pathname = '/owner/login'
    url.search = ''
    return NextResponse.redirect(url)
  }
  return NextResponse.next({ request: { headers: forwarded } })
}

/** warecore.space / www: the public website only. */
function website(request: NextRequest, forwarded: Headers) {
  const { pathname } = request.nextUrl
  if (pathname === '/' || pathname === '/tour' || isStaticPath(pathname) || pathname === '/unavailable') {
    return NextResponse.next({ request: { headers: forwarded } })
  }
  return notFound(request)
}

export async function proxy(request: NextRequest) {
  // Which customer a request is for is decided here and only here: a copy of
  // these headers sent by a browser is always thrown away.
  const forwarded = new Headers(request.headers)
  forwarded.delete(TENANT_HEADER)
  forwarded.delete(TENANT_DB_HEADER)

  if (!isMultiTenant()) {
    return appGate(request, await verifySessionCookie(request), forwarded, false)
  }

  const { pathname } = request.nextUrl
  // The nightly job belongs to no address; it runs for every customer itself.
  if (pathname.startsWith('/api/cron/')) return NextResponse.next({ request: { headers: forwarded } })

  const host = normaliseHost(request.headers.get('host'))
  if (host === ownerConsoleHost()) return ownerConsole(request, forwarded)
  if (host === rootDomain() || host === `www.${rootDomain()}`) return website(request, forwarded)

  let tenant
  try {
    tenant = await findTenantByHost(host)
  } catch (err) {
    console.error('[proxy] customer lookup failed:', err instanceof Error ? err.message : err)
    return unavailable(request, 'error', 503)
  }
  if (!tenant) return unavailable(request, 'unknown', 404)
  if (pathname === '/unavailable') return NextResponse.next({ request: { headers: forwarded } })
  if (tenant.status === 'suspended') return unavailable(request, 'suspended', 403)
  if (tenant.status !== 'active') return unavailable(request, 'setup', 503)
  if (isOwnerPath(pathname)) return notFound(request)

  forwarded.set(TENANT_HEADER, tenant.slug)
  forwarded.set(TENANT_DB_HEADER, tenant.dbName)

  let session = await verifySessionCookie(request)
  let dropSession = false
  if (request.cookies.has(SESSION_COOKIE_NAME) && (!session || session.tenant !== tenant.slug)) {
    // Expired, forged, or another customer's sign-in: the app never sees it.
    session = null
    dropSession = true
    withoutSessionCookie(forwarded)
  }
  return appGate(request, session, forwarded, dropSession)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
