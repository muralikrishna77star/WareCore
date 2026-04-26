import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { verifySessionCookie } from '@/lib/auth/session'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''

const GET_USER_HASH_QUERY = `
  query GetUserHash($id: uuid!) {
    user_profiles_by_pk(id: $id) {
      id
      password_hash
    }
  }
`

const UPDATE_PASSWORD_MUTATION = `
  mutation UpdatePassword($id: uuid!, $password_hash: String!) {
    update_user_profiles_by_pk(pk_columns: {id: $id}, _set: {password_hash: $password_hash}) {
      id
    }
  }
`

export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: { current_password?: string; new_password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { current_password, new_password } = body

  if (!current_password || !new_password) {
    return NextResponse.json({ error: 'current_password and new_password are required' }, { status: 400 })
  }

  if (new_password.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
  }

  // Fetch current hash
  const getRes = await fetch(HASURA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': HASURA_SECRET },
    body: JSON.stringify({ query: GET_USER_HASH_QUERY, variables: { id: session.userId } }),
    cache: 'no-store',
  })
  const getJson = await getRes.json()
  const user = getJson?.data?.user_profiles_by_pk
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // For Google-only accounts, password_hash is empty — disallow change via this route
  if (!user.password_hash) {
    return NextResponse.json({ error: 'This account uses Google sign-in. No password to change.' }, { status: 400 })
  }

  const valid = await bcrypt.compare(current_password, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })
  }

  const new_hash = await bcrypt.hash(new_password, 12)

  const updateRes = await fetch(HASURA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': HASURA_SECRET },
    body: JSON.stringify({ query: UPDATE_PASSWORD_MUTATION, variables: { id: session.userId, password_hash: new_hash } }),
    cache: 'no-store',
  })
  const updateJson = await updateRes.json()
  if (updateJson.errors) {
    return NextResponse.json({ error: updateJson.errors[0]?.message ?? 'Failed to update password' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
