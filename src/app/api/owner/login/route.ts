import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { isMultiTenant, normaliseHost, ownerConsoleHost } from '@/lib/tenancy/config'
import { getControlPool } from '@/lib/tenancy/control'
import { OWNER_COOKIE_NAME, OWNER_SESSION_HOURS, signOwnerToken } from '@/lib/tenancy/ownerSession'

// A real hash of a random throwaway password: unknown emails cost the same bcrypt work.
const DUMMY_HASH = '$2b$12$TC/dylCr87y/mV1svuL68uzOFhXJdf0efiZzM5V50xenmPHQ1KLOW'

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge,
  path: '/',
})

export async function POST(request: NextRequest) {
  if (!isMultiTenant() || normaliseHost(request.headers.get('host')) !== ownerConsoleHost()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  let body: { email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const email = (body.email ?? '').toLowerCase().trim()
  const password = body.password ?? ''
  if (!email || !password) return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })

  const { rows } = await getControlPool().query(
    'SELECT id::text, full_name, password_hash, is_active FROM owner_users WHERE email = $1',
    [email],
  )
  const owner = rows[0]
  // Same work whether or not the account exists, so the answer time doesn't tell.
  const match = await bcrypt.compare(password, owner?.password_hash ?? DUMMY_HASH)
  if (!owner || !match || !owner.is_active) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })

  await getControlPool().query('UPDATE owner_users SET last_login_at = now() WHERE id = $1', [owner.id])
  const response = NextResponse.json({ ok: true })
  response.cookies.set(
    OWNER_COOKIE_NAME,
    signOwnerToken({ ownerId: owner.id, email, fullName: owner.full_name }),
    cookieOptions(OWNER_SESSION_HOURS * 3600),
  )
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(OWNER_COOKIE_NAME, '', cookieOptions(0))
  return response
}
