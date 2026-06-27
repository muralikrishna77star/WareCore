'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { formatDateTime } from '@/lib/utils'

const USERS_QUERY = `
  query GetAdminUserProfiles {
    user_profiles(order_by: {full_name: asc}) {
      id full_name email role is_active created_at
      companies { id name }
      warehouses { id name }
    }
  }
`

const ROLE_LABELS: Record<string, string> = {
  developer: 'Developer',
  admin: 'Admin',
  company_manager: 'Company Manager',
  warehouse_manager: 'Warehouse Manager',
  sales_manager: 'Sales Manager',
  billing_staff: 'Billing Staff',
}

const ROLE_COLORS: Record<string, string> = {
  developer: 'bg-rose-100 text-rose-800 ring-1 ring-rose-300',
  admin: 'bg-purple-100 text-purple-800',
  company_manager: 'bg-blue-100 text-blue-800',
  warehouse_manager: 'bg-cyan-100 text-cyan-800',
  sales_manager: 'bg-green-100 text-green-800',
  billing_staff: 'bg-orange-100 text-orange-800',
}

type User = {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  companies?: { id: string; name: string } | null
  warehouses?: { id: string; name: string } | null
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    setLoading(true)
    const { data, error: err } = await hasuraFetch(USERS_QUERY)
    if (err) { setError(err.message); setLoading(false); return }
    setUsers((data as any)?.user_profiles ?? [])
    setLoading(false)
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/auth/delete-user?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Failed to delete user')
      } else {
        setUsers(prev => prev.filter(u => u.id !== id))
      }
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  const filtered = users.filter(u =>
    !search ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.role?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="mt-1 text-sm text-gray-500">
            {loading ? 'Loading…' : `${users.length} user${users.length !== 1 ? 's' : ''} total`}
          </p>
        </div>
        <Link href="/admin/users/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
          + New User
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search by name, email or role…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Email</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Company</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Warehouse</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Joined</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">Loading users…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                  {search ? 'No users match your search.' : 'No users found.'}
                </td>
              </tr>
            ) : filtered.map(user => (
              <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {user.full_name || <span className="text-gray-400 italic">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{user.email}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-700'}`}>
                    {ROLE_LABELS[user.role] ?? user.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{user.companies?.name ?? <span className="text-gray-400">All</span>}</td>
                <td className="px-4 py-3 text-gray-600">{user.warehouses?.name ?? <span className="text-gray-400">—</span>}</td>
                <td className="px-4 py-3">
                  {user.is_active
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block"/>Active</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500"><span className="h-1.5 w-1.5 rounded-full bg-gray-400 inline-block"/>Inactive</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {user.created_at ? formatDateTime(user.created_at) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setConfirmId(user.id)}
                    disabled={deletingId === user.id}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors">
                    {deletingId === user.id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-right">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Admin</Link>
      </div>

      {/* Confirm Delete Dialog */}
      {confirmId && (() => {
        const user = users.find(u => u.id === confirmId)
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-sm w-full p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                  <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </div>
                <h2 className="text-base font-semibold text-gray-900">Delete User</h2>
              </div>
              <p className="text-sm text-gray-600">
                Are you sure you want to delete <span className="font-semibold">{user?.full_name || user?.email}</span>?
                This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end pt-1">
                <button onClick={() => setConfirmId(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(confirmId)}
                  disabled={deletingId === confirmId}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                  {deletingId === confirmId ? 'Deleting…' : 'Yes, Delete'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
