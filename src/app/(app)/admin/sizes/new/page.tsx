import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AdminSizeForm from './AdminSizeForm'

export default async function NewSizePage() {
  const supabase = await createClient()
  const { data: materialTypes } = await supabase.from('material_types').select('id, name').order('name')

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Material Size</h1>
      <AdminSizeForm materialTypes={materialTypes ?? []} />
    </div>
  )
}
