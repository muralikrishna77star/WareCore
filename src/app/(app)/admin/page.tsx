export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import {
  COMPANIES_QUERY,
  WAREHOUSES_QUERY,
  SUPPLIERS_QUERY,
  CUSTOMERS_QUERY,
  MATERIAL_TYPES_QUERY,
  MATERIAL_SIZES_QUERY,
  ITEM_GROUPS_QUERY,
  ITEM_MASTERS_QUERY,
  USER_PROFILES_QUERY,
  TAX_RATES_QUERY,
  CUSTOM_ROLES_QUERY,
} from '@/lib/hasura/queries'
import CollapsibleSection from './CollapsibleSection'

export default async function AdminPage() {
  // Fetch all data in parallel using Hasura GraphQL, but keep the admin page alive even when some tables are unavailable.
  const queryResults = await Promise.allSettled([
    hasuraQuery(COMPANIES_QUERY),
    hasuraQuery(WAREHOUSES_QUERY),
    hasuraQuery(SUPPLIERS_QUERY),
    hasuraQuery(CUSTOMERS_QUERY),
    hasuraQuery(MATERIAL_TYPES_QUERY),
    hasuraQuery(MATERIAL_SIZES_QUERY),
    hasuraQuery(ITEM_GROUPS_QUERY, undefined, { suppressError: true }),
    hasuraQuery(ITEM_MASTERS_QUERY, undefined, { suppressError: true }),
    hasuraQuery(TAX_RATES_QUERY, undefined, { suppressError: true }),
    hasuraQuery(USER_PROFILES_QUERY),
    hasuraQuery(CUSTOM_ROLES_QUERY, undefined, { suppressError: true }),
  ])

  const [
    companiesRes,
    warehousesRes,
    suppliersRes,
    customersRes,
    materialTypesRes,
    materialSizesRes,
    itemGroupsRes,
    itemMastersRes,
    taxRatesRes,
    usersRes,
    customRolesRes,
  ] = queryResults

  const companies =
    companiesRes.status === 'fulfilled'
      ? (companiesRes.value as any).companies ?? []
      : []
  const warehouses =
    warehousesRes.status === 'fulfilled'
      ? (warehousesRes.value as any).warehouses ?? []
      : []
  const suppliers =
    suppliersRes.status === 'fulfilled'
      ? (suppliersRes.value as any).suppliers ?? []
      : []
  const customers =
    customersRes.status === 'fulfilled'
      ? (customersRes.value as any).customers ?? []
      : []
  const materialTypes =
    materialTypesRes.status === 'fulfilled'
      ? (materialTypesRes.value as any).material_types ?? []
      : []
  const materialSizes =
    materialSizesRes.status === 'fulfilled'
      ? (materialSizesRes.value as any).material_sizes ?? []
      : []
  const itemGroups =
    itemGroupsRes.status === 'fulfilled'
      ? (itemGroupsRes.value as any).item_groups ?? []
      : []
  const itemMasters =
    itemMastersRes.status === 'fulfilled'
      ? (itemMastersRes.value as any).item_master ?? []
      : []
  const taxRates =
    taxRatesRes.status === 'fulfilled'
      ? (taxRatesRes.value as any).tax_rates ?? []
      : []
  const users =
    usersRes.status === 'fulfilled'
      ? (usersRes.value as any).user_profiles ?? []
      : []
  const customRoles =
    customRolesRes.status === 'fulfilled'
      ? (customRolesRes.value as any).custom_roles ?? []
      : []

  const formatReason = (reason: unknown) => {
    if (reason instanceof Error) return reason.message
    if (typeof reason === 'string') return reason
    try {
      return JSON.stringify(reason)
    } catch {
      return 'Unknown error'
    }
  }

  const adminWarnings: string[] = []
  if (itemGroupsRes.status === 'rejected') {
    adminWarnings.push(`Item Groups data is currently unavailable: ${formatReason(itemGroupsRes.reason)}`)
  }
  if (itemMastersRes.status === 'rejected') {
    adminWarnings.push(`Item Master data is currently unavailable: ${formatReason(itemMastersRes.reason)}`)
  }
  if (usersRes.status === 'rejected') {
    adminWarnings.push(`User data is currently unavailable: ${formatReason(usersRes.reason)}`)
  }

  const sections = [
    {
      title: 'Companies', icon: '🏢',
      addHref: '/admin/companies/new', href: '/admin/companies',
      columns: ['Name', 'Code', 'Status'],
      rows: companies.map((c: any) => [c.name, c.code, c.is_active ? '✅ Active' : '❌ Inactive']),
    },
    {
      title: 'Warehouses', icon: '🏭',
      addHref: '/admin/warehouses/new', href: '/admin/warehouses',
      columns: ['Name', 'Company', 'Status'],
      rows: warehouses.map((w: any) => [w.name, w.companies?.name || '—', w.is_active ? '✅ Active' : '❌ Inactive']),
    },
    {
      title: 'Suppliers', icon: '🏪',
      addHref: '/admin/suppliers/new', href: '/admin/suppliers',
      columns: ['Name', 'Contact', 'GST'],
      rows: suppliers.map((s: any) => [s.name, s.contact_person || '—', s.gstin || '—']),
    },
    {
      title: 'Customers', icon: '👥',
      addHref: '/admin/customers/new', href: '/admin/customers',
      columns: ['Name', 'Contact', 'GST'],
      rows: customers.map((c: any) => [c.name, c.contact_person || '—', c.gstin || '—']),
    },
    {
      title: 'Material Types', icon: '📦',
      addHref: '/admin/materials/new', href: '/admin/materials',
      columns: ['Name', 'Unit', 'Description'],
      rows: materialTypes.map((m: any) => [m.name, m.unit, m.description || '—']),
    },
    {
      title: 'Material Sizes', icon: '📐',
      addHref: '/admin/sizes/new', href: '/admin/sizes',
      columns: ['Label', 'Thickness', 'Width'],
      rows: materialSizes.map((s: any) => [s.size_label, s.thickness?.toString() || '—', s.width?.toString() || '—']),
    },
    {
      title: 'Item Groups', icon: '🧭',
      addHref: '/admin/item-groups/new', href: '/admin/item-groups',
      columns: ['Code', 'Description', 'Status'],
      rows: itemGroups.map((g: any) => [g.group_code, g.group_desc || '—', g.is_active ? 'Active' : 'Inactive']),
    },
    {
      title: 'Item Master', icon: '📋',
      addHref: '/admin/items/new', href: '/admin/items',
      columns: ['Code', 'Name', 'Group'],
      rows: itemMasters.map((item: any) => [item.item_code, item.item_name, item.item_groups?.group_code || '—']),
    },
    {
      title: 'Tax Rates', icon: '🧾',
      addHref: '/admin/tax-rates/new', href: '/admin/tax-rates',
      columns: ['Name', 'CGST%', 'SGST%', 'TDS%', 'TCS%', 'Applies To'],
      rows: taxRates.map((t: any) => [
        t.name,
        `${Number(t.cgst_rate).toFixed(2)}%`,
        `${Number(t.sgst_rate).toFixed(2)}%`,
        Number(t.tds_rate) > 0 ? `${Number(t.tds_rate).toFixed(2)}%` : '—',
        Number(t.tcs_rate) > 0 ? `${Number(t.tcs_rate).toFixed(2)}%` : '—',
        t.applicable_to === 'BOTH' ? 'Both' : t.applicable_to,
      ]),
    },
    {
      title: 'Users', icon: '👤',
      addHref: '/admin/users/new', href: '/admin/users',
      columns: ['Name', 'Role', 'Company'],
      rows: users.map((u: any) => [u.full_name || '—', u.role?.replace(/_/g, ' ') || '—', u.companies?.name || 'All']),
    },
    {
      title: 'Roles & Permissions', icon: '🔐',
      addHref: '/admin/roles/new', href: '/admin/roles',
      columns: ['Role Name', 'Code', 'Status'],
      rows: customRoles.map((r: any) => [r.role_name, r.role_code, r.is_active ? '✅ Active' : '❌ Inactive']),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
        <p className="mt-1 text-sm text-gray-500">Manage master data and system settings</p>
      </div>

      {adminWarnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <details className="group">
            <summary className="cursor-pointer font-semibold list-none marker:hidden">
              Partial data loaded — click to view details
            </summary>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900 group-open:mt-3">
              {adminWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map((s) => (
          <CollapsibleSection
            key={s.title}
            title={s.title}
            icon={s.icon}
            addHref={s.addHref}
            href={s.href}
            columns={s.columns}
            rows={s.rows}
          />
        ))}
      </div>
    </div>
  )
}
