export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import {
  Building2, Factory, Store, Users, Package, Ruler, ClipboardList, Receipt,
  User, KeyRound, CircleCheck, CircleX,
} from 'lucide-react'
import {
  COMPANIES_QUERY,
  WAREHOUSES_QUERY,
  SUPPLIERS_QUERY,
  CUSTOMERS_QUERY,
  MATERIAL_TYPES_QUERY,
  MATERIAL_SIZES_QUERY,
  ITEM_MASTERS_QUERY,
  USER_PROFILES_QUERY,
  TAX_RATES_QUERY,
  CUSTOM_ROLES_QUERY,
} from '@/lib/hasura/queries'
import CollapsibleSection from './CollapsibleSection'

interface CompanyRow { name: string; code: string; is_active: boolean }
interface WarehouseRow { name: string; is_active: boolean; companies?: { name: string } }
interface SupplierRow { name: string; contact_person?: string; gstin?: string }
interface CustomerRow { name: string; contact_person?: string; gstin?: string }
interface MaterialTypeRow { code: string; description: string; unit: string }
interface MaterialSizeRow { size_label: string; thickness?: number | null; width?: number | null }
interface ItemMasterRow { item_code: string; item_name: string; material_types?: { description: string } }
interface TaxRateRow { name: string; cgst_rate: number; sgst_rate: number; tds_rate: number; tcs_rate: number; applicable_to: string }
interface UserProfileRow { full_name?: string; role?: string; companies?: { name: string } }
interface CustomRoleRow { role_name: string; role_code: string; is_active: boolean }

