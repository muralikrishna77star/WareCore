import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function AdminPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const [companies, warehouses, suppliers, customers, materialTypes, materialSizes, users] = await Promise.all([
    supabase.from('companies').select('*').order('name'),
    supabase.from('warehouses').select('*, companies(name)').order('name'),
    supabase.from('suppliers').select('*').order('name'),
    supabase.from('customers').select('*').order('name'),
    supabase.from('material_types').select('*').order('name'),
    supabase.from('material_sizes').select('*, material_types(name)').order('size_label'),
    supabase.from('user_profiles').select('*, companies(name)').order('full_name'),
  ])

  const sections = [
    { title: 'Companies', data: companies.data ?? [], count: (companies.data ?? []).length, icon: '🏢', href: '/admin/companies' },
    { title: 'Warehouses', data: warehouses.data ?? [], count: (warehouses.data ?? []).length, icon: '🏭', href: '/admin/warehouses' },
    { title: 'Suppliers / Vendors', data: suppliers.data ?? [], count: (suppliers.data ?? []).length, icon: '🏪', href: '/admin/suppliers' },
    { title: 'Customers', data: customers.data ?? [], count: (customers.data ?? []).length, icon: '👥', href: '/admin/customers' },
    { title: 'Material Types', data: materialTypes.data ?? [], count: (materialTypes.data ?? []).length, icon: '📦', href: '/admin/materials' },
    { title: 'Material Sizes', data: materialSizes.data ?? [], count: (materialSizes.data ?? []).length, icon: '📐', href: '/admin/sizes' },
    { title: 'Users', data: users.data ?? [], count: (users.data ?? []).length, icon: '👤', href: '/admin/users' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
        <p className="mt-1 text-sm text-gray-500">Manage master data and system settings</p>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {sections.slice(0, 4).map((s) => (
          <div key={s.title} className="rounded-xl border bg-white p-5">
            <span className="text-2xl">{s.icon}</span>
            <p className="mt-2 text-2xl font-bold text-gray-900">{s.count}</p>
            <p className="text-sm text-gray-500">{s.title}</p>
          </div>
        ))}
      </div>

      {/* Master Data Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Companies */}
        <MasterTable
          title="Companies"
          icon="🏢"
          addHref="/admin/companies/new"
          columns={['Name', 'Code', 'Status']}
          rows={(companies.data ?? []).map((c) => [c.name, c.code, c.is_active ? '✅ Active' : '❌ Inactive'])}
        />

        {/* Warehouses */}
        <MasterTable
          title="Warehouses"
          icon="🏭"
          addHref="/admin/warehouses/new"
          columns={['Name', 'Company', 'Status']}
          rows={(warehouses.data ?? []).map((w) => [w.name, (w.companies as { name: string } | null)?.name || '—', w.is_active ? '✅ Active' : '❌ Inactive'])}
        />

        {/* Suppliers */}
        <MasterTable
          title="Suppliers / Vendors"
          icon="🏪"
          addHref="/admin/suppliers/new"
          columns={['Name', 'Contact', 'GST']}
          rows={(suppliers.data ?? []).map((s) => [s.name, s.contact_person || '—', s.gstin || '—'])}
        />

        {/* Customers */}
        <MasterTable
          title="Customers"
          icon="👥"
          addHref="/admin/customers/new"
          columns={['Name', 'Contact', 'GST']}
          rows={(customers.data ?? []).map((c) => [c.name, c.contact_person || '—', c.gstin || '—'])}
        />

        {/* Material Types */}
        <MasterTable
          title="Material Types"
          icon="📦"
          addHref="/admin/materials/new"
          columns={['Name', 'Unit', 'Description']}
          rows={(materialTypes.data ?? []).map((m) => [m.name, m.unit, m.description || '—'])}
        />

        {/* Material Sizes */}
        <MasterTable
          title="Material Sizes"
          icon="📐"
          addHref="/admin/sizes/new"
          columns={['Label', 'Thickness', 'Width']}
          rows={(materialSizes.data ?? []).map((s) => [s.size_label, s.thickness?.toString() || '—', s.width?.toString() || '—'])}
        />

      </div>

      {/* Users */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">👤 Users</h2>
          <Link href="/admin/users/new" className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add User</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Name</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Role</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Company</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(users.data ?? []).length === 0 ? (
                <tr><td colSpan={3} className="px-6 py-4 text-gray-500 text-center">No users yet.</td></tr>
              ) : (
                (users.data ?? []).map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{u.full_name || '—'}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800 capitalize">
                        {u.role?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{(u.companies as { name: string } | null)?.name || 'All Companies'}</td>
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

function MasterTable({
  title, icon, addHref, columns, rows,
}: {
  title: string
  icon: string
  addHref: string
  columns: string[]
  rows: string[][]
}) {
  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{icon} {title}</h2>
        <Link href={addHref} className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              {columns.map((c) => (
                <th key={c} className="px-4 py-2.5 text-xs font-medium text-gray-500 uppercase text-left">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-3 text-gray-400 text-center text-xs">None yet</td></tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-2.5 text-gray-700">{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
