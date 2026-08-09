'use client'

import { useState } from 'react'
import Link from 'next/link'
import SearchInput from '@/components/SearchInput'
import { formatDateTime } from '@/lib/utils'

interface CustomRole {
  id: string
  role_name: string
  role_code: string
  description?: string | null
  is_active: boolean
  created_at?: string | null
}

// Extracted from the (server-component) page so a search box can filter
// client-side without turning the page's data fetch into a client fetch.
export default function RolesTable({ roles }: { roles: CustomRole[] }) {
  const [search, setSearch] = useState('')

  const filtered = roles.filter((role) => {
    const q = search.toLowerCase()
    return !q || [role.role_name, role.role_code, role.description].some((v) => v?.toLowerCase().includes(q))
  })

  return (
    <>
      <SearchInput value={search} onChange={setSearch} placeholder="Search by role name, code or description…" />

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <p className="text-sm text-gray-500">{roles.length === 0 ? 'No roles created yet.' : 'No roles match your search.'}</p>
          {roles.length === 0 && (
            <Link href="/admin/roles/new" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
              Create your first role →
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Role Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Description</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((role) => (
                <tr key={role.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{role.role_name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700">
                      {role.role_code}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{role.description || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      role.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {role.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {role.created_at ? formatDateTime(role.created_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/roles/${role.id}/edit`}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
