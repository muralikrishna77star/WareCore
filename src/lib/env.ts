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

export function getAppUrl(request?: NextRequest) {
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
  return trim(process.env.GOOGLE_OAUTH_REDIRECT_URI) || `${getAppUrl(request)}/api/auth/google/callback`
}

export function getAppRedirectUrl(path: string, request?: NextRequest) {
  const base = getAppUrl(request).replace(/\/$/, '')
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}
