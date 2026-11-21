import jwt from 'jsonwebtoken'

// Owner console sign-in. A separate cookie and a separate token audience from
// customers' sessions (src/lib/auth/session.ts): an owner token is never a
// customer session and a customer session never opens the owner console.

const JWT_SECRET = process.env.JWT_SECRET || ''
const AUDIENCE = 'warecore-owner'
export const OWNER_COOKIE_NAME = 'wc_owner'
export const OWNER_SESSION_HOURS = 8

export interface OwnerSession {
  ownerId: string
  email: string
  fullName: string
}

export function signOwnerToken(owner: OwnerSession): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET env var is not set')
  return jwt.sign(owner, JWT_SECRET, { expiresIn: `${OWNER_SESSION_HOURS}h`, algorithm: 'HS256', audience: AUDIENCE })
}

export function verifyOwnerToken(token: string | undefined | null): OwnerSession | null {
  if (!token || !JWT_SECRET) return null
  try {
    const p = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], audience: AUDIENCE }) as OwnerSession
    return p.ownerId && p.email ? { ownerId: p.ownerId, email: p.email, fullName: p.fullName } : null
  } catch {
    return null
  }
}