export default async function AdminPage() {
  const queryResults = await Promise.allSettled([
    hasuraQuery(COMPANIES_QUERY),
    hasuraQuery(WAREHOUSES_QUERY),
    hasuraQuery(SUPPLIERS_QUERY),
    hasuraQuery(CUSTOMERS_QUERY),
    hasuraQuery(MATERIAL_TYPES_QUERY),
    hasuraQuery(MATERIAL_SIZES_QUERY),
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
    itemMastersRes,
    taxRatesRes,
    usersRes,
    customRolesRes,
  ] = queryResults

  const companies = companiesRes.status === 'fulfilled' ? (companiesRes.value as { companies: CompanyRow[] }).companies ?? [] : []
  const warehouses = warehousesRes.status === 'fulfilled' ? (warehousesRes.value as { warehouses: WarehouseRow[] }).warehouses ?? [] : []
  const suppliers = suppliersRes.status === 'fulfilled' ? (suppliersRes.value as { suppliers: SupplierRow[] }).suppliers ?? [] : []
  const customers = customersRes.status === 'fulfilled' ? (customersRes.value as { customers: CustomerRow[] }).customers ?? [] : []
  const materialTypes = materialTypesRes.status === 'fulfilled' ? (materialTypesRes.value as { material_types: MaterialTypeRow[] }).material_types ?? [] : []
  const materialSizes = materialSizesRes.status === 'fulfilled' ? (materialSizesRes.value as { material_sizes: MaterialSizeRow[] }).material_sizes ?? [] : []
  const itemMasters = itemMastersRes.status === 'fulfilled' ? (itemMastersRes.value as { item_master: ItemMasterRow[] }).item_master ?? [] : []
  const taxRates = taxRatesRes.status === 'fulfilled' ? (taxRatesRes.value as { tax_rates: TaxRateRow[] }).tax_rates ?? [] : []
  const users = usersRes.status === 'fulfilled' ? (usersRes.value as { user_profiles: UserProfileRow[] }).user_profiles ?? [] : []
  const customRoles = customRolesRes.status === 'fulfilled' ? (customRolesRes.value as { custom_roles: CustomRoleRow[] }).custom_roles ?? [] : []

  const statusBadge = (active: boolean) => (
    <span className="inline-flex items-center gap-1">
      {active ? (
        <><CircleCheck className="inline h-3.5 w-3.5 text-green-600" /> Active</>
      ) : (
        <><CircleX className="inline h-3.5 w-3.5 text-red-600" /> Inactive</>
      )}
    </span>
  )

  const formatReason = (reason: unknown) => {
    if (reason instanceof Error) return reason.message
    if (typeof reason === 'string') return reason
    try { return JSON.stringify(reason) } catch { return 'Unknown error' }
  }

  const adminWarnings: string[] = []
  if (itemMastersRes.status === 'rejected') adminWarnings.push(`Item Master data is currently unavailable: ${formatReason(itemMastersRes.reason)}`)
  if (usersRes.status === 'rejected') adminWarnings.push(`User data is currently unavailable: ${formatReason(usersRes.reason)}`)

  const sections = [
    {
      title: 'Companies', icon: <Building2 className="h-5 w-5 text-blue-600" strokeWidth={2} />, iconBg: 'bg-blue-100',
      addHref: '/admin/companies/new', href: '/admin/companies',
      columns: ['Name', 'Code', 'Status'],
      rows: companies.map((c) => [c.name, c.code, statusBadge(c.is_active)]),
    },
    {
      title: 'Warehouses', icon: <Factory className="h-5 w-5 text-orange-600" strokeWidth={2} />, iconBg: 'bg-orange-100',
      addHref: '/admin/warehouses/new', href: '/admin/warehouses',
      columns: ['Name', 'Company', 'Status'],
      rows: warehouses.map((w) => [w.name, w.companies?.name || '—', statusBadge(w.is_active)]),
    },
    {
      title: 'Suppliers', icon: <Store className="h-5 w-5 text-purple-600" strokeWidth={2} />, iconBg: 'bg-purple-100',
      addHref: '/admin/suppliers/new', href: '/admin/suppliers',
      columns: ['Name', 'Contact', 'GST'],
      rows: suppliers.map((s) => [s.name, s.contact_person || '—', s.gstin || '—']),
    },
    {
      title: 'Customers', icon: <Users className="h-5 w-5 text-teal-600" strokeWidth={2} />, iconBg: 'bg-teal-100',
      addHref: '/admin/customers/new', href: '/admin/customers',
      columns: ['Name', 'Contact', 'GST'],
      rows: customers.map((c) => [c.name, c.contact_person || '—', c.gstin || '—']),
    },
    {
      title: 'Material Types', icon: <Package className="h-5 w-5 text-green-600" strokeWidth={2} />, iconBg: 'bg-green-100',
      addHref: '/admin/materials/new', href: '/admin/materials',
      columns: ['Code', 'Name', 'Unit'],
      rows: materialTypes.map((m) => [m.code, m.description, m.unit]),
    },
    {
      title: 'Material Sizes', icon: <Ruler className="h-5 w-5 text-cyan-600" strokeWidth={2} />, iconBg: 'bg-cyan-100',
      addHref: '/admin/sizes/new', href: '/admin/sizes',
      columns: ['Label', 'Thickness', 'Width'],
      rows: materialSizes.map((s) => [s.size_label, s.thickness?.toString() || '—', s.width?.toString() || '—']),
    },
    {
      title: 'Item Master', icon: <ClipboardList className="h-5 w-5 text-indigo-600" strokeWidth={2} />, iconBg: 'bg-indigo-100',
      addHref: '/admin/items/new', href: '/admin/items',
      columns: ['Code', 'Name', 'Material Type'],
      rows: itemMasters.map((item) => [item.item_code, item.item_name, item.material_types?.description || '—']),
    },
    {
      title: 'Tax Rates', icon: <Receipt className="h-5 w-5 text-amber-600" strokeWidth={2} />, iconBg: 'bg-amber-100',
      addHref: '/admin/tax-rates/new', href: '/admin/tax-rates',
      columns: ['Name', 'CGST%', 'SGST%', 'TDS%', 'TCS%', 'Applies To'],
      rows: taxRates.map((t) => [
        t.name,
        `${Number(t.cgst_rate).toFixed(2)}%`,
        `${Number(t.sgst_rate).toFixed(2)}%`,
        Number(t.tds_rate) > 0 ? `${Number(t.tds_rate).toFixed(2)}%` : '—',
        Number(t.tcs_rate) > 0 ? `${Number(t.tcs_rate).toFixed(2)}%` : '—',
        t.applicable_to === 'BOTH' ? 'Both' : t.applicable_to,
      ]),
    },
    {
      title: 'Users', icon: <User className="h-5 w-5 text-pink-600" strokeWidth={2} />, iconBg: 'bg-pink-100',
      addHref: '/admin/users/new', href: '/admin/users',
      columns: ['Name', 'Role', 'Company'],
      rows: users.map((u) => [u.full_name || '—', u.role?.replace(/_/g, ' ') || '—', u.companies?.name || 'All']),
    },
    {
      title: 'Roles & Permissions', icon: <KeyRound className="h-5 w-5 text-red-600" strokeWidth={2} />, iconBg: 'bg-red-100',
      addHref: '/admin/roles/new', href: '/admin/roles',
      columns: ['Role Name', 'Code', 'Status'],
      rows: customRoles.map((r) => [r.role_name, r.role_code, statusBadge(r.is_active)]),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
        <p className="mt-1 text-sm text-gray-500">Manage master data and system settings</p>
      </div>

      {adminWarnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <details className="group">
            <summary className="cursor-pointer font-semibold list-none marker:hidden">
              Partial data loaded — click to view details
            </summary>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900 group-open:mt-3">
              {adminWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </details>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sections.map((s) => (
          <CollapsibleSection key={s.title} title={s.title} icon={s.icon} iconBg={s.iconBg}
            addHref={s.addHref} href={s.href} columns={s.columns} rows={s.rows} />
        ))}
      </div>
    </div>
  )
}
