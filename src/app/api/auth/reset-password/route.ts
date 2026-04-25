import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''

const FIND_USER_BY_TOKEN = `
  query FindUserByToken($token: String!) {
    user_profiles(
      where: {
        reset_token: { _eq: $token }
        reset_token_expires_at: { _gt: "now()" }
        is_active: { _eq: true }
      }
      limit: 1
    ) {
      id
    }
  }
`

const RESET_PASSWORD = `
  mutation ResetPassword($id: uuid!, $password_hash: String!) {
    update_user_profiles_by_pk(
      pk_columns: { id: $id }
      _set: { password_hash: $password_hash, reset_token: null, reset_token_expires_at: null }
    ) {
      id
    }
  }
`

async function hasuraRequest(query: string, variables: Record<string, unknown>) {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  })
  return res.json()
}

function isStrongPassword(password: string): boolean {
  return password.length >= 8
}

export async function POST(request: NextRequest) {
  let body: { token?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { token, password } = body

  if (!token || !password) {
    return NextResponse.json({ error: 'Token and password are required' }, { status: 400 })
  }

  if (!isStrongPassword(password)) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    )
  }

  const result = await hasuraRequest(FIND_USER_BY_TOKEN, { token })
  const user = result?.data?.user_profiles?.[0]

  if (!user) {
    return NextResponse.json(
      { error: 'Invalid or expired reset link. Please request a new one.' },
      { status: 400 }
    )
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await hasuraRequest(RESET_PASSWORD, { id: user.id, password_hash: passwordHash })

  return NextResponse.json({ ok: true })
}
