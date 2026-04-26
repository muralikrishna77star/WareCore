import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''

const CREATE_USER_MUTATION = `
  mutation CreateUserProfile($id: uuid!, $email: String!, $password_hash: String!, $full_name: String!, $role: String!, $company_id: uuid, $warehouse_id: uuid) {
    insert_user_profiles_one(object: {
      id: $id
      email: $email
      password_hash: $password_hash
      full_name: $full_name
      role: $role
      company_id: $company_id
      warehouse_id: $warehouse_id
    }) {
      id
      full_name
    }
  }
`

const CHECK_EMAIL_QUERY = `
  query CheckEmail($email: String!) {
    user_profiles(where: {email: {_eq: $email}}, limit: 1) { id }
  }
`

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string; google_only?: boolean; full_name?: string; role?: string; company_id?: string; warehouse_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, password, google_only, full_name, role, company_id, warehouse_id } = body

  if (!email || !full_name || !role) {
    return NextResponse.json({ error: 'email, full_name and role are required' }, { status: 400 })
  }

  if (!google_only && (!password || password.length < 8)) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()

  // Check for duplicate email
  const checkRes = await fetch(HASURA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': HASURA_SECRET },
    body: JSON.stringify({ query: CHECK_EMAIL_QUERY, variables: { email: normalizedEmail } }),
    cache: 'no-store',
  })
  const checkJson = await checkRes.json()
  if (checkJson?.data?.user_profiles?.length > 0) {
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
  }

  const password_hash = google_only ? '' : await bcrypt.hash(password!, 12)
  const id = crypto.randomUUID()

  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': HASURA_SECRET },
    body: JSON.stringify({
      query: CREATE_USER_MUTATION,
      variables: {
        id,
        email: normalizedEmail,
        password_hash,
        full_name,
        role,
        company_id: company_id || null,
        warehouse_id: warehouse_id || null,
      },
    }),
    cache: 'no-store',
  })

  const json = await res.json()
  if (json.errors) {
    return NextResponse.json({ error: json.errors[0]?.message ?? 'Failed to create user' }, { status: 500 })
  }

  return NextResponse.json({ success: true, user: json.data?.insert_user_profiles_one })
}
