'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  companies: { id: string; name: string }[]
  warehouses: { id: string; name: string }[]
}

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'company_manager', label: 'Company Manager' },
  { value: 'warehouse_manager', label: 'Warehouse Manager' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'billing_staff', label: 'Billing Staff' },
]

export default function AdminUserInviteForm({ companies, warehouses }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({
    email: '', full_name: '', role: 'billing_staff', company_id: '', warehouse_id: '',
  })

  function set(field: string, value: string) { setForm((p) => ({ ...p, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')
    const supabase = createClient()

    // Generate a cryptographically secure temp password — never displayed to the user
    const randomBytes = new Uint8Array(24)
    crypto.getRandomValues(randomBytes)
    const tempPassword = btoa(String.fromCharCode(...randomBytes)).replace(/[+/=]/g, '') + 'A1!'

    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: form.email,
      password: tempPassword,
      options: { data: { full_name: form.full_name } },
    })

    if (authErr) { setError(authErr.message); setLoading(false); return }

    if (authData.user) {
      const { error: profileErr } = await supabase.from('user_profiles').upsert({
        id: authData.user.id,
        full_name: form.full_name,
        role: form.role,
        company_id: form.company_id || null,
        warehouse_id: form.warehouse_id || null,
      })
      if (profileErr) { setError(profileErr.message); setLoading(false); return }

      // Immediately send a password reset email so the user sets their own password
      await supabase.auth.resetPasswordForEmail(form.email)
    }

    setSuccess(`User ${form.email} created. A confirmation and password-reset email has been sent to them.`)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      {success && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          <p>{success}</p>
          <button type="button" onClick={() => router.push('/admin')} className="mt-2 text-blue-600 hover:underline">
            Back to Admin
          </button>
        </div>
      )}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
          <input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
          <input required value={form.full_name} onChange={(e) => set('full_name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
          <select required value={form.role} onChange={(e) => set('role', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
          <select value={form.company_id} onChange={(e) => set('company_id', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— All Companies (Admin only) —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
          <select value={form.warehouse_id} onChange={(e) => set('warehouse_id', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— None —</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>
      {!success && (
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Creating…' : 'Create User'}
          </button>
          <button type="button" onClick={() => router.push('/admin')}
            className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      )}
    </form>
  )
}
