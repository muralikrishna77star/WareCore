'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { ITEM_MASTERS_QUERY, ACTIVE_MATERIAL_TYPES_QUERY } from '@/lib/hasura/queries'

export default function ItemMastersPage() {
  const [items, setItems] = useState<any[]>([])
  const [materialTypes, setMaterialTypes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([
      hasuraFetch(ITEM_MASTERS_QUERY),
      hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
    ]).then(([itemsRes, typesRes]) => {
      setItems((itemsRes.data as any)?.item_master ?? [])
      setMaterialTypes((typesRes.data as any)?.material_types ?? [])
      setLoading(false)
    })
  }, [])

  const filtered = items.filter(item => {
    const matchesType = !filterType || item.material_type_id === filterType
    const q = search.toLowerCase()
    const matchesSearch = !q ||
      item.item_code?.toLowerCase().includes(q) ||
      item.item_name?.toLowerCase().includes(q)
    return matchesType && matchesSearch
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Item Master</h1>
          <p className="mt-1 text-sm text-gray-500">
            {loading ? 'Loading…' : `${filtered.length} of ${items.length} items`}
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link href="/admin/items/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            + Add Item
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
          <option value="">All Material Types</option>
          {materialTypes.map((mt: any) => (
            <option key={mt.id} value={mt.id}>{mt.code} — {mt.description}</option>
          ))}
        </select>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by code or name…"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none w-64" />
        {(filterType || search) && (
          <button onClick={() => { setFilterType(''); setSearch('') }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Clear
          </button>
        )}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading items…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-4xl mb-3">📋</p>
            <p className="text-gray-500">{items.length === 0 ? 'No items have been created yet.' : 'No items match the filter.'}</p>
            {items.length === 0 && (
              <Link href="/admin/items/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
                Add your first item →
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Item Code</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Item Name</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Material Type</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Unit</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((item: any) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono font-medium text-gray-900">{item.item_code}</td>
                    <td className="px-5 py-3 text-gray-800">{item.item_name}</td>
                    <td className="px-5 py-3">
                      {item.material_types ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 text-xs">{item.material_types.code}</span>
                          <span className="text-gray-600 text-xs">{item.material_types.description}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{item.material_sizes?.size_label || item.size_label || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{item.unit || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/admin/items/${item.id}/edit`}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
