import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'

const PUBLIC_PATHS = ['/', '/login', '/products', '/contact', '/about']

const APP_PATH_PREFIXES = [
  '/dashboard',
  '/bills',
  '/inventory',
  '/movements',
  '/transfers',
  '/jobwork',
  '/dispatch',
  '/reports',
  '/admin',
]

function isAppPath(pathname: string): boolean {
  return APP_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const session = await verifySessionCookie(request)

  if (!session && isAppPath(pathname)) {
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
