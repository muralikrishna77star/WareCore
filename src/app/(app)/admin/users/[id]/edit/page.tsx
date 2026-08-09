export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY } from '@/lib/hasura/queries'
import EditUserForm from './EditUserForm'

const GET_USER_QUERY = `
  query GetUserForEdit($id: uuid!) {
    user_profiles_by_pk(id: $id) {
      id full_name email role is_active company_id warehouse_id
    }
  }
`

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [userResult, companyResult, warehouseResult] = await Promise.all([
    hasuraQuery(GET_USER_QUERY, { id }),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
  ])

  const user = userResult.user_profiles_by_pk
  if (!user) notFound()

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin/users" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Users</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit User</h1>
      <EditUserForm user={user} companies={companyResult.companies ?? []} warehouses={warehouseResult.warehouses ?? []} />
    </div>
  )
}
