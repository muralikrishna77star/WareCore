'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { CREATE_CUSTOM_ROLE_MUTATION, INSERT_ROLE_PERMISSIONS_MUTATION } from '@/lib/hasura/queries'
import { SCREEN_GROUPS, ALL_SCREENS, initialPermissions } from '@/lib/screens'

type PermState = Record<string, { can_read: boolean; can_write: boolean }>

function toCode(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

export default function NewRolePage() {
  const router = useRouter()

  const [roleName, setRoleName] = useState('')
  const [roleCode, setRoleCode] = useState('')
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [perms, setPerms] = useState<PermState>(initialPermissions)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-generate code from name unless user has manually edited it
  useEffect(() => {
    if (!codeManuallyEdited) setRoleCode(toCode(roleName))
  }, [roleName, codeManuallyEdited])

  // ── Per-cell toggle ───────────────────────────────────────────────────────
  const toggleRead = (code: string) =>
    setPerms(p => ({ ...p, [code]: { ...p[code], can_read: !p[code].can_read } }))

  const toggleWrite = (code: string) =>
    setPerms(p => ({ ...p, [code]: { ...p[code], can_write: !p[code].can_write } }))

  const toggleReadWrite = (code: string) =>
    setPerms(p => {
      const both = p[code].can_read && p[code].can_write
      return { ...p, [code]: { can_read: !both, can_write: !both } }
    })

  // ── Group-level bulk actions ──────────────────────────────────────────────
  const setGroupPerm = (
    codes: string[],
    patch: { can_read?: boolean; can_write?: boolean }
  ) =>
    setPerms(p => {
      const next = { ...p }
      for (const c of codes) next[c] = { ...next[c], ...patch }
      return next
    })

  // ── Select-all row (top of table) ─────────────────────────────────────────
  const allRead  = ALL_SCREENS.every(s => perms[s.code]?.can_read)
  const allWrite = ALL_SCREENS.every(s => perms[s.code]?.can_write)

  const toggleAllRead  = () => setPerms(p => { const n={...p}; for(const s of ALL_SCREENS) n[s.code]={...n[s.code], can_read:!allRead}; return n })
  const toggleAllWrite = () => setPerms(p => { const n={...p}; for(const s of ALL_SCREENS) n[s.code]={...n[s.code], can_write:!allWrite}; return n })
  const toggleAllRW    = () => {
    const allRW = allRead && allWrite
    setPerms(p => { const n={...p}; for(const s of ALL_SCREENS) n[s.code]={can_read:!allRW, can_write:!allRW}; return n })
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!roleName.trim()) { setError('Role name is required.'); return }
    if (!roleCode.trim()) { setError('Role code is required.'); return }

    setLoading(true)

    // 1. Create the role
    const { data: roleData, error: roleErr } = await hasuraFetch<any>(CREATE_CUSTOM_ROLE_MUTATION, {
      role_name: roleName.trim(),
      role_code: roleCode.trim(),
      description: description.trim() || null,
    })
    if (roleErr || !roleData?.insert_custom_roles_one) {
      setError(roleErr?.message ?? 'Failed to create role.')
      setLoading(false)
      return
    }
    const roleId = roleData.insert_custom_roles_one.id

    // 2. Bulk-insert all screen permissions
    const objects = ALL_SCREENS.map(s => ({
      role_id: roleId,
      screen_code: s.code,
      can_read: perms[s.code]?.can_read ?? false,
      can_write: perms[s.code]?.can_write ?? false,
    }))
    const { error: permErr } = await hasuraFetch(INSERT_ROLE_PERMISSIONS_MUTATION, { objects })
    if (permErr) {
      setError(`Role created but permissions failed: ${permErr.message}`)
      setLoading(false)
      return
    }

    router.push('/admin/roles')
    router.refresh()
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Role</h1>
        <p className="mt-1 text-sm text-gray-500">Define a role and configure per-screen access permissions</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Role details ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Role Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="e.g. Store Manager"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role Code <span className="text-red-500">*</span>
                <span className="ml-1 text-xs font-normal text-gray-400">(auto-generated)</span>
              </label>
              <input
                type="text"
                value={roleCode}
                onChange={(e) => { setCodeManuallyEdited(true); setRoleCode(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')) }}
                placeholder="e.g. store_manager"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* ── Permissions ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Screen Permissions</h2>
              <p className="text-xs text-gray-500 mt-0.5">Set Read and/or Write access for each screen</p>
            </div>
            {/* Global quick-set */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Select all:</span>
              <button type="button" onClick={toggleAllRead}
                className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${allRead ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                Read
              </button>
              <button type="button" onClick={toggleAllWrite}
                className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${allWrite ? 'bg-purple-600 text-white border-purple-600' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                Write
              </button>
              <button type="button" onClick={toggleAllRW}
                className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${allRead && allWrite ? 'bg-green-600 text-white border-green-600' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                R+W
              </button>
            </div>
          </div>

          {SCREEN_GROUPS.map((group) => {
            const codes = group.screens.map(s => s.code)
            const gRead  = codes.every(c => perms[c]?.can_read)
            const gWrite = codes.every(c => perms[c]?.can_write)
            const gRW    = gRead && gWrite

            return (
              <div key={group.group} className="border-b last:border-b-0">
                {/* Group header */}
                <div className="bg-gray-50 px-6 py-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    {group.icon} {group.group}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 mr-1">All:</span>
                    <button type="button"
                      onClick={() => setGroupPerm(codes, { can_read: !gRead })}
                      className={`rounded px-2 py-0.5 text-[10px] font-medium border transition-colors ${gRead ? 'bg-blue-500 text-white border-blue-500' : 'text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                      Read
                    </button>
                    <button type="button"
                      onClick={() => setGroupPerm(codes, { can_write: !gWrite })}
                      className={`rounded px-2 py-0.5 text-[10px] font-medium border transition-colors ${gWrite ? 'bg-purple-500 text-white border-purple-500' : 'text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                      Write
                    </button>
                    <button type="button"
                      onClick={() => setGroupPerm(codes, { can_read: !gRW, can_write: !gRW })}
                      className={`rounded px-2 py-0.5 text-[10px] font-medium border transition-colors ${gRW ? 'bg-green-500 text-white border-green-500' : 'text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                      R+W
                    </button>
                    <button type="button"
                      onClick={() => setGroupPerm(codes, { can_read: false, can_write: false })}
                      className="rounded px-2 py-0.5 text-[10px] font-medium border text-gray-500 border-gray-200 hover:bg-gray-100 transition-colors">
                      Clear
                    </button>
                  </div>
                </div>

                {/* Screen rows */}
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-white">
                      <th className="px-6 py-2 text-left text-xs font-medium text-gray-400 w-1/2">Screen</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-blue-500">Read</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-purple-500">Write</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-green-600">Read + Write</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {group.screens.map((screen) => {
                      const p = perms[screen.code] ?? { can_read: false, can_write: false }
                      const isRW = p.can_read && p.can_write

                      return (
                        <tr key={screen.code} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-2.5">
                            <span className="text-sm text-gray-800">{screen.label}</span>
                            <span className="ml-2 text-[10px] font-mono text-gray-400">{screen.code}</span>
                          </td>
                          {/* Read */}
                          <td className="px-4 py-2.5 text-center">
                            <label className="inline-flex items-center justify-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={p.can_read}
                                onChange={() => toggleRead(screen.code)}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                            </label>
                          </td>
                          {/* Write */}
                          <td className="px-4 py-2.5 text-center">
                            <label className="inline-flex items-center justify-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={p.can_write}
                                onChange={() => toggleWrite(screen.code)}
                                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                              />
                            </label>
                          </td>
                          {/* Read+Write */}
                          <td className="px-4 py-2.5 text-center">
                            <label className="inline-flex items-center justify-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isRW}
                                onChange={() => toggleReadWrite(screen.code)}
                                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                              />
                            </label>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}

          {/* Summary row */}
          <div className="px-6 py-3 bg-gray-50 border-t flex items-center gap-6 text-xs text-gray-500">
            <span>
              <span className="font-medium text-blue-600">{ALL_SCREENS.filter(s => perms[s.code]?.can_read).length}</span> screens with Read
            </span>
            <span>
              <span className="font-medium text-purple-600">{ALL_SCREENS.filter(s => perms[s.code]?.can_write).length}</span> screens with Write
            </span>
            <span>
              <span className="font-medium text-green-600">{ALL_SCREENS.filter(s => perms[s.code]?.can_read && perms[s.code]?.can_write).length}</span> screens with Full Access
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Saving...' : '✓ Save Role'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
