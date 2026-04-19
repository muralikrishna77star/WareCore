import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import AdminWarehouseForm from './AdminWarehouseForm'

export default async function NewWarehousePage() {
  const supabase = await createClient()
  const { data: companies } = await supabase.from('companies').select('id, name').order('name')

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Warehouse</h1>
      <AdminWarehouseForm companies={companies ?? []} />
    </div>
  )
}
