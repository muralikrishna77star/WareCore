'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface User {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  company_id: string | null
  warehouse_id: string | null
}

interface Props {
  user: User
  companies: { id: string; name: string }[]
  warehouses: { id: string; name: string }[]
}

const ROLES = [
  { value: 'developer', label: 'Developer (Super Admin)' },
  { value: 'admin', label: 'Admin' },
  { value: 'company_manager', label: 'Company Manager' },
  { value: 'warehouse_manager', label: 'Warehouse Manager' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'billing_staff', label: 'Billing Staff' },
]

export default function EditUserForm({ user, companies, warehouses }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({
    full_name: user.full_name, email: user.email, role: user.role,
    company_id: user.company_id ?? '', warehouse_id: user.warehouse_id ?? '',
    is_active: user.is_active,
  })

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((p) => ({ ...p, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')

    const res = await fetch('/api/auth/edit-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: user.id,
        full_name: form.full_name,
        email: form.email,
        role: form.role,
        company_id: form.company_id || null,
        warehouse_id: form.warehouse_id || null,
        is_active: form.is_active,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed to update user'); setLoading(false); return }

    setSuccess('User updated.')
    setLoading(false)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      {success && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{success}</p>}
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
        <div className="flex items-center gap-2">
          <input
            id="is-active"
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="is-active" className="text-sm text-gray-700">Active (inactive users cannot sign in)</label>
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : 'Save Changes'}
        </button>
        <button type="button" onClick={() => router.push('/admin/users')}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}
