import { NextRequest, NextResponse } from 'next/server'
import { signSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import {
  getAppRedirectUrl,
  getGoogleRedirectUri,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} from '@/lib/env'
import { hasuraFetchEnvelope } from '@/lib/hasura/transport'

const CLIENT_ID = GOOGLE_CLIENT_ID
const CLIENT_SECRET = GOOGLE_CLIENT_SECRET

const FIND_USER_BY_EMAIL = `
  query FindUserByEmail($email: String!) {
    user_profiles(where: { email: { _eq: $email }, is_active: { _eq: true } }, limit: 1) {
      id
      full_name
      email
      role
    }
  }
`

interface GoogleTokenResponse {
  access_token: string
  token_type: string
  _google_error?: string
}

interface GoogleUserInfo {
  email: string
  name: string
  verified_email: boolean
}

async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokenResponse | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID.trim(),
      client_secret: CLIENT_SECRET.trim(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    console.error('[Google OAuth] token exchange failed', res.status, errBody)
    // Parse Google error description for debugging
    try {
      const parsed = JSON.parse(errBody)
      return { _google_error: parsed.error_description || parsed.error || errBody } as never
    } catch {
      return { _google_error: errBody } as never
    }
  }
  const json = await res.json()
  if (!json.access_token) {
    console.error('[Google OAuth] no access_token in response', JSON.stringify(json))
    return { _google_error: json.error_description || json.error || 'no_access_token' } as never
  }
  return json
}

async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  return res.json()
}

async function findUserByEmail(email: string) {
  const json = await hasuraFetchEnvelope(FIND_USER_BY_EMAIL, { email })
  return json?.data?.user_profiles?.[0] ?? null
}

function redirectWithError(error: string, request?: NextRequest) {
  return NextResponse.redirect(getAppRedirectUrl(`/login?error=${error}`, request))
}

export async function GET(request: NextRequest) {
  if (process.env.LOCAL_MODE === 'true') {
    return NextResponse.redirect(`${request.nextUrl.origin}/login?error=google_unavailable_offline`)
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const googleError = searchParams.get('error')

  // User denied Google permission
  if (googleError) {
    return redirectWithError('google_denied', request)
  }

  // CSRF state validation
  const storedState = request.cookies.get('oauth_state')?.value
  if (!state || !storedState || state !== storedState) {
    return redirectWithError('invalid_state', request)
  }

  if (!code) {
    return redirectWithError('no_code', request)
  }

  const redirectUri = getGoogleRedirectUri(request)
  const tokens = await exchangeCodeForTokens(code, redirectUri)
  if (!tokens?.access_token) {
    const googleErr = encodeURIComponent((tokens as { _google_error?: string })?._google_error || 'unknown')
    return NextResponse.redirect(getAppRedirectUrl(`/login?error=token_failed&detail=${googleErr}`, request))
  }

  const googleUser = await getGoogleUserInfo(tokens.access_token)
  if (!googleUser?.email || !googleUser.verified_email) {
    return redirectWithError('unverified_email', request)
  }

  const user = await findUserByEmail(googleUser.email.toLowerCase())
  if (!user) {
    // Google email is not registered in WareCore — admin must create the account first
    return redirectWithError('not_registered', request)
  }

  const sessionToken = signSession({
    userId: user.id,
    email: user.email,
    role: user.role,
    fullName: user.full_name,
  })

  const response = NextResponse.redirect(getAppRedirectUrl('/dashboard', request))

  // Clear the OAuth state cookie
  response.cookies.delete('oauth_state')

  // Set the session cookie
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // must be lax (not strict) for cross-origin OAuth redirects
    maxAge: 60 * 60 * 24,
    path: '/',
  })

  return response
}
