'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  table: string
  label: string
  fields: string[]
}

const fieldLabels: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  size_label: 'Label (e.g. 0.80x121)',
  thickness_mm: 'Thickness (mm)',
  width_mm: 'Width (mm)',
}

export default function AdminSimpleForm({ table, label, fields }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f, '']))
  )

  function set(field: string, value: string) { setForm((p) => ({ ...p, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const supabase = createClient()
    const payload: Record<string, string | number | null> = {}
    for (const f of fields) {
      const val = form[f]
      if (val === '') payload[f] = null
      else if (!isNaN(Number(val)) && val !== '') payload[f] = parseFloat(val)
      else payload[f] = val
    }
    const { error: err } = await supabase.from(table).insert(payload)
    if (err) { setError(err.message); setLoading(false) }
    else router.push('/admin')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      {fields.map((field) => (
        <div key={field}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {fieldLabels[field] ?? field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            {field === 'name' || field === 'size_label' ? ' *' : ''}
          </label>
          <input
            required={field === 'name' || field === 'size_label'}
            value={form[field]}
            onChange={(e) => set(field, e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      ))}
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : `Add ${label}`}
        </button>
        <button type="button" onClick={() => router.push('/admin')}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}
