export const dynamic = 'force-dynamic'

import Link from 'next/link'
import AdminEntityForm from '../../AdminEntityForm'
import { hasuraQuery } from '@/lib/hasura/server'
import { ACTIVE_COMPANIES_QUERY } from '@/lib/hasura/queries'

export default async function NewSupplierPage() {
  const result = await hasuraQuery(ACTIVE_COMPANIES_QUERY)
  const companies = result.companies ?? []

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Supplier</h1>
      <AdminEntityForm table="suppliers" label="Supplier" companies={companies} />
    </div>
  )
}
