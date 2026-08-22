export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import {
  MOVEMENTS_REPORT_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY,
  ACTIVE_MATERIAL_SIZES_QUERY,
  PURCHASE_BILL_IDS_QUERY,
  JOB_WORK_ORDER_IDS_QUERY,
} from '@/lib/hasura/queries'
import { fetchPurchaseLineRateMap } from '@/lib/purchaseLineRates'
import { PrintButton } from '@/components/PrintButton'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'
import { MovementsRows } from './MovementsRows'

const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

// Real stock_ledger.entry_type values (uppercase, per the DB check
// constraint) — previously this map used lowercase keys ('purchase',
// 'transfer_in', ...) which never matched a real row, so every Type badge
// silently fell back to the raw entry_type, Total In/Total Out always
// summed to 0, and the Entry Type filter dropdown returned zero results
// for every option. Fixed here using the same uppercase table already
// used consistently by Daywise Stock Statement / Item Ledger.
const entryTypeConfig: Record<string, { label: string; color: string; isIn: boolean }> = {
  PURCHASE_IN:          { label: 'Purchase In',      color: 'bg-green-100 text-green-800', isIn: true },
  PURCHASE_CANCEL:       { label: 'Purchase Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: false },
  TRANSFER_IN:           { label: 'Transfer In',      color: 'bg-blue-100 text-blue-800',   isIn: true },
  TRANSFER_OUT:          { label: 'Transfer Out',     color: 'bg-orange-100 text-orange-800', isIn: false },
  SALE_OUT:              { label: 'Dispatch',         color: 'bg-red-100 text-red-800',     isIn: false },
  SALE_CANCEL:           { label: 'Dispatch Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: true },
  JOB_WORK_OUT:          { label: 'Job Work Out',     color: 'bg-purple-100 text-purple-800', isIn: false },
  JOB_WORK_RETURN_IN:    { label: 'Job Work Return',  color: 'bg-teal-100 text-teal-800',   isIn: true },
  JOB_WORK_CANCEL:       { label: 'Job Work Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: true },
  JOB_WORK_OUTPUT_IN:    { label: 'Job Work Output',  color: 'bg-teal-100 text-teal-800',   isIn: true },
  JOB_WORK_TRANSFER_OUT: { label: 'JW Transfer Out',  color: 'bg-purple-100 text-purple-800', isIn: false },
  JOB_WORK_TRANSFER_IN:  { label: 'JW Transfer In',   color: 'bg-purple-100 text-purple-800', isIn: true },
  VENDOR_RETURN_IN:      { label: 'Vendor Return',    color: 'bg-teal-100 text-teal-800',   isIn: true },
  ADJUSTMENT_IN:         { label: 'Adjustment In',    color: 'bg-gray-100 text-gray-800',   isIn: true },
  ADJUSTMENT_OUT:        { label: 'Adjustment Out',   color: 'bg-gray-100 text-gray-800',   isIn: false },
}

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
}

interface Company {
  id: string
  name: string
  code?: string | null
}

interface Warehouse {
  id: string
  name: string
  company_id: string
}

interface Supplier {
  id: string
  name: string
}

interface MaterialType {
  id: string
  description: string
}

interface MaterialSize {
  id: string
  material_type_id: string | null
  size_label: string
}

interface ItemMasterRow {
  id: string
  item_code: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  size_label?: string | null
  material_sizes?: { size_label: string } | null
}

interface StockLedgerMovement {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number: string | null
  reference_type: string | null
  // Note: MOVEMENTS_REPORT_QUERY does not select `reference_id` — always
  // undefined at runtime (pre-existing, out of scope here).
  reference_id?: string | null
  purchase_line_id: string | null
  sub_purchase_line_id: string | null
  size_label: string | null
  notes: string | null
  material_type_id: string | null
  material_size_id: string | null
  warehouse_id: string | null
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  material_types: { description: string | null; unit?: string | null } | null
  material_sizes: { size_label: string | null } | null
  runningBalance?: number
}

export default async function MovementsReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string
    warehouse?: string
    entry_type?: string
    material_type?: string
    size?: string
    item?: string
    vendor?: string
    from?: string
    to?: string
  }>
}) {
  const params = await searchParams
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const [compResult, whResult, supResult, itemResult, matTypeResult, matSizeResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_TYPES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
  ])

  const companies = (compResult.companies ?? []) as Company[]
  const allWarehouses = (whResult.warehouses ?? []) as Warehouse[]
  const warehouses = params.company
    ? allWarehouses.filter((w) => w.company_id === params.company)
    : allWarehouses
  const suppliers = (supResult.suppliers ?? []) as Supplier[]
  const materialTypes = (matTypeResult.material_types ?? []) as MaterialType[]
  const allSizes = (matSizeResult.material_sizes ?? []) as MaterialSize[]
  const sizes = params.material_type
    ? allSizes.filter((s) => !s.material_type_id || s.material_type_id === params.material_type)
    : allSizes

  const itemRows = (itemResult.item_master ?? []) as ItemMasterRow[]
  const itemOptions: ItemOption[] = itemRows.map((i) => {
    const size = i.material_sizes?.size_label || i.size_label
    return {
      id: i.id,
      label: `${i.item_code} — ${i.item_name}${size ? ` (${size})` : ''}`,
      search: `${i.item_code} ${i.item_name} ${size ?? ''}`.toLowerCase(),
      material_type_id: i.material_type_id,
      material_size_id: i.material_size_id,
    }
  })
  const selectedItem = params.item ? itemOptions.find((i) => i.id === params.item) : undefined

  const conditions: Record<string, unknown>[] = [
    { entry_date: { _gte: fromDate } },
    { entry_date: { _lte: toDate } },
  ]
  if (params.company) conditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) conditions.push({ warehouse_id: { _eq: params.warehouse } })
  if (params.entry_type) conditions.push({ entry_type: { _eq: params.entry_type } })
  if (selectedItem) {
    conditions.push({ material_type_id: { _eq: selectedItem.material_type_id } })
    if (selectedItem.material_size_id) {
      conditions.push({ material_size_id: { _eq: selectedItem.material_size_id } })
    }
  } else {
    if (params.material_type) conditions.push({ material_type_id: { _eq: params.material_type } })
    if (params.size) conditions.push({ material_size_id: { _eq: params.size } })
  }

  // Vendor isn't stored on stock_ledger directly — resolve it to the set of
  // purchase bill / job work order IDs it appears on, same approach as the
  // Stock Movements ledger page.
  let noResults = false
  if (params.vendor) {
    const [billIdsResult, jobOrderIdsResult] = await Promise.all([
      hasuraQuery(PURCHASE_BILL_IDS_QUERY, { where: { supplier_id: { _eq: params.vendor } } }),
      hasuraQuery(JOB_WORK_ORDER_IDS_QUERY, { where: { vendor_id: { _eq: params.vendor } } }),
    ])
    const refIds = [
      ...(billIdsResult.purchase_bills ?? []).map((b: { id: string }) => b.id),
      ...(jobOrderIdsResult.job_work_orders ?? []).map((o: { id: string }) => o.id),
    ]
    if (refIds.length === 0) {
      noResults = true
    } else {
      conditions.push({ reference_id: { _in: refIds } })
    }
  }

  const result = noResults
    ? { stock_ledger: [] }
    : await hasuraQuery(MOVEMENTS_REPORT_QUERY, { where: { _and: conditions } })
  const resultMovements = (result.stock_ledger ?? []) as StockLedgerMovement[]

  const totalIn = resultMovements
    .filter((m) => entryTypeConfig[m.entry_type]?.isIn)
    .reduce((s, m) => s + Number(m.quantity || 0), 0)
  const totalOut = resultMovements
    .filter((m) => entryTypeConfig[m.entry_type] && !entryTypeConfig[m.entry_type].isIn)
    .reduce((s, m) => s + Math.abs(Number(m.quantity || 0)), 0)

  // Running Balance, per stock key (item + size + warehouse) — this report
  // spans many different items/warehouses at once, so a single running
  // total wouldn't be meaningful; each key's balance resets and starts
  // fresh from 0 at the top of the selected period (this is a period
  // movement balance, not an absolute stock position — the report has no
  // opening-balance concept, unlike Stock Statement / Item Ledger).
  // Sorted by key first (stable sort preserves the query's own
  // entry_date/created_at order within each key) so the running total
  // reads correctly top-to-bottom within each item block.
  const stockKeyFor = (m: StockLedgerMovement) => `${m.material_type_id ?? ''}|${m.material_size_id ?? ''}|${m.warehouse_id ?? ''}`
  const movements = [...resultMovements].sort((a, b) => stockKeyFor(a).localeCompare(stockKeyFor(b)))
  const runningByKey = new Map<string, number>()
  for (const m of movements) {
    const key = stockKeyFor(m)
    const next = (runningByKey.get(key) ?? 0) + Number(m.quantity)
    runningByKey.set(key, next)
    m.runningBalance = next
  }

  // Rate for each movement comes from the exact purchase line it's tied to
  // (m.purchase_line_id), same as Job Work Report and Vendor Movements — not
  // an average. Value keeps the ledger quantity's sign (positive = in,
  // negative = out) rather than hiding or flipping negative movements.
  const movementRateMap = await fetchPurchaseLineRateMap(movements.map((m) => m.purchase_line_id))
  const rateFor = (m: StockLedgerMovement): number | null => (m.purchase_line_id ? movementRateMap.get(m.purchase_line_id) ?? null : null)
  const valueFor = (m: StockLedgerMovement): number | null => {
    const rate = rateFor(m)
    return rate != null ? Number(m.quantity) * rate : null
  }
  const totalValue = movements.reduce((s, m) => s + (valueFor(m) ?? 0), 0)

  // Precomputed onto each row (rather than passing rateFor/valueFor
  // themselves) — a function can't cross the Server -> Client Component
  // boundary.
  const movementsWithValues = movements.map((m) => ({ ...m, rate: rateFor(m), value: valueFor(m) }))

  const exportMeta = {
    companyName: companies.find((c) => c.id === params.company)?.name || 'All Companies',
    fromDate,
    toDate,
    filterLine: [
      `Warehouse: ${warehouses.find((w) => w.id === params.warehouse)?.name || 'All Warehouses'}`,
      `Item: ${selectedItem?.label || 'All Items'}`,
      `Entry Type: ${params.entry_type ? entryTypeConfig[params.entry_type]?.label ?? params.entry_type : 'All'}`,
    ].join('   |   '),
    generatedBy: '',
  }
  const movementsSheet: ProfessionalSheetSpec = {
    sheetName: 'Movements',
    title: 'Movements Report',
    emptyMessage: 'No movements found for the selected period.',
    columns: [
      { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
      { header: 'Type', key: 'type', width: 18, align: 'left' },
      { header: 'Company', key: 'company', width: 16, align: 'left' },
      { header: 'Warehouse', key: 'warehouse', width: 16, align: 'left' },
      { header: 'Material', key: 'material', width: 20, align: 'left' },
      { header: 'Size', key: 'size', width: 12, align: 'left' },
      { header: 'Qty (T)', key: 'qty', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Running Balance (Period)', key: 'runningBalance', width: 20, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Value (₹)', key: 'value', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Reference', key: 'reference', width: 16, align: 'left' },
    ],
    rows: movements.map((m, idx: number) => {
      const rate = rateFor(m)
      const value = valueFor(m)
      return {
        sno: idx + 1,
        date: m.entry_date,
        type: entryTypeConfig[m.entry_type]?.label ?? m.entry_type,
        company: m.companies?.name ?? '',
        warehouse: m.warehouses?.name ?? '',
        material: m.material_types?.description ?? '',
        size: m.material_sizes?.size_label ?? m.size_label ?? '',
        qty: Number(m.quantity),
        runningBalance: m.runningBalance,
        rate: rate ?? null,
        value: value ?? null,
        reference: m.reference_id ?? '',
      }
    }),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Movements Report</h1>
          <p className="text-sm text-gray-500 mt-1">Stock ledger movements by type</p>
        </div>
        <div className="flex items-center gap-2">
          {movements.length > 0 && (
            <ProfessionalExportButton
              meta={exportMeta}
              sheets={[movementsSheet]}
              filenameBase="Movements_Report"
              successMessage="Movements Report exported successfully."
              errorMessage="Unable to export the Movements Report. Please try again."
            />
          )}
          <PrintButton />
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Movements Report</h1>
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select name="company" defaultValue={params.company || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
            <select name="warehouse" defaultValue={params.warehouse || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Warehouses</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Entry Type</label>
            <select name="entry_type" defaultValue={params.entry_type || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Types</option>
              {Object.entries(entryTypeConfig).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Material Type</label>
            <select name="material_type" defaultValue={params.material_type || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Material Types</option>
              {materialTypes.map((mt) => (
                <option key={mt.id} value={mt.id}>{mt.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
            <select name="size" defaultValue={params.size || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Sizes</option>
              {sizes.map((s) => (
                <option key={s.id} value={s.id}>{s.size_label}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[14rem]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Item</label>
            <ItemComboBox
              name="item"
              defaultValue={params.item || ''}
              defaultLabel={selectedItem?.label || ''}
              placeholder="Search item…"
              options={itemOptions}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
            <select name="vendor" defaultValue={params.vendor || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" name="from" defaultValue={fromDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" name="to" defaultValue={toDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Apply</button>
        </div>
      </form>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-gray-50 p-4">
          <p className="text-xs text-gray-500">Total Entries</p>
          <p className="text-xl font-bold text-gray-800">{movements.length}</p>
        </div>
        <div className="rounded-xl border bg-green-50 p-4">
          <p className="text-xs text-gray-500">Total In</p>
          <p className="text-xl font-bold text-green-700">+{totalIn.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-red-50 p-4">
          <p className="text-xs text-gray-500">Total Out</p>
          <p className="text-xl font-bold text-red-700">-{totalOut.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-teal-50 p-4">
          <p className="text-xs text-gray-500">Net Value</p>
          <p className={`text-xl font-bold ${totalValue < 0 ? 'text-red-700' : 'text-teal-800'}`}>{fmtC(totalValue)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{movements.length} entr{movements.length !== 1 ? 'ies' : 'y'}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          {movements.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No movements found for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <MovementsRows movements={movementsWithValues} />
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-700" colSpan={6}>Net Movement</td>
                  <td className={`px-4 py-3 text-right ${totalIn - totalOut >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {totalIn - totalOut >= 0 ? '+' : ''}{(totalIn - totalOut).toFixed(3)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">—</td>
                  <td className="px-4 py-3 text-right text-gray-400">—</td>
                  <td className={`px-4 py-3 text-right ${totalValue < 0 ? 'text-red-600' : 'text-teal-800'}`}>{fmtC(totalValue)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
