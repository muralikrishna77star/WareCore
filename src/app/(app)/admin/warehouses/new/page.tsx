export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import AdminWarehouseForm from './AdminWarehouseForm'
import { hasuraQuery } from '@/lib/hasura/server'
import { ACTIVE_COMPANIES_QUERY } from '@/lib/hasura/queries'

export default async function NewWarehousePage() {
  const result = await hasuraQuery(ACTIVE_COMPANIES_QUERY)
  const companies = result.companies ?? []

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4"><ArrowLeft className="h-4 w-4" /> Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Warehouse</h1>
      <AdminWarehouseForm companies={companies} />
    </div>
  )
}
