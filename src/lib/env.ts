import type { NextRequest } from 'next/server'

const trim = (value?: string) => value?.trim() || ''

export const APP_ENV =
  trim(process.env.NEXT_PUBLIC_APP_ENV) ||
  trim(process.env.NODE_ENV) ||
  'development'

export const APP_URL = trim(process.env.NEXT_PUBLIC_APP_URL) || 'http://localhost:3000'
export const HASURA_URL = trim(process.env.NEXT_PUBLIC_HASURA_URL) || ''
export const HASURA_ADMIN_SECRET = trim(process.env.HASURA_ADMIN_SECRET) || ''
export const GOOGLE_CLIENT_ID = trim(process.env.GOOGLE_CLIENT_ID)
export const GOOGLE_CLIENT_SECRET = trim(process.env.GOOGLE_CLIENT_SECRET)
export const GOOGLE_OAUTH_REDIRECT_URI =
  trim(process.env.GOOGLE_OAUTH_REDIRECT_URI) || `${APP_URL}/api/auth/google/callback`

// A separate OAuth client from the web app's — the desktop build ships this
// secret inside a distributable zip anyone can unzip and inspect (see
// WC-Installer/stage.mjs), so it must be a dedicated, low-privilege Google
// Cloud OAuth client, never the production web client's. If it leaks, only
// this client can be revoked/rotated without touching the web login flow.
export const GOOGLE_DESKTOP_CLIENT_ID = trim(process.env.GOOGLE_DESKTOP_CLIENT_ID)
export const GOOGLE_DESKTOP_CLIENT_SECRET = trim(process.env.GOOGLE_DESKTOP_CLIENT_SECRET)

export function getAppUrl(request?: NextRequest) {
  // The desktop build embeds NEXT_PUBLIC_APP_URL from whichever machine ran
  // `npm run build` for staging (see WC-Installer/stage.mjs) — typically the
  // production web URL, since the same build artifact serves both. Using it
  // here would send a desktop user's OAuth round-trip through the live
  // site instead of staying on their own machine, so LOCAL_MODE always
  // takes the actual request origin first, before checking the env var.
  if (process.env.LOCAL_MODE === 'true' && request?.url) {
    try {
      return new URL(request.url).origin
    } catch {
      // fall through
    }
  }

  const explicitUrl = trim(process.env.NEXT_PUBLIC_APP_URL)
  if (explicitUrl) return explicitUrl

  if (request?.url) {
    try {
      return new URL(request.url).origin
    } catch {
      // fall through to default
    }
  }

  return 'http://localhost:3000'
}

export function getGoogleRedirectUri(request?: NextRequest) {
  // Same reasoning as getAppUrl(): a pinned GOOGLE_OAUTH_REDIRECT_URI is a
  // web-deploy concern and would be wrong for a desktop instance's own port.
  if (process.env.LOCAL_MODE === 'true') return `${getAppUrl(request)}/api/auth/google/callback`
  return trim(process.env.GOOGLE_OAUTH_REDIRECT_URI) || `${getAppUrl(request)}/api/auth/google/callback`
}

export function getAppRedirectUrl(path: string, request?: NextRequest) {
  const base = getAppUrl(request).replace(/\/$/, '')
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}
