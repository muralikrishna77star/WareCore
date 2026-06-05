'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { MATERIAL_TYPES_QUERY, UPDATE_MATERIAL_TYPE_MUTATION, DELETE_MATERIAL_TYPE_MUTATION } from '@/lib/hasura/queries'

type MaterialType = { id: string; code: string; description: string; unit: string; is_active: boolean }

const UNITS = ['tons', 'kg', 'units', 'liters', 'meters']

export default function MaterialTypesPage() {
  const [types, setTypes] = useState<MaterialType[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<MaterialType | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => hasuraFetch(MATERIAL_TYPES_QUERY).then(r => { setTypes((r.data as any)?.material_types ?? []); setLoading(false) })
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing) return
    const code = editing.code.trim().toUpperCase()
    if (code.length !== 2) { setError('Code must be exactly 2 characters.'); return }
    setSaving(true); setError('')
    const { error: err } = await hasuraFetch(UPDATE_MATERIAL_TYPE_MUTATION, { ...editing, code })
    if (err) { setError(err.message); setSaving(false); return }
    setEditing(null); load(); setSaving(false)
  }

  const del = async (t: MaterialType) => {
    if (!confirm(`Delete "${t.code} — ${t.description}"? This will fail if items are linked to this type.`)) return
    const { error: err } = await hasuraFetch(DELETE_MATERIAL_TYPE_MUTATION, { id: t.id })
    if (err) { alert(err.message); return }
    load()
  }

  const f = (field: keyof MaterialType, val: string | boolean) => setEditing(e => e ? { ...e, [field]: val } : e)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Material Types</h1>
          <p className="mt-1 text-sm text-gray-500">{loading ? 'Loading…' : `${types.length} types`}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">← Admin</Link>
          <Link href="/admin/materials/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">+ Add Type</Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        {types.length === 0 && !loading ? (
          <div className="p-12 text-center"><p className="text-gray-400 text-4xl mb-3">📦</p><p className="text-gray-500">No material types yet.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Unit</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {types.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono font-semibold text-blue-700">{t.code}</td>
                    <td className="px-5 py-3 text-gray-800">{t.description}</td>
                    <td className="px-5 py-3 text-gray-600">{t.unit}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${t.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {t.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing({ ...t })} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                        <button onClick={() => del(t)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Edit Material Type</h2>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Code * (2 chars)</label>
                <input value={editing.code} maxLength={2} onChange={e => f('code', e.target.value.toUpperCase())} className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                <select value={editing.unit} onChange={e => f('unit', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                <input value={editing.description} onChange={e => f('description', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="flex items-center gap-2 mt-1">
                <input type="checkbox" id="mt-active" checked={editing.is_active} onChange={e => f('is_active', e.target.checked)} className="rounded" />
                <label htmlFor="mt-active" className="text-sm font-medium text-gray-700">Active</label>
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
