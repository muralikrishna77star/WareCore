import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || ''
const COOKIE_NAME = 'wc_session'

export interface SessionPayload {
  userId: string
  email: string
  role: string
  fullName: string
  /**
   * The customer this sign-in belongs to (multi-customer mode only). The proxy
   * drops a session whose customer isn't the one the address opens, so a
   * cookie or token from one customer never opens another's data.
   */
  tenant?: string
}

export function signSession(payload: SessionPayload): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET env var is not set')
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' })
}

export function verifySession(token: string): SessionPayload | null {
  if (!JWT_SECRET) return null
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as SessionPayload & { aud?: unknown }
    // Owner console tokens carry an audience (src/lib/tenancy/ownerSession.ts); never a customer session.
    if (payload.aud !== undefined) return null
    return payload
  } catch {
    return null
  }
}

/** Reads and verifies the session cookie from an incoming request. */
export async function verifySessionCookie(
  request: NextRequest
): Promise<SessionPayload | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifySession(token)
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
