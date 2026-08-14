export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_REPORT_QUERY, MOVEMENTS_REPORT_QUERY, ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY } from '@/lib/hasura/queries'
import { fetchPurchaseLineRateMap } from '@/lib/purchaseLineRates'
import { PrintButton } from '@/components/PrintButton'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'
import { DispatchReportRows } from './DispatchReportRows'

const LEDGER_TYPE_LABELS: Record<string, string> = {
  SALE_OUT: 'Sale / Dispatch',
  SALE_CANCEL: 'Sale Cancelled',
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

interface DispatchItem {
  quantity: number | string
  rate: number | string | null
  amount: number | string | null
  size_label: string | null
  material_types: { description: string | null } | null
  material_sizes: { size_label: string | null } | null
}

interface DispatchOrder {
  id: string
  dispatch_date: string
  vehicle_number: string | null
  driver_name?: string | null
  invoice_number: string | null
  notes?: string | null
  sale_ref_id?: string | null
  // Note: DISPATCH_REPORT_QUERY does not currently select `status` — this
  // field is always undefined at runtime (pre-existing, out of scope here).
  status?: string | null
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  customers: { name: string } | null
  dispatch_items: DispatchItem[]
}

interface LedgerRow {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number: string | null
  purchase_line_id: string | null
  size_label: string | null
  notes: string | null
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  material_types: { description: string | null } | null
  material_sizes: { size_label: string | null } | null
}

export default async function DispatchReportPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; warehouse?: string; status?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const conditions: Record<string, unknown>[] = [
    { dispatch_date: { _gte: fromDate } },
    { dispatch_date: { _lte: toDate } },
  ]
  if (params.company) conditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) conditions.push({ warehouse_id: { _eq: params.warehouse } })
  if (params.status) conditions.push({ status: { _eq: params.status } })

  const [result, compResult, whResult] = await Promise.all([
    hasuraQuery(DISPATCH_REPORT_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
  ])

  const orders = (result.dispatch_orders ?? []) as DispatchOrder[]
  const companies = (compResult.companies ?? []) as Company[]
  const allWarehouses = (whResult.warehouses ?? []) as Warehouse[]
  const warehouses = params.company
    ? allWarehouses.filter((w) => w.company_id === params.company)
    : allWarehouses

  const totalQty = orders.reduce((s, o) => {
    return s + (o.dispatch_items ?? []).reduce((si: number, i) => si + Number(i.quantity || 0), 0)
  }, 0)
  const totalAmt = orders.reduce((s, o) => {
    return s + (o.dispatch_items ?? []).reduce((si: number, i) => si + Number(i.amount || 0), 0)
  }, 0)

  // Ledger Detail: the actual SALE_OUT/SALE_CANCEL stock_ledger rows these
  // dispatches produced — real transaction-level traceability. No running
  // balance: mixed items/warehouses have no single meaningful one.
  const orderIds = orders.map((o) => o.id)
  const ledgerResult = orderIds.length > 0
    ? await hasuraQuery(MOVEMENTS_REPORT_QUERY, {
        where: { _and: [{ reference_type: { _eq: 'dispatch' } }, { reference_id: { _in: orderIds } }] },
      })
    : { stock_ledger: [] }
  const ledgerRows = (ledgerResult.stock_ledger ?? []) as LedgerRow[]
  const ledgerRateMap = await fetchPurchaseLineRateMap(ledgerRows.map((m) => m.purchase_line_id))

  const exportMeta = {
    companyName: companies.find((c) => c.id === params.company)?.name || 'All Companies',
    fromDate,
    toDate,
    filterLine: [
      `Warehouse: ${warehouses.find((w) => w.id === params.warehouse)?.name || 'All Warehouses'}`,
      `Status: ${params.status ? params.status.replace(/_/g, ' ') : 'All'}`,
    ].join('   |   '),
    generatedBy: '',
  }
  const summarySheet: ProfessionalSheetSpec = {
    sheetName: 'Dispatch',
    title: 'Dispatch Report',
    emptyMessage: 'No dispatch orders found for the selected period.',
    columns: [
      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
      { header: 'Invoice No.', key: 'invoiceNo', width: 16, align: 'left' },
      { header: 'Company', key: 'company', width: 16, align: 'left' },
      { header: 'Warehouse', key: 'warehouse', width: 16, align: 'left' },
      { header: 'Customer', key: 'customer', width: 20, align: 'left' },
      { header: 'Vehicle', key: 'vehicle', width: 14, align: 'left' },
      { header: 'Material', key: 'material', width: 20, align: 'left' },
      { header: 'Size', key: 'size', width: 12, align: 'left' },
      { header: 'Qty (T)', key: 'qty', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Amount (₹)', key: 'amount', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Status', key: 'status', width: 14, align: 'center' },
    ],
    rows: orders.flatMap((o): Array<{
      date: string; invoiceNo: string; company: string; warehouse: string; customer: string; vehicle: string
      material: string; size: string; qty: number | null; rate: number | null; amount: number | null; status: string
    }> => {
      const items = o.dispatch_items ?? []
      const base = {
        date: o.dispatch_date,
        invoiceNo: o.invoice_number ?? '',
        company: o.companies?.name || '',
        warehouse: o.warehouses?.name || '',
        customer: o.customers?.name || '',
        vehicle: o.vehicle_number ?? '',
      }
      const status = o.status?.replace(/_/g, ' ') ?? ''
      if (items.length === 0) {
        return [{ ...base, material: '', size: '', qty: null, rate: null, amount: null, status }]
      }
      return items.map((item) => ({
        ...base,
        material: item.material_types?.description || '',
        size: item.material_sizes?.size_label ?? item.size_label ?? '',
        qty: Number(item.quantity),
        rate: item.rate ? Number(item.rate) : null,
        amount: item.amount ? Number(item.amount) : null,
        status,
      }))
    }),
  }
  const ledgerDetailSheet: ProfessionalSheetSpec = {
    sheetName: 'Ledger Detail',
    title: 'Dispatch Report — Ledger Detail',
    emptyMessage: 'No stock ledger entries found for the selected dispatch orders.',
    columns: [
      { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
      { header: 'Transaction Type', key: 'type', width: 18, align: 'left' },
      { header: 'Stock Movement', key: 'stockMovement', width: 14, align: 'center' },
      { header: 'Document Number', key: 'documentNumber', width: 18, align: 'left' },
      { header: 'Company', key: 'company', width: 16, align: 'left' },
      { header: 'Warehouse', key: 'warehouse', width: 16, align: 'left' },
      { header: 'Material', key: 'material', width: 20, align: 'left' },
      { header: 'Size', key: 'size', width: 12, align: 'left' },
      { header: 'Inward Quantity', key: 'inwardQty', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Outward Quantity', key: 'outwardQty', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Value (₹)', key: 'value', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Remarks', key: 'remarks', width: 24, align: 'left' },
    ],
    rows: ledgerRows.map((m, idx: number) => {
      const qty = Number(m.quantity)
      const rate = m.purchase_line_id ? ledgerRateMap.get(m.purchase_line_id) ?? null : null
      return {
        sno: idx + 1,
        date: m.entry_date,
        type: LEDGER_TYPE_LABELS[m.entry_type] ?? m.entry_type,
        stockMovement: m.entry_type === 'SALE_OUT' ? 'OUTWARD' : 'INWARD',
        documentNumber: m.reference_number || '',
        company: m.companies?.name || '',
        warehouse: m.warehouses?.name || '',
        material: m.material_types?.description || '',
        size: m.material_sizes?.size_label ?? m.size_label ?? '',
        inwardQty: qty > 0 ? qty : null,
        outwardQty: qty < 0 ? Math.abs(qty) : null,
        rate,
        value: rate != null ? Math.abs(qty) * rate : null,
        remarks: m.notes || '',
      }
    }),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dispatch Report</h1>
          <p className="text-sm text-gray-500 mt-1">Goods dispatched to customers</p>
        </div>
        <div className="flex items-center gap-2">
          {orders.length > 0 && (
            <ProfessionalExportButton
              meta={exportMeta}
              sheets={[summarySheet, ledgerDetailSheet]}
              filenameBase="Dispatch_Report"
              successMessage="Dispatch Report exported successfully."
              errorMessage="Unable to export the Dispatch Report. Please try again."
            />
          )}
          <PrintButton />
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Dispatch Report</h1>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select name="status" defaultValue={params.status || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="dispatched">Dispatched</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
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
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border bg-orange-50 p-4">
          <p className="text-xs text-gray-500">Total Orders</p>
          <p className="text-xl font-bold text-orange-800">{orders.length}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 p-4">
          <p className="text-xs text-gray-500">Total Quantity</p>
          <p className="text-xl font-bold text-blue-800">{totalQty.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-green-50 p-4">
          <p className="text-xs text-gray-500">Total Amount</p>
          <p className="text-xl font-bold text-green-800">₹{totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{orders.length} dispatch order{orders.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          {orders.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No dispatch orders found for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <DispatchReportRows orders={orders} />
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-700" colSpan={8}>Total</td>
                  <td className="px-4 py-3 text-right">{totalQty.toFixed(3)}</td>
                  <td />
                  <td className="px-4 py-3 text-right">₹{totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
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
