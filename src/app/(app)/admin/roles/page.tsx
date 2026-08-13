export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { CUSTOM_ROLES_QUERY } from '@/lib/hasura/queries'
import RolesTable from './RolesTable'

interface CustomRole {
  id: string
  role_name: string
  role_code: string
  description?: string | null
  is_active: boolean
  created_at?: string | null
}

export default async function RolesPage() {
  let roles: CustomRole[] = []
  try {
    const data = await hasuraQuery(CUSTOM_ROLES_QUERY)
    roles = (data?.custom_roles ?? []) as CustomRole[]
  } catch {
    // table not yet migrated
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-gray-500">Define custom roles with per-screen read/write access</p>
        </div>
        <Link
          href="/admin/roles/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + New Role
        </Link>
      </div>

      <RolesTable roles={roles} />
    </div>
  )
}
