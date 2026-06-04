'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

interface Props {
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

export default function AdminUserInviteForm({ companies, warehouses }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [googleOnly, setGoogleOnly] = useState(false)
  const [form, setForm] = useState({
    email: '', password: '', full_name: '', role: 'billing_staff', company_id: '', warehouse_id: '',
  })

  function set(field: string, value: string) { setForm((p) => ({ ...p, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')

    const res = await fetch('/api/auth/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        password: googleOnly ? null : form.password,
        google_only: googleOnly,
        full_name: form.full_name,
        role: form.role,
        company_id: form.company_id || null,
        warehouse_id: form.warehouse_id || null,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed to create user'); setLoading(false); return }

    setSuccess(`User ${form.email} created successfully.`)
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Password {googleOnly ? '' : '*'}</label>
          <div className="relative">
            <input
              required={!googleOnly}
              disabled={googleOnly}
              type={showPassword ? 'text' : 'password'}
              minLength={8}
              value={googleOnly ? '' : form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder={googleOnly ? 'Not required — Google sign-in only' : 'Min 8 characters'}
              className="w-full pr-10 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
            {!googleOnly && (
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                <EyeIcon open={showPassword} />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="google-only"
            type="checkbox"
            checked={googleOnly}
            onChange={(e) => setGoogleOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="google-only" className="text-sm text-gray-700">
            Google sign-in only (no password — user must log in with their Gmail)
          </label>
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
