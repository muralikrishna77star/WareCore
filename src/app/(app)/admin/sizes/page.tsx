export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { MATERIAL_SIZES_QUERY } from '@/lib/hasura/queries'
import Link from 'next/link'

export default async function SizesPage() {
  const res = await hasuraQuery(MATERIAL_SIZES_QUERY).catch(() => ({ material_sizes: [] }))
  const sizes = (res as any).material_sizes ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Material Sizes</h1>
          <p className="mt-1 text-sm text-gray-500">{sizes.length} size{sizes.length !== 1 ? 's' : ''} configured</p>
        </div>
        <Link
          href="/admin/sizes/new"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          + Add Size
        </Link>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sizes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                    No sizes yet.{' '}
                    <Link href="/admin/sizes/new" className="text-blue-600 hover:underline">
                      Add the first size
                    </Link>
                  </td>
                </tr>
              ) : (
                sizes.map((s: any) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{s.size_label}</td>
                    <td className="px-6 py-3 text-gray-600">{s.material_types?.description ?? '—'}</td>
                    <td className="px-6 py-3 text-gray-600">{s.thickness ?? '—'}</td>
                    <td className="px-6 py-3 text-gray-600">{s.width ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        s.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
