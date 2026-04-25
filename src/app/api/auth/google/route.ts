import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() || ''
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').trim()

export async function GET() {
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.redirect(`${APP_URL}/login?error=google_not_configured`)
  }

  // Random state token for CSRF protection
  const state = randomBytes(16).toString('hex')

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/google/callback`,
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
