'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { CREATE_WAREHOUSE_MUTATION } from '@/lib/hasura/queries'

interface Props { companies: { id: string; name: string }[] }

export default function AdminWarehouseForm({ companies }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', company_id: '', address: '', city: '', state: '' })

  function set(field: string, value: string) { setForm((p) => ({ ...p, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error: err } = await hasuraFetch(CREATE_WAREHOUSE_MUTATION, {
      name: form.name,
      company_id: form.company_id || null,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
    })
    if (err) { setError(err.message); setLoading(false) }
    else router.push('/admin')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse Name *</label>
          <input required value={form.name} onChange={(e) => set('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
          <select value={form.company_id} onChange={(e) => set('company_id', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— None —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
          <input value={form.address} onChange={(e) => set('address', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input value={form.city} onChange={(e) => set('city', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <input value={form.state} onChange={(e) => set('state', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : 'Add Warehouse'}
        </button>
        <button type="button" onClick={() => router.push('/admin')}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}
