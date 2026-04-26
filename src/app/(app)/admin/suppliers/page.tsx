export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { SUPPLIERS_LIST_QUERY } from '@/lib/hasura/queries'

export default async function SuppliersPage() {
  const result = await hasuraQuery(SUPPLIERS_LIST_QUERY).catch(() => ({ suppliers: [] }))
  const suppliers = (result as any).suppliers ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers / Vendors</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your supplier master</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link
            href="/admin/suppliers/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add Supplier
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        {suppliers.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-4xl mb-3">🏪</p>
            <p className="text-gray-500">No suppliers added yet.</p>
            <Link href="/admin/suppliers/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
              Add your first supplier →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Contact</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">City / State</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">GSTIN</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {suppliers.map((s: any) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-5 py-3 text-gray-600">{s.contact_person || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{s.phone || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {[s.city, s.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 font-mono text-xs">{s.gstin || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                      }`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
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
