import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraFetchEnvelope } from '@/lib/hasura/transport'

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
  if (!session || (session.role !== 'admin' && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'User ID is required' }, { status: 400 })

  if (id === session.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
  }

  const checkJson = await hasuraFetchEnvelope(GET_USER_QUERY, { id })
  const target = checkJson?.data?.user_profiles_by_pk
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Only developers can delete another developer
  if (target.role === 'developer' && session.role !== 'developer') {
    return NextResponse.json({ error: 'Only a Developer can delete another Developer account' }, { status: 403 })
  }

  const json = await hasuraFetchEnvelope(DELETE_USER_MUTATION, { id })
  if (json.errors) {
    return NextResponse.json({ error: json.errors[0]?.message ?? 'Failed to delete user' }, { status: 500 })
  }

  return NextResponse.json({ success: true, deleted: json.data?.delete_user_profiles_by_pk })
}
