import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { signSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''

const FIND_USER_QUERY = `
  query FindUser($email: String!) {
    user_profiles(where: {email: {_eq: $email}}, limit: 1) {
      id
      full_name
      role
      password_hash
      is_active
    }
  }
`

interface UserProfile {
  id: string
  full_name: string
  role: string
  password_hash: string
  is_active: boolean
}

async function findUserByEmail(email: string): Promise<UserProfile | null> {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({ query: FIND_USER_QUERY, variables: { email } }),
    cache: 'no-store',
  })
  const json = await res.json()
  return json?.data?.user_profiles?.[0] ?? null
}

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  // Constant-time response to prevent email enumeration
  const user = await findUserByEmail(email.toLowerCase().trim())

  const passwordMatch = user
    ? await bcrypt.compare(password, user.password_hash)
    : await bcrypt.compare(password, '$2b$10$invalidhashfortimingconstancy.') // dummy compare

  if (!user || !passwordMatch || !user.is_active) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = signSession({
    userId: user.id,
    email: email.toLowerCase().trim(),
    role: user.role,
    fullName: user.full_name,
  })

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24, // 24 hours
    path: '/',
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  })
  return response
}
