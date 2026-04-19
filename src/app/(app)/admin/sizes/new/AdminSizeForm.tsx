'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  materialTypes: { id: string; name: string }[]
}

export default function AdminSizeForm({ materialTypes }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    material_type_id: '',
    size_label: '',
    thickness: '',
    width: '',
  })

  function set(field: string, value: string) { setForm((p) => ({ ...p, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const supabase = createClient()
    const { error: err } = await supabase.from('material_sizes').insert({
      material_type_id: form.material_type_id,
      size_label: form.size_label,
      thickness: form.thickness ? parseFloat(form.thickness) : null,
      width: form.width ? parseFloat(form.width) : null,
    })
    if (err) { setError(err.message); setLoading(false) }
    else router.push('/admin')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Material Type *</label>
        <select
          required
          value={form.material_type_id}
          onChange={(e) => set('material_type_id', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select material type…</option>
          {materialTypes.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Size Label * (e.g. 0.80x121)</label>
        <input
          required
          value={form.size_label}
          onChange={(e) => set('size_label', e.target.value)}
          placeholder="e.g. 0.80x1219, 1.40x1165, Over Width"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Thickness (mm)</label>
          <input
            type="number" step="0.001"
            value={form.thickness}
            onChange={(e) => set('thickness', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Width (mm)</label>
          <input
            type="number" step="0.1"
            value={form.width}
            onChange={(e) => set('width', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : 'Add Size'}
        </button>
        <button type="button" onClick={() => router.push('/admin')}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}
