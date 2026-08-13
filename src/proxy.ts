import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'

// Explicit allowlist of paths reachable without a session, rather than an
// allowlist of protected prefixes — the prefix list had silently drifted out
// of sync with the sidebar (missing /accounts, /purchase-cancellations,
// /sale-cancellations, /profile), so new modules stayed unprotected by
// default instead of protected by default.
const PUBLIC_PAGE_PATHS = ['/', '/setup', '/offline']

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PAGE_PATHS.includes(pathname) ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const session = await verifySessionCookie(request)

  if (!session && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (session && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Require auth for /api/graphql
  if (pathname === '/api/graphql' && !session) {
    return NextResponse.json({ errors: [{ message: 'Unauthorized' }] }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
