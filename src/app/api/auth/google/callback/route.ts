import { NextRequest, NextResponse } from 'next/server'
import { signSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || ''
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''

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
}

interface GoogleUserInfo {
  email: string
  name: string
  verified_email: boolean
}

async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${APP_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) return null
  return res.json()
}

async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  return res.json()
}

async function findUserByEmail(email: string) {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({ query: FIND_USER_BY_EMAIL, variables: { email } }),
    cache: 'no-store',
  })
  const json = await res.json()
  return json?.data?.user_profiles?.[0] ?? null
}

function redirectWithError(error: string) {
  return NextResponse.redirect(`${APP_URL}/login?error=${error}`)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const googleError = searchParams.get('error')

  // User denied Google permission
  if (googleError) {
    return redirectWithError('google_denied')
  }

  // CSRF state validation
  const storedState = request.cookies.get('oauth_state')?.value
  if (!state || !storedState || state !== storedState) {
    return redirectWithError('invalid_state')
  }

  if (!code) {
    return redirectWithError('no_code')
  }

  const tokens = await exchangeCodeForTokens(code)
  if (!tokens?.access_token) {
    return redirectWithError('token_failed')
  }

  const googleUser = await getGoogleUserInfo(tokens.access_token)
  if (!googleUser?.email || !googleUser.verified_email) {
    return redirectWithError('unverified_email')
  }

  const user = await findUserByEmail(googleUser.email.toLowerCase())
  if (!user) {
    // Google email is not registered in WareCore — admin must create the account first
    return redirectWithError('not_registered')
  }

  const sessionToken = signSession({
    userId: user.id,
    email: user.email,
    role: user.role,
    fullName: user.full_name,
  })

  const response = NextResponse.redirect(`${APP_URL}/dashboard`)

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
