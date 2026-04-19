'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AdminMaterialForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', unit: 'tons', description: '' })

  function set(field: string, value: string) { setForm((p) => ({ ...p, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const supabase = createClient()
    const { error: err } = await supabase.from('material_types').insert({
      name: form.name,
      unit: form.unit,
      description: form.description || null,
    })
    if (err) { setError(err.message); setLoading(false) }
    else router.push('/admin')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name * (e.g. CR, GI, HR Coil)</label>
        <input
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. CR, GI, GA, HR Coil, Paint"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
        <select
          required
          value={form.unit}
          onChange={(e) => set('unit', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="tons">Tons (MT)</option>
          <option value="kg">Kilograms (kg)</option>
          <option value="units">Units / Pieces</option>
          <option value="liters">Liters</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <input
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : 'Add Material Type'}
        </button>
        <button type="button" onClick={() => router.push('/admin')}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}
