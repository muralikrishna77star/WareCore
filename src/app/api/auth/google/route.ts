import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAppUrl, getGoogleRedirectUri, GOOGLE_CLIENT_ID, GOOGLE_DESKTOP_CLIENT_ID } from '@/lib/env'

export async function GET(request: NextRequest) {
  const isDesktop = process.env.LOCAL_MODE === 'true'

  // Desktop uses its own low-privilege OAuth client (see GOOGLE_DESKTOP_CLIENT_ID's
  // comment in lib/env.ts for why it's separate from the web client). No
  // desktop client configured (the common case — most distributed builds
  // don't carry one) falls back to the existing "unavailable offline"
  // message rather than erroring. getAppUrl()/getGoogleRedirectUri() already
  // resolve to the request's own origin under LOCAL_MODE, so the OAuth
  // round-trip never leaves this machine.
  if (isDesktop && !GOOGLE_DESKTOP_CLIENT_ID) {
    return NextResponse.redirect(`${request.nextUrl.origin}/login?error=google_unavailable_offline`)
  }

  const appUrl = getAppUrl(request)
  const redirectUri = getGoogleRedirectUri(request)
  const clientId = isDesktop ? GOOGLE_DESKTOP_CLIENT_ID : GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(`${appUrl}/login?error=google_not_configured`)
  }

  // Random state token for CSRF protection
  const state = randomBytes(16).toString('hex')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  )

  // Store state in a short-lived httpOnly cookie to validate on callback
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  })

  return response
}
