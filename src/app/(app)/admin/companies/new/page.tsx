import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import AdminCompanyForm from './AdminCompanyForm'

export default async function NewCompanyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user?.id)
    .single()

  if (profile?.role !== 'admin') {
    return (
      <div className="p-6">
        <p className="text-red-600">Admin access required.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Company</h1>
      <AdminCompanyForm />
    </div>
  )
}
