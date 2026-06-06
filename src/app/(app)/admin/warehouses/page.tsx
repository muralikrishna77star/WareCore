'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { WAREHOUSES_QUERY, ACTIVE_COMPANIES_QUERY, UPDATE_WAREHOUSE_MUTATION, DELETE_WAREHOUSE_MUTATION } from '@/lib/hasura/queries'

type Warehouse = { id: string; name: string; company_id?: string; address?: string; city?: string; state?: string; is_active: boolean; companies?: { id: string; name: string } }
type Company = { id: string; name: string }

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Warehouse | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Merge state
  const [mergeSource, setMergeSource] = useState<Warehouse | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState('')

  const load = () => Promise.all([
    hasuraFetch(WAREHOUSES_QUERY),
    hasuraFetch(ACTIVE_COMPANIES_QUERY),
  ]).then(([wr, cr]) => {
    setWarehouses((wr.data as any)?.warehouses ?? [])
    setCompanies((cr.data as any)?.companies ?? [])
    setLoading(false)
  })
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing) return
    setSaving(true); setError('')
    const { error: err } = await hasuraFetch(UPDATE_WAREHOUSE_MUTATION, {
      id: editing.id, name: editing.name, company_id: editing.company_id || null,
      address: editing.address || null, city: editing.city || null, state: editing.state || null,
      is_active: editing.is_active,
    })
    if (err) { setError(err.message); setSaving(false); return }
    setEditing(null); load(); setSaving(false)
  }

  const del = async (w: Warehouse) => {
    if (!confirm(`Delete "${w.name}"? This cannot be undone.`)) return
    const { error: err } = await hasuraFetch(DELETE_WAREHOUSE_MUTATION, { id: w.id })
    if (err) { alert(err.message); return }
    load()
  }

  const f = (field: keyof Warehouse, val: string | boolean) => setEditing(e => e ? { ...e, [field]: val } : e)

  const doMerge = async () => {
    if (!mergeSource || !mergeTargetId) return
    const target = warehouses.find(w => w.id === mergeTargetId)
    if (!confirm(`Merge "${mergeSource.name}" INTO "${target?.name}"?\n\nAll stock, bills, sales, and transfers referencing "${mergeSource.name}" will be reassigned to "${target?.name}", and "${mergeSource.name}" will be deleted. This cannot be undone.`)) return
    setMerging(true); setMergeError('')
    const res = await fetch('/api/warehouses/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: mergeSource.id, targetId: mergeTargetId }),
    })
    const json = await res.json()
    setMerging(false)
    if (!res.ok || json.error) { setMergeError(json.error ?? 'Merge failed'); return }
    setMergeSource(null); setMergeTargetId(''); load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Warehouses</h1>
          <p className="mt-1 text-sm text-gray-500">{loading ? 'Loading…' : `${warehouses.length} warehouses`}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">← Admin</Link>
          <Link href="/admin/warehouses/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">+ Add Warehouse</Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        {warehouses.length === 0 && !loading ? (
          <div className="p-12 text-center"><p className="text-gray-400 text-4xl mb-3">🏭</p><p className="text-gray-500">No warehouses yet.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">City / State</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {warehouses.map(w => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{w.name}</td>
                    <td className="px-5 py-3 text-gray-600">{w.companies?.name || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{[w.city, w.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${w.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {w.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing({ ...w })} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                        <button onClick={() => { setMergeSource(w); setMergeTargetId(''); setMergeError('') }} className="text-xs text-amber-600 hover:text-amber-800 font-medium">Merge</button>
                        <button onClick={() => del(w)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {mergeSource && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Merge Warehouse</h2>
            <p className="text-sm text-gray-600">
              Reassign all stock, bills, sales, and transfers from{' '}
              <span className="font-semibold text-red-700">"{mergeSource.name}"</span>{' '}
              into another warehouse, then delete it.
            </p>
            {mergeError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{mergeError}</p>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Merge INTO *</label>
              <select value={mergeTargetId} onChange={e => setMergeTargetId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">— Select target warehouse —</option>
                {warehouses.filter(w => w.id !== mergeSource.id).map(w => (
                  <option key={w.id} value={w.id}>{w.name}{w.companies ? ` (${w.companies.name})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => { setMergeSource(null); setMergeTargetId(''); setMergeError('') }}
                className="px-4 py-2 text-sm border rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={doMerge} disabled={!mergeTargetId || merging}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {merging ? 'Merging…' : 'Merge & Delete Duplicate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Edit Warehouse</h2>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input value={editing.name} onChange={e => f('name', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                <select value={editing.company_id || ''} onChange={e => f('company_id', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— None —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <input value={editing.city || ''} onChange={e => f('city', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input value={editing.state || ''} onChange={e => f('state', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="flex items-center gap-2 mt-1">
                <input type="checkbox" id="w-active" checked={editing.is_active} onChange={e => f('is_active', e.target.checked)} className="rounded" />
                <label htmlFor="w-active" className="text-sm font-medium text-gray-700">Active</label>
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
