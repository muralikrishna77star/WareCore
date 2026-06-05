'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { MATERIAL_SIZES_QUERY, ACTIVE_MATERIAL_TYPES_QUERY, UPDATE_MATERIAL_SIZE_MUTATION, DELETE_MATERIAL_SIZE_MUTATION } from '@/lib/hasura/queries'

type Size = { id: string; size_label: string; material_type_id: string; thickness?: number | null; width?: number | null; is_active: boolean; material_types?: { code: string; description: string } }
type MT = { id: string; code: string; description: string }

export default function SizesPage() {
  const [sizes, setSizes] = useState<Size[]>([])
  const [mts, setMts] = useState<MT[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Size | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => Promise.all([hasuraFetch(MATERIAL_SIZES_QUERY), hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY)]).then(([sr, mr]) => {
    setSizes((sr.data as any)?.material_sizes ?? [])
    setMts((mr.data as any)?.material_types ?? [])
    setLoading(false)
  })
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing) return
    setSaving(true); setError('')
    const { error: err } = await hasuraFetch(UPDATE_MATERIAL_SIZE_MUTATION, {
      id: editing.id, size_label: editing.size_label, material_type_id: editing.material_type_id,
      thickness: editing.thickness || null, width: editing.width || null, is_active: editing.is_active,
    })
    if (err) { setError(err.message); setSaving(false); return }
    setEditing(null); load(); setSaving(false)
  }

  const del = async (s: Size) => {
    if (!confirm(`Delete size "${s.size_label}"? This cannot be undone.`)) return
    const { error: err } = await hasuraFetch(DELETE_MATERIAL_SIZE_MUTATION, { id: s.id })
    if (err) { alert(err.message); return }
    load()
  }

  const f = (field: keyof Size, val: any) => setEditing(e => e ? { ...e, [field]: val } : e)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Material Sizes</h1>
          <p className="mt-1 text-sm text-gray-500">{loading ? 'Loading…' : `${sizes.length} sizes`}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">← Admin</Link>
          <Link href="/admin/sizes/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">+ Add Size</Link>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Size Label</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Material Type</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Thickness</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Width</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Status</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sizes.length === 0 && !loading ? (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">No sizes yet. <Link href="/admin/sizes/new" className="text-blue-600 hover:underline">Add the first size</Link></td></tr>
              ) : (
                sizes.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{s.size_label}</td>
                    <td className="px-6 py-3 text-gray-600">
                      {s.material_types ? <span className="inline-flex items-center gap-1"><span className="font-mono text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1">{s.material_types.code}</span>{s.material_types.description}</span> : '—'}
                    </td>
                    <td className="px-6 py-3 text-gray-600">{s.thickness ?? '—'}</td>
                    <td className="px-6 py-3 text-gray-600">{s.width ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing({ ...s })} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                        <button onClick={() => del(s)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Edit Size</h2>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Size Label *</label>
                <input value={editing.size_label} onChange={e => f('size_label', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Material Type *</label>
                <select value={editing.material_type_id} onChange={e => f('material_type_id', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select —</option>
                  {mts.map(m => <option key={m.id} value={m.id}>{m.code} — {m.description}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Thickness</label>
                <input type="number" step="0.01" value={editing.thickness ?? ''} onChange={e => f('thickness', e.target.value ? parseFloat(e.target.value) : null)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Width</label>
                <input type="number" step="0.01" value={editing.width ?? ''} onChange={e => f('width', e.target.value ? parseFloat(e.target.value) : null)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="flex items-center gap-2 mt-1">
                <input type="checkbox" id="sz-active" checked={editing.is_active} onChange={e => f('is_active', e.target.checked)} className="rounded" />
                <label htmlFor="sz-active" className="text-sm font-medium text-gray-700">Active</label>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => { setEditing(null); setError('') }} className="px-4 py-2 text-sm border rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
