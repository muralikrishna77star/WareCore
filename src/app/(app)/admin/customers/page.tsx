'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { CUSTOMERS_LIST_QUERY, UPDATE_CUSTOMER_MUTATION, DELETE_CUSTOMER_MUTATION } from '@/lib/hasura/queries'
import SearchInput from '@/components/SearchInput'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

type Customer = { id: string; name: string; contact_person?: string; phone?: string; email?: string; city?: string; state?: string; gstin?: string; is_active: boolean }

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase()
    return !q || [c.name, c.contact_person, c.phone, c.city, c.state, c.gstin].some((v) => v?.toLowerCase().includes(q))
  })

  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(filtered, {
    name: (c) => c.name,
    contact_person: (c) => c.contact_person || '',
    phone: (c) => c.phone || '',
    location: (c) => [c.city, c.state].filter(Boolean).join(', '),
    gstin: (c) => c.gstin || '',
    is_active: (c) => (c.is_active ? 1 : 0),
  })

  const load = () => hasuraFetch<{ customers: Customer[] }>(CUSTOMERS_LIST_QUERY).then(r => { setCustomers(r.data?.customers ?? []); setLoading(false) })
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing) return
    setSaving(true); setError('')
    const { error: err } = await hasuraFetch(UPDATE_CUSTOMER_MUTATION, { ...editing })
    if (err) { setError(err.message); setSaving(false); return }
    setEditing(null); load()
    setSaving(false)
  }

  const del = async (c: Customer) => {
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return
    const { error: err } = await hasuraFetch(DELETE_CUSTOMER_MUTATION, { id: c.id })
    if (err) { alert(err.message); return }
    load()
  }

  const f = (field: keyof Customer, val: string | boolean) => setEditing(e => e ? { ...e, [field]: val } : e)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-500">{loading ? 'Loading…' : `${customers.length} customers`}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /> Admin</Link>
          <Link href="/admin/customers/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">+ Add Customer</Link>
        </div>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search by name, contact, phone, city, state or GSTIN…" />

      <div className="rounded-xl border bg-white overflow-hidden">
        {customers.length === 0 && !loading ? (
          <div className="p-12 text-center"><Users className="mx-auto h-10 w-10 text-gray-400 mb-3" /><p className="text-gray-500">No customers yet.</p></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center"><p className="text-gray-500">No customers match your search.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <SortableTh label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-5" />
                  <SortableTh label="Contact" sortKey="contact_person" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-5" />
                  <SortableTh label="Phone" sortKey="phone" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-5" />
                  <SortableTh label="City / State" sortKey="location" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-5" />
                  <SortableTh label="GSTIN" sortKey="gstin" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-5" />
                  <SortableTh label="Status" sortKey="is_active" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-5" />
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedRows.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-5 py-3 text-gray-600">{c.contact_person || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{c.phone || '—'}</td>
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
            <h2 className="text-lg font-bold text-gray-900">Edit Customer</h2>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input value={editing.name} onChange={e => f('name', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                <input value={editing.contact_person || ''} onChange={e => f('contact_person', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input value={editing.phone || ''} onChange={e => f('phone', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <input value={editing.city || ''} onChange={e => f('city', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input value={editing.state || ''} onChange={e => f('state', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">GSTIN</label>
                <input value={editing.gstin || ''} onChange={e => f('gstin', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="flex items-center gap-2 mt-1">
                <input type="checkbox" id="c-active" checked={editing.is_active} onChange={e => f('is_active', e.target.checked)} className="rounded" />
                <label htmlFor="c-active" className="text-sm font-medium text-gray-700">Active</label>
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
