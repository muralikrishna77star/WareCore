export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import Link from 'next/link'
import { ArrowLeft, Route, TriangleAlert } from 'lucide-react'
import { verifySession } from '@/lib/auth/session'
import { hasuraQuery } from '@/lib/hasura/server'
import {
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  USER_PROFILES_QUERY,
  STOCK_LEDGER_DATE_BOUNDS_QUERY,
} from '@/lib/hasura/queries'
import { MONTH_NAMES, yearOptionsFrom } from '@/lib/dateRange'
import { fyPeriod } from '@/lib/fyTraceability'
import { loadFyTraceability } from '@/lib/fyTraceabilityData'
import { PrintButton } from '@/components/PrintButton'
import { FyTraceabilityFilters } from './FyTraceabilityFilters'
import { FyTraceabilityTable } from './FyTraceabilityTable'
import { FyTraceabilityExport } from './FyTraceabilityExport'
import { fmtDate, fmtM, fmtQ } from './format'
import { FyTraceabilitySummary, FyUnlinkedSales } from './FyTraceabilitySummary'

type SearchParams = Record<string, string | string[] | undefined>

const asArray = (v: string | string[] | undefined): string[] =>
  v == null ? [] : Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []
const asString = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '')

export default async function FyTraceabilityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const token = (await cookies()).get('wc_session')?.value
  const session = token ? verifySession(token) : null

  const [companiesRes, warehousesRes, itemsRes, suppliersRes, usersRes, boundsRes] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(USER_PROFILES_QUERY),
    hasuraQuery(STOCK_LEDGER_DATE_BOUNDS_QUERY),
  ])
  const bounds = boundsRes.stock_ledger_aggregate?.aggregate
  const companies: { id: string; name: string }[] = companiesRes.companies ?? []
  const warehouses: { id: string; name: string; company_id?: string }[] = warehousesRes.warehouses ?? []
  const items: { id: string; item_code: string; item_name: string; size_label: string | null }[] = itemsRes.item_master ?? []
  const suppliers: { id: string; name: string }[] = suppliersRes.suppliers ?? []

  // Same user_profiles pinning the Day-Wise Item Ledger honours.
  const profile = (usersRes.user_profiles ?? []).find((u: { id: string }) => u.id === session?.userId) as
    | { company_id?: string | null; warehouse_id?: string | null }
    | undefined
  const scopedCompanyId = profile?.company_id ?? null
  const scopedWarehouseId = profile?.warehouse_id ?? null
  const visibleCompanies = scopedCompanyId ? companies.filter((c) => c.id === scopedCompanyId) : companies
  const visibleWarehouses = scopedWarehouseId
    ? warehouses.filter((w) => w.id === scopedWarehouseId)
    : scopedCompanyId
      ? warehouses.filter((w) => w.company_id === scopedCompanyId)
      : warehouses

  // Defaults to the month of the ledger's latest entry, so the first view lands on real data.
  const latest = String(bounds?.max?.entry_date ?? new Date().toISOString().slice(0, 10))
  const reqMonth = Number(asString(params.month))
  const reqYear = Number(asString(params.year))
  const month = Number.isInteger(reqMonth) && reqMonth >= 1 && reqMonth <= 12 ? reqMonth : Number(latest.slice(5, 7))
  const year = Number.isInteger(reqYear) && reqYear >= 1900 && reqYear <= 2999 ? reqYear : Number(latest.slice(0, 4))
  const yearOptions = yearOptionsFrom(bounds?.min?.entry_date, bounds?.max?.entry_date, [year])
  const { fyStart, cutoff } = fyPeriod(month, year)

  const jw = asArray(params.jw)
  const showJobWork = jw.length === 0 || jw.includes('1')

  const filters = {
    fyStart,
    cutoff,
    companyIds: scopedCompanyId ? [scopedCompanyId] : asArray(params.company).filter((id) => companies.some((c) => c.id === id)),
    warehouseIds: scopedWarehouseId
      ? [scopedWarehouseId]
      : asArray(params.warehouse).filter((id) => visibleWarehouses.some((w) => w.id === id)),
    supplierIds: asArray(params.seller).filter((id) => suppliers.some((s) => s.id === id)),
    itemMasterIds: asArray(params.item).filter((id) => items.some((i) => i.id === id)),
  }

  const report = await loadFyTraceability(filters)
  const fyLabel = `FY ${fyStart.slice(0, 4)}-${String(Number(fyStart.slice(0, 4)) + 1).slice(2)}`
  const periodLabel = `${MONTH_NAMES[month - 1]} ${year}`

  const nameList = (ids: string[], rows: { id: string; name: string }[]) =>
    ids.map((id) => rows.find((r) => r.id === id)?.name ?? id).join(', ')
  const criteria = [
    `Period: ${fmtDate(fyStart)} to ${fmtDate(cutoff)}`,
    filters.companyIds.length ? `Company: ${nameList(filters.companyIds, companies)}` : '',
    filters.warehouseIds.length ? `Warehouse: ${nameList(filters.warehouseIds, warehouses)}` : '',
    filters.supplierIds.length ? `Seller: ${nameList(filters.supplierIds, suppliers)}` : '',
    filters.itemMasterIds.length
      ? `Item: ${filters.itemMasterIds.map((id) => items.find((i) => i.id === id)?.item_code ?? id).join(', ')}`
      : '',
  ].filter(Boolean)

  const lastMonth = report.summary[report.summary.length - 1]
  const t = report.summaryTotal
  const allBlocks = [...report.currentFy.flatMap((g) => g.blocks), ...report.priorFy]
  const negativeLines = allBlocks.filter((b) => b.closingBalance < -0.0005)
  const noGstRateSold = allBlocks.filter((b) => b.gstRateMissing && b.soldQty > 0.0005)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" /> Back to Reports
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Route className="h-6 w-6 text-rose-600" /> FY Purchase &amp; Sales Traceability
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Every purchase line of {fyLabel} and what became of it — sales, job work and the unsold balance — as of{' '}
            {fmtDate(cutoff)}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="#monthly-summary" className="text-sm text-blue-600 hover:underline">Monthly summary ↓</a>
          <PrintButton />
          <FyTraceabilityExport
            report={report}
            showJobWork={showJobWork}
            meta={{
              companyName: filters.companyIds.length === 1 ? nameList(filters.companyIds, companies) : 'All Companies',
              fromDate: fyStart,
              toDate: cutoff,
              filterLine: criteria.join('  |  '),
              generatedBy: session?.fullName ?? 'WareCore',
            }}
            filenameBase={`FY_Traceability_${year}_${String(month).padStart(2, '0')}`}
          />
        </div>
      </div>

      <div className="hidden print:block text-center">
        <h1 className="text-xl font-bold">FY Purchase &amp; Sales Traceability — {periodLabel}</h1>
        <p className="text-sm text-gray-700">{criteria.join('  |  ')}</p>
      </div>

      <FyTraceabilityFilters
        month={month}
        year={year}
        yearOptions={yearOptions}
        companies={visibleCompanies}
        warehouses={visibleWarehouses}
        suppliers={suppliers}
        items={items}
        selected={filters}
        showJobWork={showJobWork}
        companyLocked={!!scopedCompanyId}
        warehouseLocked={!!scopedWarehouseId}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-lg border bg-teal-50 px-3 py-2">
          <p className="text-xs text-gray-500">Opening stock (1 Apr)</p>
          <p className="text-base font-bold text-teal-800">{fmtQ(t.openingQty)}</p>
          <p className="text-[0.6875rem] text-gray-500">{report.priorFy.length} prior-FY line{report.priorFy.length === 1 ? '' : 's'}</p>
        </div>
        <div className="rounded-lg border bg-green-50 px-3 py-2">
          <p className="text-xs text-gray-500">Purchased {fyLabel} to date</p>
          <p className="text-base font-bold text-green-800">{fmtQ(t.purchaseQty)}</p>
          <p className="text-[0.6875rem] text-gray-500">₹{fmtM(t.purchaseTotal)} incl. GST</p>
        </div>
        <div className="rounded-lg border bg-red-50 px-3 py-2">
          <p className="text-xs text-gray-500">Sold (linked to purchase lines)</p>
          <p className="text-base font-bold text-red-800">{fmtQ(t.saleQty + t.priorSaleQty)}</p>
          <p className="text-[0.6875rem] text-gray-500">₹{fmtM(t.saleValue + t.priorSaleValue)} basic</p>
        </div>
        <div className="rounded-lg border bg-blue-50 px-3 py-2">
          <p className="text-xs text-gray-500">Balance at {fmtDate(cutoff)}</p>
          <p className="text-base font-bold text-blue-800">{fmtQ(lastMonth?.closingQty ?? 0)}</p>
          <p className="text-[0.6875rem] text-gray-500">
            WH {fmtQ(lastMonth?.closingWarehouse ?? 0)} · Vendor {fmtQ(lastMonth?.closingVendor ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border bg-indigo-50 px-3 py-2">
          <p className="text-xs text-gray-500">Stock value (purchase rate)</p>
          <p className="text-base font-bold text-indigo-800">₹{fmtM(lastMonth?.closingValue ?? 0)}</p>
          <p className="text-[0.6875rem] text-gray-500">excl. GST</p>
        </div>
      </div>

      {(report.unlinkedSales.length > 0 || negativeLines.length > 0 || noGstRateSold.length > 0) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            {report.unlinkedSales.length > 0 && (
              <p>
                {report.unlinkedSales.length} sale line{report.unlinkedSales.length === 1 ? '' : 's'} ({fmtQ(report.unlinkedTotals.qty)} qty)
                in the period name no purchase line, so line balances overstate stock by that much — listed below the
                table.
              </p>
            )}
            {noGstRateSold.length > 0 && (
              <p>
                {noGstRateSold.length} purchase line{noGstRateSold.length === 1 ? ' has' : 's have'} sales but no GST % on
                the purchase entry, so their Sale GST is left blank — set the tax rate on those purchase bills to fill it.
              </p>
            )}
            {negativeLines.length > 0 && (
              <p>
                {negativeLines.length} purchase line{negativeLines.length === 1 ? ' has' : 's have'} a negative balance:{' '}
                {negativeLines.map((b) => `${b.line.purchaseLineId} (${fmtQ(b.closingBalance)})`).join(', ')}.
              </p>
            )}
          </div>
        </div>
      )}

      <FyTraceabilityTable report={report} showJobWork={showJobWork} />
      <FyUnlinkedSales report={report} />
      <FyTraceabilitySummary report={report} />
    </div>
  )
}
