import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAppUrl, getGoogleRedirectUri, GOOGLE_CLIENT_ID } from '@/lib/env'

export async function GET(request: NextRequest) {
  // Never leave the local desktop app — getAppUrl()/getGoogleRedirectUri()
  // fall back to the build-time NEXT_PUBLIC_APP_URL (the production
  // deployment's URL), which would otherwise send the OAuth round-trip
  // through the live site instead of staying on localhost. Bail out using
  // the actual request origin before any of that runs.
  if (process.env.LOCAL_MODE === 'true') {
    return NextResponse.redirect(`${request.nextUrl.origin}/login?error=google_unavailable_offline`)
  }

  const appUrl = getAppUrl(request)
  const redirectUri = getGoogleRedirectUri(request)
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.redirect(`${appUrl}/login?error=google_not_configured`)
  }

  // Random state token for CSRF protection
  const state = randomBytes(16).toString('hex')

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
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
