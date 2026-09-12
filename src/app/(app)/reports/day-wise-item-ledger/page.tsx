export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import Link from 'next/link'
import { ArrowLeft, CalendarRange, TriangleAlert } from 'lucide-react'
import { verifySession } from '@/lib/auth/session'
import { hasuraQuery } from '@/lib/hasura/server'
import {
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_MATERIAL_SIZES_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_CUSTOMERS_QUERY,
  USER_PROFILES_QUERY,
} from '@/lib/hasura/queries'
import { defaultCreatedRange } from '@/lib/dateRange'
import { loadDayWiseItemLedger, DAY_WISE_LEDGER_LIMIT, type DayWiseFilters } from '@/lib/dayWiseItemLedgerData'
import { PrintButton } from '@/components/PrintButton'
import { DayWiseItemLedgerFilters } from './DayWiseItemLedgerFilters'
import { DayWiseItemLedgerTable } from './DayWiseItemLedgerTable'
import { DayWiseItemLedgerExport } from './DayWiseItemLedgerExport'
import { buildExportSheets, buildCriteriaLines } from './exportSpec'

/** Reports are readable by every signed-in role; this one adds no extra gate. */
type SearchParams = Record<string, string | string[] | undefined>

const asArray = (v: string | string[] | undefined): string[] =>
  v == null ? [] : Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []
const asString = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? v[0] ?? '' : v ?? ''

type ItemMasterOption = {
  id: string
  item_code: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  size_label: string | null
  unit?: string | null
}

export default async function DayWiseItemLedgerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const token = (await cookies()).get('wc_session')?.value
  const session = token ? verifySession(token) : null

  const [companiesRes, warehousesRes, itemsRes, sizesRes, suppliersRes, customersRes, usersRes] =
    await Promise.all([
      hasuraQuery(ACTIVE_COMPANIES_QUERY),
      hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
      hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
      hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
      hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
      hasuraQuery(ACTIVE_CUSTOMERS_QUERY),
      hasuraQuery(USER_PROFILES_QUERY),
    ])

  const companies: { id: string; name: string; code?: string }[] = companiesRes.companies ?? []
  const warehouses: { id: string; name: string; company_id?: string }[] = warehousesRes.warehouses ?? []
  const items: ItemMasterOption[] = itemsRes.item_master ?? []
  const sizes: { id: string; size_label: string }[] = sizesRes.material_sizes ?? []
  const suppliers: { id: string; name: string }[] = suppliersRes.suppliers ?? []
  const customers: { id: string; name: string }[] = customersRes.customers ?? []

  // The report respects whatever company/warehouse the signed-in user is
  // pinned to in user_profiles. No user currently has one set, so this is
  // inert today — but it means the restriction is honoured the moment an
  // assignment is made, using the existing keys rather than a new model.
  const profile = (usersRes.user_profiles ?? []).find(
    (u: { id: string }) => u.id === session?.userId
  ) as { company_id?: string | null; warehouse_id?: string | null } | undefined
  const scopedCompanyId = profile?.company_id ?? null
  const scopedWarehouseId = profile?.warehouse_id ?? null

  const visibleCompanies = scopedCompanyId ? companies.filter((c) => c.id === scopedCompanyId) : companies
  const visibleWarehouses = scopedWarehouseId
    ? warehouses.filter((w) => w.id === scopedWarehouseId)
    : scopedCompanyId
      ? warehouses.filter((w) => w.company_id === scopedCompanyId)
      : warehouses

  const defaults = defaultCreatedRange(null, 30)
  const fromDate = asString(params.from) || defaults.from
  const toDate = asString(params.to) || defaults.to

  const requestedCompanies = asArray(params.company)
  const requestedWarehouses = asArray(params.warehouse)

  const filters: DayWiseFilters = {
    fromDate,
    toDate,
    // An out-of-scope pick is narrowed back to what the user may see rather
    // than silently honoured.
    companyIds: scopedCompanyId
      ? [scopedCompanyId]
      : requestedCompanies.filter((id) => companies.some((c) => c.id === id)),
    warehouseIds: scopedWarehouseId
      ? [scopedWarehouseId]
      : requestedWarehouses.filter((id) => visibleWarehouses.some((w) => w.id === id)),
    itemMasterIds: asArray(params.item),
    materialSizeIds: asArray(params.size),
    entryTypes: asArray(params.type),
    supplierIds: asArray(params.supplier),
    customerIds: asArray(params.customer),
    jobWorkerIds: asArray(params.jobworker),
    documentNumber: asString(params.doc),
    includeCancelled: asString(params.cancelled) === '1',
  }

  // stock_ledger keys stock by material type + size, not item_master_id, so
  // an item selection is translated into the material keys behind it.
  const selectedItems = items.filter((i) => filters.itemMasterIds.includes(i.id))
  const itemMaterialKeys = {
    materialTypeIds: Array.from(new Set(selectedItems.map((i) => i.material_type_id))),
    materialSizeIds: Array.from(
      new Set(selectedItems.map((i) => i.material_size_id).filter((v): v is string => !!v))
    ),
  }

  const { report, matchedCount, truncated, integrityProblems } = await loadDayWiseItemLedger(
    filters,
    itemMaterialKeys
  )

  const criteriaLines = buildCriteriaLines(filters, {
    companies: visibleCompanies,
    warehouses: visibleWarehouses,
    items,
    sizes,
  })

  const exportSheets = buildExportSheets(report, criteriaLines)
  const companyLabel =
    filters.companyIds.length === 1
      ? companies.find((c) => c.id === filters.companyIds[0])?.name ?? 'All Companies'
      : 'All Companies'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" /> Back to Reports
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-gray-900">
            <CalendarRange className="h-6 w-6 text-teal-600" /> Day-Wise Item Ledger
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Every item transaction by date, with size, quantity, value, GST and the parties involved.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
          <DayWiseItemLedgerExport
            meta={{
              companyName: companyLabel,
              fromDate,
              toDate,
              filterLine: criteriaLines.map((c) => `${c.label}: ${c.value}`).join('  |  '),
              generatedBy: session?.fullName ?? 'WareCore',
            }}
            sheets={exportSheets}
          />
        </div>
      </div>

      <DayWiseItemLedgerFilters
        fromDate={fromDate}
        toDate={toDate}
        companies={visibleCompanies}
        warehouses={visibleWarehouses}
        items={items}
        sizes={sizes}
        suppliers={suppliers}
        customers={customers}
        jobWorkers={suppliers}
        selected={filters}
        companyLocked={!!scopedCompanyId}
        warehouseLocked={!!scopedWarehouseId}
      />

      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 print:hidden">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {matchedCount.toLocaleString('en-IN')} transactions match these filters, but only the first{' '}
            {DAY_WISE_LEDGER_LIMIT.toLocaleString('en-IN')} are shown. Totals below cover the shown rows
            only — narrow the date range, item or company to see the rest.
          </span>
        </div>
      )}

      {integrityProblems.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4" /> Summary and detail totals disagree
          </p>
          <ul className="mt-1 list-disc pl-6">
            {integrityProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <DayWiseItemLedgerTable report={report} />
    </div>
  )
}
