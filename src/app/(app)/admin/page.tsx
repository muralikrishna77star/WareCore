import { hasuraQuery } from '@/lib/hasura/server'
import {
  COMPANIES_QUERY,
  WAREHOUSES_QUERY,
  SUPPLIERS_QUERY,
  CUSTOMERS_QUERY,
  MATERIAL_TYPES_QUERY,
  MATERIAL_SIZES_QUERY,
  USER_PROFILES_QUERY,
} from '@/lib/hasura/queries'
import Link from 'next/link'

export default async function AdminPage() {
  // Fetch all data in parallel using Hasura GraphQL
  const [companiesRes, warehousesRes, suppliersRes, customersRes, materialTypesRes, materialSizesRes, usersRes] =
    await Promise.all([
      hasuraQuery(COMPANIES_QUERY).catch(() => ({ companies: [] })),
      hasuraQuery(WAREHOUSES_QUERY).catch(() => ({ warehouses: [] })),
      hasuraQuery(SUPPLIERS_QUERY).catch(() => ({ suppliers: [] })),
      hasuraQuery(CUSTOMERS_QUERY).catch(() => ({ customers: [] })),
      hasuraQuery(MATERIAL_TYPES_QUERY).catch(() => ({ material_types: [] })),
      hasuraQuery(MATERIAL_SIZES_QUERY).catch(() => ({ material_sizes: [] })),
      hasuraQuery(USER_PROFILES_QUERY).catch(() => ({ user_profiles: [] })),
    ])

  const companies = (companiesRes as any).companies ?? []
  const warehouses = (warehousesRes as any).warehouses ?? []
  const suppliers = (suppliersRes as any).suppliers ?? []
  const customers = (customersRes as any).customers ?? []
  const materialTypes = (materialTypesRes as any).material_types ?? []
  const materialSizes = (materialSizesRes as any).material_sizes ?? []
  const users = (usersRes as any).user_profiles ?? []

  const sections = [
    { title: 'Companies', data: companies, count: companies.length, icon: '🏢', href: '/admin/companies' },
    { title: 'Warehouses', data: warehouses, count: warehouses.length, icon: '🏭', href: '/admin/warehouses' },
    { title: 'Suppliers / Vendors', data: suppliers, count: suppliers.length, icon: '🏪', href: '/admin/suppliers' },
    { title: 'Customers', data: customers, count: customers.length, icon: '👥', href: '/admin/customers' },
    { title: 'Material Types', data: materialTypes, count: materialTypes.length, icon: '📦', href: '/admin/materials' },
    { title: 'Material Sizes', data: materialSizes, count: materialSizes.length, icon: '📐', href: '/admin/sizes' },
    { title: 'Users', data: users, count: users.length, icon: '👤', href: '/admin/users' },
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
          rows={companies.map((c: any) => [c.name, c.code, c.is_active ? '✅ Active' : '❌ Inactive'])}
        />

        {/* Warehouses */}
        <MasterTable
          title="Warehouses"
          icon="🏭"
          addHref="/admin/warehouses/new"
          columns={['Name', 'Company', 'Status']}
          rows={warehouses.map((w: any) => [w.name, w.companies?.name || '—', w.is_active ? '✅ Active' : '❌ Inactive'])}
        />

        {/* Suppliers */}
        <MasterTable
          title="Suppliers / Vendors"
          icon="🏪"
          addHref="/admin/suppliers/new"
          columns={['Name', 'Contact', 'GST']}
          rows={suppliers.map((s: any) => [s.name, s.contact_person || '—', s.gstin || '—'])}
        />

        {/* Customers */}
        <MasterTable
          title="Customers"
          icon="👥"
          addHref="/admin/customers/new"
          columns={['Name', 'Contact', 'GST']}
          rows={customers.map((c: any) => [c.name, c.contact_person || '—', c.gstin || '—'])}
        />

        {/* Material Types */}
        <MasterTable
          title="Material Types"
          icon="📦"
          addHref="/admin/materials/new"
          columns={['Name', 'Unit', 'Description']}
          rows={materialTypes.map((m: any) => [m.name, m.unit, m.description || '—'])}
        />

        {/* Material Sizes */}
        <MasterTable
          title="Material Sizes"
          icon="📐"
          addHref="/admin/sizes/new"
          columns={['Label', 'Thickness', 'Width']}
          rows={materialSizes.map((s: any) => [s.size_label, s.thickness?.toString() || '—', s.width?.toString() || '—'])}
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
              {users.length === 0 ? (
                <tr><td colSpan={3} className="px-6 py-4 text-gray-500 text-center">No users yet.</td></tr>
              ) : (
                users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{u.full_name || '—'}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800 capitalize">
                        {u.role?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{u.companies?.name || 'All Companies'}</td>
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
