export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_REPORT_QUERY, MOVEMENTS_REPORT_QUERY, ACTIVE_COMPANIES_QUERY } from '@/lib/hasura/queries'
import { fetchPurchaseLineRateMap } from '@/lib/purchaseLineRates'
import { PrintButton } from '@/components/PrintButton'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'
import { JobWorkReportRows } from './JobWorkReportRows'

const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const LEDGER_TYPE_LABELS: Record<string, string> = {
  JOB_WORK_OUT: 'Job Work Out',
  JOB_WORK_RETURN_IN: 'Job Work Return In',
  JOB_WORK_CANCEL: 'Job Work Cancelled',
  JOB_WORK_OUTPUT_IN: 'Job Work Output In',
  JOB_WORK_TRANSFER_OUT: 'Job Work Transfer Out',
  JOB_WORK_TRANSFER_IN: 'Job Work Transfer In',
}
const LEDGER_STOCK_MOVEMENT: Record<string, 'INWARD' | 'OUTWARD' | 'TRANSFER'> = {
  JOB_WORK_OUT: 'OUTWARD',
  JOB_WORK_RETURN_IN: 'INWARD',
  JOB_WORK_CANCEL: 'INWARD',
  JOB_WORK_OUTPUT_IN: 'INWARD',
  JOB_WORK_TRANSFER_OUT: 'TRANSFER',
  JOB_WORK_TRANSFER_IN: 'TRANSFER',
}

interface Company {
  id: string
  name: string
  code?: string | null
}

interface JobWorkItem {
  quantity_sent: number | string
  quantity_received: number | string
  quantity_transferred_out: number | string
  size_label: string | null
  purchase_line_id: string | null
  material_types: { description: string | null; unit?: string | null } | null
  material_sizes: { size_label: string | null } | null
}

