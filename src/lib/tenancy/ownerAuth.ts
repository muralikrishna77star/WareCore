import { NextRequest, NextResponse } from 'next/server'
import { isMultiTenant, normaliseHost, ownerConsoleHost } from './config'
import { getControlPool } from './control'
import { OWNER_COOKIE_NAME, verifyOwnerToken, type OwnerSession } from './ownerSession'

/**
 * The signed-in owner for an owner console API call, or a response to send
 * back instead. Checks the account is still active on every call, so
 * switching an owner off takes effect at once.
 */
export async function requireOwner(request: NextRequest): Promise<OwnerSession | NextResponse> {
  if (!isMultiTenant() || normaliseHost(request.headers.get('host')) !== ownerConsoleHost()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const owner = verifyOwnerToken(request.cookies.get(OWNER_COOKIE_NAME)?.value)
  if (!owner) return NextResponse.json({ error: 'Please sign in again' }, { status: 401 })
  const { rows } = await getControlPool().query('SELECT is_active FROM owner_users WHERE id = $1', [owner.ownerId])
  if (!rows[0]?.is_active) return NextResponse.json({ error: 'Please sign in again' }, { status: 401 })
  return owner
}

/** Owner pages (server components): the signed-in owner, or null. */
export async function currentOwner(): Promise<OwnerSession | null> {
  if (!isMultiTenant()) return null
  const { cookies, headers } = await import('next/headers')
  if (normaliseHost((await headers()).get('host')) !== ownerConsoleHost()) return null
  const owner = verifyOwnerToken((await cookies()).get(OWNER_COOKIE_NAME)?.value)
  if (!owner) return null
  const { rows } = await getControlPool().query('SELECT is_active FROM owner_users WHERE id = $1', [owner.ownerId])
  return rows[0]?.is_active ? owner : null
}
