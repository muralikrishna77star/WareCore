import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraFetchEnvelope } from '@/lib/hasura/transport'

const VALID_ROLES = new Set(['developer', 'admin', 'company_manager', 'warehouse_manager', 'sales_manager', 'billing_staff'])

const GET_USER_QUERY = `
  query GetUser($id: uuid!) {
    user_profiles_by_pk(id: $id) { id role }
  }
`

const CHECK_EMAIL_QUERY = `
  query CheckEmail($email: String!, $id: uuid!) {
    user_profiles(where: {email: {_eq: $email}, id: {_neq: $id}}, limit: 1) { id }
  }
`

const UPDATE_USER_MUTATION = `
  mutation UpdateUser($id: uuid!, $full_name: String!, $email: String!, $role: String!, $company_id: uuid, $warehouse_id: uuid, $is_active: Boolean!) {
    update_user_profiles_by_pk(
      pk_columns: {id: $id}
      _set: {
        full_name: $full_name, email: $email, role: $role,
        company_id: $company_id, warehouse_id: $warehouse_id, is_active: $is_active
      }
    ) {
      id full_name email role is_active
    }
  }
`

// Edits an existing user's profile (name/email/role/company/warehouse/active
// status) — the admin Users screen previously only supported create and
// delete, with no way to fix a mis-assigned role. Mirrors
// src/app/api/auth/delete-user/route.ts's gating conventions: admin/developer
// only, and only a developer may change another developer's account.
export async function PATCH(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session || (session.role !== 'admin' && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let body: { id?: string; full_name?: string; email?: string; role?: string; company_id?: string | null; warehouse_id?: string | null; is_active?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { id, full_name, email, role, company_id, warehouse_id, is_active } = body
  if (!id || !full_name || !email || !role || typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'id, full_name, email, role and is_active are required' }, { status: 400 })
  }
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const checkJson = await hasuraFetchEnvelope<{ user_profiles_by_pk: { id: string; role: string } | null }>(GET_USER_QUERY, { id })
  const target = checkJson?.data?.user_profiles_by_pk
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Only developers can change a developer's account (matches delete-user's
  // "only a Developer can delete another Developer" rule).
  if (target.role === 'developer' && session.role !== 'developer') {
    return NextResponse.json({ error: 'Only a Developer can edit another Developer account' }, { status: 403 })
  }
  // Prevent locking yourself out by accidentally changing your own role —
  // ask a different admin/developer to do it instead (same "can't act on
  // your own account" spirit as delete-user's self-delete block).
  if (id === session.userId && role !== target.role) {
    return NextResponse.json({ error: 'You cannot change your own role — ask another admin or developer.' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const dupCheck = await hasuraFetchEnvelope<{ user_profiles: { id: string }[] }>(CHECK_EMAIL_QUERY, { email: normalizedEmail, id })
  if ((dupCheck?.data?.user_profiles?.length ?? 0) > 0) {
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
  }

  const updateJson = await hasuraFetchEnvelope<{ update_user_profiles_by_pk: { id: string; full_name: string; email: string; role: string; is_active: boolean } | null }>(UPDATE_USER_MUTATION, {
    id, full_name, email: normalizedEmail, role,
    company_id: company_id || null, warehouse_id: warehouse_id || null, is_active,
  })
  if (updateJson.errors) {
    return NextResponse.json({ error: updateJson.errors[0]?.message ?? 'Failed to update user' }, { status: 500 })
  }

  return NextResponse.json({ success: true, user: updateJson.data?.update_user_profiles_by_pk })
}
