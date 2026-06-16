'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { UPDATE_ITEM_MASTER_MUTATION } from '@/lib/hasura/queries'
import type { ItemMaster } from '@/types'

interface Props {
  item: ItemMaster & { material_types?: { code: string; description: string } }
}

export default function AdminItemMasterEditForm({ item }: Props) {
  const router = useRouter()
  const [itemName, setItemName] = useState(item.item_name)
  const [unit, setUnit] = useState(item.unit)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!itemName.trim()) { setError('Item name is required.'); return }
    if (!unit.trim()) { setError('Unit is required.'); return }
    setLoading(true); setError('')
    const { error: err } = await hasuraFetch(UPDATE_ITEM_MASTER_MUTATION, {
      id: item.id,
      item_name: itemName.trim(),
      unit: unit.trim(),
    })
    if (err) { setError(err.message); setLoading(false); return }
    router.push('/admin/items')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Item Code</label>
          <input readOnly value={item.item_code}
            className="block w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono text-gray-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Material Type</label>
          <input readOnly value={item.material_types ? `${item.material_types.code} — ${item.material_types.description}` : '—'}
            className="block w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
          <input value={itemName} onChange={e => setItemName(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Item name" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
          <input value={unit} onChange={e => setUnit(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="e.g. MT" />
        </div>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : 'Save Changes'}
        </button>
        <button type="button" onClick={() => router.push('/admin/items')}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}
