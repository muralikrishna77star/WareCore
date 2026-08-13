import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE_NAME, type SessionPayload } from './session'

/**
 * Server Component page/layout guard: redirects to `redirectTo` unless the
 * session cookie is valid and its role is in `allowedRoles`. Mirrors the
 * inline pattern originally in data-integrity/layout.tsx and
 * admin/roles/layout.tsx, extracted so every module's gate is one call.
 */
export async function requirePageRole(
  allowedRoles: ReadonlySet<string>,
  redirectTo = '/dashboard'
): Promise<SessionPayload> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null
  if (!session || !allowedRoles.has(session.role)) redirect(redirectTo)
  return session
}
