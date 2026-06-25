import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { hasuraFetchEnvelope } from '@/lib/hasura/transport'

const COUNT_USERS_QUERY = `
  query CountUsers {
    user_profiles_aggregate {
      aggregate { count }
    }
  }
`

const CREATE_ADMIN_MUTATION = `
  mutation CreateFirstAdmin($id: uuid!, $email: String!, $password_hash: String!, $full_name: String!) {
    insert_user_profiles_one(object: {
      id: $id
      email: $email
      password_hash: $password_hash
      full_name: $full_name
      role: "admin"
    }) {
      id
      full_name
    }
  }
`

/**
 * Creates the very first admin user for a brand-new database — only works
 * while user_profiles is empty (true for a freshly-migrated local Postgres
 * on first launch of the desktop build, or a fresh web deployment). Once any
 * user exists, this route refuses to run again.
 */
export async function GET() {
  const countJson = await hasuraFetchEnvelope(COUNT_USERS_QUERY)
  const count = countJson?.data?.user_profiles_aggregate?.aggregate?.count ?? 0
  return NextResponse.json({ needsSetup: count === 0 })
}

export async function POST(request: NextRequest) {
  const countJson = await hasuraFetchEnvelope(COUNT_USERS_QUERY)
  const count = countJson?.data?.user_profiles_aggregate?.aggregate?.count ?? 0
  if (count > 0) {
    return NextResponse.json({ error: 'Setup has already been completed' }, { status: 403 })
  }

  let body: { email?: string; password?: string; full_name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, password, full_name } = body
  if (!email || !full_name) {
    return NextResponse.json({ error: 'email and full_name are required' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const password_hash = await bcrypt.hash(password, 12)
  const id = crypto.randomUUID()

  const json = await hasuraFetchEnvelope(CREATE_ADMIN_MUTATION, {
    id,
    email: email.toLowerCase().trim(),
    password_hash,
    full_name,
  })

  if (json.errors) {
    return NextResponse.json({ error: json.errors[0]?.message ?? 'Failed to create admin user' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
