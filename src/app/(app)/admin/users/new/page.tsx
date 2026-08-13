export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import AdminUserInviteForm from './AdminUserInviteForm'
import { hasuraQuery } from '@/lib/hasura/server'
import { ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY } from '@/lib/hasura/queries'

export default async function NewUserPage() {
  const [companyResult, warehouseResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
  ])
  const companies = companyResult.companies ?? []
  const warehouses = warehouseResult.warehouses ?? []

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4"><ArrowLeft className="h-4 w-4" /> Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Invite User</h1>
      <AdminUserInviteForm companies={companies} warehouses={warehouses} />
    </div>
  )
}
