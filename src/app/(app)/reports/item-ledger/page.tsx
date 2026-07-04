export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth/session'
import { hasuraQuery, hasuraRunSql } from '@/lib/hasura/server'
import {
  ITEM_STOCK_LEDGER_QUERY,
  ITEM_STOCK_AT_VENDORS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_MATERIAL_SIZES_QUERY,
} from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import { ItemLedgerItemSizeFields } from '@/components/ItemLedgerItemSizeFields'
import { ItemLedgerRows } from '@/components/ItemLedgerRows'
import Link from 'next/link'

// Direct ledger row deletion is raw data surgery — same role gate as
// /api/stock/ledger-entries.
const LEDGER_MANAGE_ROLES = new Set(['admin', 'developer'])

// Tables that back each stock_ledger.reference_type, used to detect rows
// whose reference (bill/dispatch/job work/transfer) no longer exists.
const REFERENCE_TABLE_BY_TYPE: Record<string, string> = {
  purchase_bill: 'purchase_bills',
  dispatch: 'dispatch_orders',
  job_work: 'job_work_orders',
  transfer: 'transfers',
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function findOrphanedReferences(pairs: { type: string; id: string }[]): Promise<Set<string>> {
  const valuesSql = pairs
    .filter((p) => REFERENCE_TABLE_BY_TYPE[p.type] && UUID_RE.test(p.id))
    .map((p) => `('${p.type}'::text, '${p.id}'::uuid)`)
    .join(',')
  if (!valuesSql) return new Set()

  const sql = `
    SELECT refs.reference_type, refs.reference_id::text
    FROM (VALUES ${valuesSql}) AS refs(reference_type, reference_id)
    WHERE
      (refs.reference_type = 'purchase_bill' AND NOT EXISTS (SELECT 1 FROM purchase_bills b WHERE b.id = refs.reference_id))
      OR (refs.reference_type = 'dispatch' AND NOT EXISTS (SELECT 1 FROM dispatch_orders d WHERE d.id = refs.reference_id))
      OR (refs.reference_type = 'job_work' AND NOT EXISTS (SELECT 1 FROM job_work_orders j WHERE j.id = refs.reference_id))
      OR (refs.reference_type = 'transfer' AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.id = refs.reference_id))
  `
  const result = await hasuraRunSql(sql)
  const rows = result.result?.slice(1) ?? []
  return new Set(rows.map(([type, id]) => `${type}|${id}`))
}

type ItemMaster = {
  id: string
  item_code: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  size_label?: string | null
  unit: string
  material_types?: { description: string; unit: string }
  material_sizes?: { size_label: string } | null
}

type LedgerEntry = {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number?: string | null
  reference_type?: string | null
  reference_id?: string | null
  purchase_line_id?: string | null
  sub_purchase_line_id?: string | null
  size_label?: string | null
  notes?: string | null
  companies?: { name: string; code: string } | null
  warehouses?: { name: string } | null
  material_types?: { description: string; unit: string } | null
  material_sizes?: { size_label: string } | null
}

export default async function ItemStockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; size?: string; company?: string; warehouse?: string; from?: string; to?: string }>
}) {
  const params = await searchParams

  const cookieStore = await cookies()
  const token = cookieStore.get('wc_session')?.value
  const session = token ? verifySession(token) : null
  const canManage = !!session && LEDGER_MANAGE_ROLES.has(session.role)

  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const [itemResult, compResult, whResult, sizeResult] = await Promise.all([
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
  ])

  const items: ItemMaster[] = itemResult.item_master ?? []
  const companies: { id: string; name: string }[] = compResult.companies ?? []
  const allWarehouses: { id: string; name: string; company_id: string }[] = whResult.warehouses ?? []
  const allSizes: { id: string; material_type_id: string | null; size_label: string }[] = sizeResult.material_sizes ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w) => w.company_id === params.company)
    : allWarehouses

  const selectedItem = params.item ? items.find((i) => i.id === params.item) ?? null : null

  const selectedSizeId = params.size || selectedItem?.material_size_id || ''

  let openingBalance = 0
  let entries: LedgerEntry[] = []
  let vendorStock: { vendor_name: string; pending_quantity: number | string; unit: string }[] = []

  if (selectedItem) {
    const baseConditions: Record<string, unknown>[] = [
      { material_type_id: { _eq: selectedItem.material_type_id } },
      selectedSizeId
        ? { material_size_id: { _eq: selectedSizeId } }
        : { material_size_id: { _is_null: true } },
    ]
    if (params.company) baseConditions.push({ company_id: { _eq: params.company } })
    if (params.warehouse) baseConditions.push({ warehouse_id: { _eq: params.warehouse } })

    const openingWhere = { _and: [...baseConditions, { entry_date: { _lt: fromDate } }] }
    const periodWhere = {
      _and: [...baseConditions, { entry_date: { _gte: fromDate } }, { entry_date: { _lte: toDate } }],
    }

    const result = await hasuraQuery(ITEM_STOCK_LEDGER_QUERY, {
      opening_where: openingWhere,
      period_where: periodWhere,
    })
    openingBalance = Number(result.opening_agg?.aggregate?.sum?.quantity ?? 0)
    entries = result.entries ?? []

    const selectedSizeLabel = selectedSizeId
      ? allSizes.find((s) => s.id === selectedSizeId)?.size_label ?? null
      : null
    const vendorWhere: Record<string, unknown> = { material_type_id: { _eq: selectedItem.material_type_id } }
    if (selectedSizeLabel) vendorWhere.size_label = { _eq: selectedSizeLabel }
    if (params.company) vendorWhere.company_id = { _eq: params.company }
    const vendorResult = await hasuraQuery(ITEM_STOCK_AT_VENDORS_QUERY, { where: vendorWhere })
    vendorStock = vendorResult.v_stock_at_vendors ?? []
  }

  let orphanedRefs = new Set<string>()
  if (canManage && entries.length) {
    const pairs = entries
      .filter((e) => e.reference_type && e.reference_id)
      .map((e) => ({ type: e.reference_type as string, id: e.reference_id as string }))
    orphanedRefs = await findOrphanedReferences(pairs)
  }

  // Rows sharing the same reference + line ID are flagged for review — usually
  // leftover PURCHASE_IN/CANCEL (or SALE_/JOB_WORK_) pairs from repeated edits.
  const dupKeyCounts = new Map<string, number>()
  for (const e of entries) {
    const lineId = e.sub_purchase_line_id || e.purchase_line_id
    if (!e.reference_id || !lineId) continue
    const key = `${e.reference_id}|${lineId}`
    dupKeyCounts.set(key, (dupKeyCounts.get(key) ?? 0) + 1)
  }

  let running = openingBalance
  const ledgerRows = entries.map((e) => {
    running += Number(e.quantity)
    const lineId = e.sub_purchase_line_id || e.purchase_line_id
    const dupKey = e.reference_id && lineId ? `${e.reference_id}|${lineId}` : null
    return {
      ...e,
      balance: running,
      orphaned: e.reference_type && e.reference_id ? orphanedRefs.has(`${e.reference_type}|${e.reference_id}`) : false,
      duplicateCount: dupKey ? dupKeyCounts.get(dupKey) ?? 1 : 1,
    }
  })
  const closingBalance = running

  const totalIn = entries
    .filter((e) => Number(e.quantity) > 0)
    .reduce((s, e) => s + Number(e.quantity), 0)
  const totalOut = entries
    .filter((e) => Number(e.quantity) < 0)
    .reduce((s, e) => s + Math.abs(Number(e.quantity)), 0)

  const unit = selectedItem?.material_types?.unit || selectedItem?.unit || 'tons'
  const sizeLabel = selectedItem?.material_sizes?.size_label || selectedItem?.size_label
  const itemTitle = selectedItem
    ? `${selectedItem.item_code} — ${selectedItem.item_name}${sizeLabel ? ` (${sizeLabel})` : ''}`
    : null

  const fmtQ = (n: number) => n.toFixed(3)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Item Stock Ledger</h1>
          <p className="text-sm text-gray-500 mt-1">
            Opening balance, movements, and running balance for a single item over a date range
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedItem && <PrintButton />}
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Item Stock Ledger</h1>
        {itemTitle && <p className="text-sm text-gray-700 font-medium">{itemTitle}</p>}
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <ItemLedgerItemSizeFields
            items={items.map((i) => ({
              id: i.id,
              item_code: i.item_code,
              item_name: i.item_name,
              material_type_id: i.material_type_id,
              material_size_id: i.material_size_id,
              size_label: i.material_sizes?.size_label || i.size_label,
            }))}
            allSizes={allSizes}
            defaultItemId={params.item || ''}
            defaultSizeId={selectedSizeId}
          />

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select
              name="company"
              defaultValue={params.company || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
            <select
              name="warehouse"
              defaultValue={params.warehouse || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              name="from"
              defaultValue={fromDate}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              name="to"
              defaultValue={toDate}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Apply
          </button>
        </div>
      </form>

      {!selectedItem ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <p className="text-4xl mb-3">📒</p>
          <p className="text-gray-500 text-sm">Select an item above to view its stock ledger.</p>
        </div>
      ) : (
        <>
          {/* Item header */}
          <div className="rounded-xl border bg-white p-4 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-semibold text-gray-900">{itemTitle}</p>
              <p className="text-sm text-gray-500">Unit: {unit}</p>
            </div>
            <p className="text-sm text-gray-500">{fromDate} → {toDate}</p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="rounded-xl border bg-blue-50 p-4">
              <p className="text-xs text-gray-500">Opening Balance</p>
              <p className={`text-xl font-bold ${openingBalance < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                {fmtQ(openingBalance)}
              </p>
            </div>
            <div className="rounded-xl border bg-green-50 p-4">
              <p className="text-xs text-gray-500">Total In</p>
              <p className="text-xl font-bold text-green-700">+{fmtQ(totalIn)}</p>
            </div>
            <div className="rounded-xl border bg-red-50 p-4">
              <p className="text-xs text-gray-500">Total Out</p>
              <p className="text-xl font-bold text-red-700">-{fmtQ(totalOut)}</p>
            </div>
            <div className="rounded-xl border bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Closing Balance</p>
              <p className={`text-xl font-bold ${closingBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {fmtQ(closingBalance)}
              </p>
            </div>
            <div className="rounded-xl border bg-purple-50 p-4">
              <p className="text-xs text-gray-500">At Vendor (Job Work)</p>
              <p className="text-xl font-bold text-purple-800">
                {fmtQ(vendorStock.reduce((s, v) => s + Number(v.pending_quantity), 0))}
              </p>
              {vendorStock.length > 1 && (
                <p className="text-[11px] text-gray-500 mt-1 leading-tight">
                  {vendorStock.map((v) => `${v.vendor_name}: ${fmtQ(Number(v.pending_quantity))}`).join(' · ')}
                </p>
              )}
              {vendorStock.length === 1 && (
                <p className="text-[11px] text-gray-500 mt-1">{vendorStock[0].vendor_name}</p>
              )}
            </div>
          </div>

          {/* Ledger table */}
          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
              <span className="font-semibold text-gray-700 text-sm">Ledger Entries</span>
              <span className="text-xs text-gray-500">{ledgerRows.length} entr{ledgerRows.length !== 1 ? 'ies' : 'y'}</span>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                    {canManage && <th className="px-2 py-3" />}
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Reference</th>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-left">Warehouse</th>
                    <th className="px-4 py-3 text-right">In</th>
                    <th className="px-4 py-3 text-right">Out</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr className="bg-blue-50/50 font-medium">
                    <td className="px-4 py-3 text-gray-600" colSpan={canManage ? 8 : 7}>Opening Balance as of {fromDate}</td>
                    <td className={`px-4 py-3 text-right font-bold ${openingBalance < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                      {fmtQ(openingBalance)}
                    </td>
                    <td />
                  </tr>
                  {ledgerRows.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 10 : 9} className="px-4 py-8 text-center text-gray-400">
                        No movements for this item in the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
                {ledgerRows.length > 0 && <ItemLedgerRows rows={ledgerRows} canManage={canManage} />}
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-sm">
                    <td className="px-4 py-3 text-gray-700" colSpan={canManage ? 6 : 5}>Closing Balance as of {toDate}</td>
                    <td className="px-4 py-3 text-right text-green-800">+{fmtQ(totalIn)}</td>
                    <td className="px-4 py-3 text-right text-red-800">-{fmtQ(totalOut)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${closingBalance < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {fmtQ(closingBalance)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
