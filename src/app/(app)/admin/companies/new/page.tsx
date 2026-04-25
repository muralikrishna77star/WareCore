import Link from 'next/link'
import AdminCompanyForm from './AdminCompanyForm'

export default async function NewCompanyPage() {
  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Company</h1>
      <AdminCompanyForm />
    </div>
  )
}
