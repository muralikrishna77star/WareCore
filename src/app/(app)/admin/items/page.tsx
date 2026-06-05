export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { ITEM_MASTERS_QUERY } from '@/lib/hasura/queries'

export default async function ItemMastersPage() {
  const result = await hasuraQuery(ITEM_MASTERS_QUERY).catch(() => ({ item_master: [] }))
  const items = (result as any).item_master ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Item Master</h1>
          <p className="mt-1 text-sm text-gray-500">Manage item master data and assigned group codes.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link
            href="/admin/items/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add Item
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        {items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-4xl mb-3">📋</p>
            <p className="text-gray-500">No items have been created yet.</p>
            <Link href="/admin/items/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
              Add your first item →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Group</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Material Type</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item: any) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{item.item_code}</td>
                    <td className="px-5 py-3 text-gray-600">{item.item_name}</td>
                    <td className="px-5 py-3 text-gray-600">{item.material_types?.code || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{item.material_types?.description || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{item.material_sizes?.size_label || item.size_label || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {item.is_active ? 'Active' : 'Inactive'}
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
