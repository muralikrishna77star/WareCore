import Link from 'next/link'
import AdminSizeForm from './AdminSizeForm'
import { hasuraQuery } from '@/lib/hasura/server'
import { ACTIVE_MATERIAL_TYPES_QUERY } from '@/lib/hasura/queries'

export default async function NewSizePage() {
  const result = await hasuraQuery(ACTIVE_MATERIAL_TYPES_QUERY)
  const materialTypes = result.material_types ?? []

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Material Size</h1>
      <AdminSizeForm materialTypes={materialTypes} />
    </div>
  )
}
