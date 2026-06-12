'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { COMPANIES_QUERY, UPDATE_COMPANY_MUTATION, DELETE_COMPANY_MUTATION } from '@/lib/hasura/queries'

type Company = { id: string; name: string; code: string; short_name?: string; address?: string; city?: string; state?: string; pincode?: string; phone?: string; email?: string; gstin?: string; is_active: boolean }

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Company | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => hasuraFetch(COMPANIES_QUERY).then(r => { setCompanies((r.data as any)?.companies ?? []); setLoading(false) })
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing) return
    setSaving(true); setError('')
    const { error: err } = await hasuraFetch(UPDATE_COMPANY_MUTATION, { ...editing })
    if (err) { setError(err.message); setSaving(false); return }
    setEditing(null); load(); setSaving(false)
  }

  const del = async (c: Company) => {
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return
    const { error: err } = await hasuraFetch(DELETE_COMPANY_MUTATION, { id: c.id })
    if (err) { alert(err.message); return }
    load()
  }

  const f = (field: keyof Company, val: string | boolean) => setEditing(e => e ? { ...e, [field]: val } : e)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
          <p className="mt-1 text-sm text-gray-500">{loading ? 'Loading…' : `${companies.length} companies`}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">← Admin</Link>
          <Link href="/admin/companies/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">+ Add Company</Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        {companies.length === 0 && !loading ? (
          <div className="p-12 text-center"><p className="text-gray-400 text-4xl mb-3">🏢</p><p className="text-gray-500">No companies yet.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Short Name</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">City / State</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">GSTIN</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {companies.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-5 py-3 font-mono text-gray-700">{c.code}</td>
                    <td className="px-5 py-3 text-gray-600">{c.short_name || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-5 py-3 text-gray-600 font-mono text-xs">{c.gstin || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing({ ...c })} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                        <button onClick={() => del(c)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
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
          <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Edit Company</h2>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input value={editing.name} onChange={e => f('name', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                <input value={editing.code} onChange={e => f('code', e.target.value.toUpperCase())} className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Short Name</label>
                <input value={editing.short_name || ''} onChange={e => f('short_name', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <input value={editing.city || ''} onChange={e => f('city', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input value={editing.state || ''} onChange={e => f('state', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input value={editing.phone || ''} onChange={e => f('phone', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">GSTIN</label>
                <input value={editing.gstin || ''} onChange={e => f('gstin', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="flex items-center gap-2 mt-1">
                <input type="checkbox" id="co-active" checked={editing.is_active} onChange={e => f('is_active', e.target.checked)} className="rounded" />
                <label htmlFor="co-active" className="text-sm font-medium text-gray-700">Active</label>
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