interface JobWorkOrder {
  id: string
  reference_number: string
  dispatch_date: string
  expected_return_date: string | null
  actual_return_date: string | null
  status: string | null
  notes?: string | null
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  suppliers: { name: string } | null
  job_work_items: JobWorkItem[]
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

export default async function JobWorkReportPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; status?: string; from?: string; to?: string }>
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
  if (params.status) conditions.push({ status: { _eq: params.status } })

  const [result, compResult] = await Promise.all([
    hasuraQuery(JOB_WORK_REPORT_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
  ])

  const orders = (result.job_work_orders ?? []) as JobWorkOrder[]
  const companies = (compResult.companies ?? []) as Company[]

  // Rate per line = the billed rate of the exact purchase that material was
  // sourced from (job_work_items.purchase_line_id), not an average — each
  // job work transaction is valued against its own originating purchase.
  const lineIds = orders.flatMap((o) => (o.job_work_items ?? []).map((i) => i.purchase_line_id))
  const rateMap = await fetchPurchaseLineRateMap(lineIds)
  const rateFor = (item: JobWorkItem): number => (item.purchase_line_id ? rateMap.get(item.purchase_line_id) ?? 0 : 0)

  const totalSent = orders.reduce((s, o) => {
    return s + (o.job_work_items ?? []).reduce((si: number, i) => si + Number(i.quantity_sent || 0), 0)
  }, 0)
  const totalReceived = orders.reduce((s, o) => {
    return s + (o.job_work_items ?? []).reduce((si: number, i) => si + Number(i.quantity_received || 0), 0)
  }, 0)
  const totalPending = totalSent - totalReceived
  const totalSentValue = orders.reduce((s, o) => {
    return s + (o.job_work_items ?? []).reduce((si: number, i) => si + Number(i.quantity_sent || 0) * rateFor(i), 0)
  }, 0)
  const totalPendingValue = orders.reduce((s, o) => {
    return s + (o.job_work_items ?? []).reduce((si: number, i) => {
      const pending = Number(i.quantity_sent || 0) - Number(i.quantity_received || 0) - Number(i.quantity_transferred_out || 0)
      return si + pending * rateFor(i)
    }, 0)
  }, 0)

  // Ledger Detail: the actual stock_ledger rows these orders produced —
  // real transaction-level traceability, alongside (not replacing) the
  // order-level summary above. No running balance here: orders in this
  // filtered set span many different items/vendors, so a single balance
  // wouldn't be a meaningful number.
  const orderIds = orders.map((o) => o.id)
  const ledgerResult = orderIds.length > 0
    ? await hasuraQuery(MOVEMENTS_REPORT_QUERY, {
        where: { _and: [{ reference_type: { _eq: 'job_work' } }, { reference_id: { _in: orderIds } }] },
      })
    : { stock_ledger: [] }
  const ledgerRows = (ledgerResult.stock_ledger ?? []) as LedgerRow[]
  const ledgerRateMap = await fetchPurchaseLineRateMap(ledgerRows.map((m) => m.purchase_line_id))

  const exportMeta = {
    companyName: companies.find((c) => c.id === params.company)?.name || 'All Companies',
    fromDate,
    toDate,
    filterLine: `Status: ${params.status ? params.status.replace(/_/g, ' ') : 'All'}`,
    generatedBy: '',
  }
  const summarySheet: ProfessionalSheetSpec = {
    sheetName: 'Job Work',
    title: 'Job Work Report',
    emptyMessage: 'No job work orders found for the selected period.',
    columns: [
      { header: 'Ref No.', key: 'refNo', width: 18, align: 'left' },
      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
      { header: 'Exp. Return', key: 'expReturn', width: 16, align: 'center', isDate: true },
      { header: 'Company', key: 'company', width: 16, align: 'left' },
      { header: 'Supplier', key: 'supplier', width: 20, align: 'left' },
      { header: 'Material', key: 'material', width: 20, align: 'left' },
      { header: 'Size', key: 'size', width: 12, align: 'left' },
      { header: 'Sent (T)', key: 'sent', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Received (T)', key: 'received', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Pending (T)', key: 'pending', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Sent Value (₹)', key: 'sentValue', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Pending Value (₹)', key: 'pendingValue', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Status', key: 'status', width: 14, align: 'center' },
    ],
    rows: orders.flatMap((o): Array<{
      refNo: string; date: string; expReturn: string | null; company: string; supplier: string
      material: string; size: string; sent: number | null; received: number | null; pending: number | null
      rate: number | null; sentValue: number | null; pendingValue: number | null; status: string
    }> => {
      const items = o.job_work_items ?? []
      const base = {
        refNo: o.reference_number,
        date: o.dispatch_date,
        expReturn: o.expected_return_date || null,
        company: o.companies?.name || '',
        supplier: o.suppliers?.name || '',
      }
      const status = o.status?.replace(/_/g, ' ') ?? ''
      if (items.length === 0) {
        return [{ ...base, material: '', size: '', sent: null, received: null, pending: null, rate: null, sentValue: null, pendingValue: null, status }]
      }
      return items.map((item) => {
        const sent = Number(item.quantity_sent || 0)
        const received = Number(item.quantity_received || 0)
        const pending = sent - received - Number(item.quantity_transferred_out || 0)
        const rate = rateFor(item)
        return {
          ...base,
          material: item.material_types?.description || '',
          size: item.material_sizes?.size_label ?? item.size_label ?? '',
          sent,
          received,
          pending: sent - received,
          rate: rate || null,
          sentValue: rate ? sent * rate : null,
          pendingValue: rate ? pending * rate : null,
          status,
        }
      })
    }),
  }
  const ledgerDetailSheet: ProfessionalSheetSpec = {
    sheetName: 'Ledger Detail',
    title: 'Job Work Report — Ledger Detail',
    emptyMessage: 'No stock ledger entries found for the selected job work orders.',
    columns: [
      { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
      { header: 'Transaction Type', key: 'type', width: 20, align: 'left' },
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
        stockMovement: LEDGER_STOCK_MOVEMENT[m.entry_type] ?? (qty >= 0 ? 'INWARD' : 'OUTWARD'),
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
          <h1 className="text-2xl font-bold text-gray-900">Job Work Report</h1>
          <p className="text-sm text-gray-500 mt-1">Material sent to vendors for processing</p>
        </div>
        <div className="flex items-center gap-2">
          {orders.length > 0 && (
            <ProfessionalExportButton
              meta={exportMeta}
              sheets={[summarySheet, ledgerDetailSheet]}
              filenameBase="Job_Work_Report"
              successMessage="Job Work Report exported successfully."
              errorMessage="Unable to export the Job Work Report. Please try again."
            />
          )}
          <PrintButton />
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Job Work Report</h1>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select name="status" defaultValue={params.status || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="dispatched">Dispatched</option>
              <option value="partially_returned">Partially Returned</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Dispatch From</label>
            <input type="date" name="from" defaultValue={fromDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Dispatch To</label>
            <input type="date" name="to" defaultValue={toDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Apply</button>
        </div>
      </form>

      {/* Summary */}
      <div className="grid grid-cols-5 gap-4">
        <div className="rounded-xl border bg-purple-50 p-4">
          <p className="text-xs text-gray-500">Total Sent</p>
          <p className="text-xl font-bold text-purple-800">{totalSent.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-green-50 p-4">
          <p className="text-xs text-gray-500">Total Received</p>
          <p className="text-xl font-bold text-green-800">{totalReceived.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-yellow-50 p-4">
          <p className="text-xs text-gray-500">Pending</p>
          <p className="text-xl font-bold text-yellow-800">{totalPending.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-teal-50 p-4">
          <p className="text-xs text-gray-500">Sent Value</p>
          <p className="text-xl font-bold text-teal-800">{fmtC(totalSentValue)}</p>
        </div>
        <div className="rounded-xl border bg-amber-50 p-4">
          <p className="text-xs text-gray-500">Pending Value</p>
          <p className="text-xl font-bold text-amber-800">{fmtC(totalPendingValue)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          {orders.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No job work orders found for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <JobWorkReportRows orders={orders} rateFor={rateFor} />
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-700" colSpan={7}>Total</td>
                  <td className="px-4 py-3 text-right">{totalSent.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right text-green-700">{totalReceived.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right text-yellow-700">{totalPending.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right text-gray-400">—</td>
                  <td className="px-4 py-3 text-right text-teal-800">{fmtC(totalSentValue)}</td>
                  <td className="px-4 py-3 text-right text-amber-800">{fmtC(totalPendingValue)}</td>
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
