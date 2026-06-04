import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || ''
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''

const DELETE_USER_MUTATION = `
  mutation DeleteUser($id: uuid!) {
    delete_user_profiles_by_pk(id: $id) {
      id
      full_name
    }
  }
`

const GET_USER_QUERY = `
  query GetUser($id: uuid!) {
    user_profiles_by_pk(id: $id) { id role }
  }
`

export async function DELETE(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'User ID is required' }, { status: 400 })

  if (id === session.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
  }

  // Prevent deleting other admins (safety guard)
  const checkRes = await fetch(HASURA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': HASURA_SECRET },
    body: JSON.stringify({ query: GET_USER_QUERY, variables: { id } }),
    cache: 'no-store',
  })
  const checkJson = await checkRes.json()
  const target = checkJson?.data?.user_profiles_by_pk
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': HASURA_SECRET },
    body: JSON.stringify({ query: DELETE_USER_MUTATION, variables: { id } }),
    cache: 'no-store',
  })
  const json = await res.json()
  if (json.errors) {
    return NextResponse.json({ error: json.errors[0]?.message ?? 'Failed to delete user' }, { status: 500 })
  }

  return NextResponse.json({ success: true, deleted: json.data?.delete_user_profiles_by_pk })
}
