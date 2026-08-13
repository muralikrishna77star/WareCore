import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import AdminMaterialForm from './AdminMaterialForm'

export default function NewMaterialPage() {
  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4"><ArrowLeft className="h-4 w-4" /> Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Material Type</h1>
      <AdminMaterialForm />
    </div>
  )
}
