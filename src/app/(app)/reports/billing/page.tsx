export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { BILLING_REPORT_QUERY, MOVEMENTS_REPORT_QUERY, ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY } from '@/lib/hasura/queries'
import { fetchPurchaseLineRateMap } from '@/lib/purchaseLineRates'
import { PrintButton } from '@/components/PrintButton'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'

const LEDGER_TYPE_LABELS: Record<string, string> = {
  PURCHASE_IN: 'Purchase In',
  PURCHASE_CANCEL: 'Purchase Cancelled',
}

export default async function BillingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; warehouse?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const conditions: Record<string, unknown>[] = [
    { bill_date: { _gte: fromDate } },
    { bill_date: { _lte: toDate } },
  ]
  if (params.company) conditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) conditions.push({ warehouse_id: { _eq: params.warehouse } })

  const [result, compResult, whResult] = await Promise.all([
    hasuraQuery(BILLING_REPORT_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
  ])

  const bills: any[] = result.purchase_bills ?? []
  const companies: any[] = compResult.companies ?? []
  const allWarehouses: any[] = whResult.warehouses ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w: any) => w.company_id === params.company)
    : allWarehouses

  const totalQty = bills.reduce((s, b) => s + Number(b.total_quantity || 0), 0)
  const totalAmt = bills.reduce((s, b) => s + Number(b.total_amount || 0), 0)

  // Ledger Detail: the actual PURCHASE_IN/PURCHASE_CANCEL stock_ledger rows
  // these bills produced — real transaction-level traceability. No running
  // balance: mixed items/warehouses have no single meaningful one.
  const billIds = bills.map((b: any) => b.id)
  const ledgerResult = billIds.length > 0
    ? await hasuraQuery(MOVEMENTS_REPORT_QUERY, {
        where: { _and: [{ reference_type: { _eq: 'purchase_bill' } }, { reference_id: { _in: billIds } }] },
      })
    : { stock_ledger: [] }
  const ledgerRows: any[] = ledgerResult.stock_ledger ?? []
  const ledgerRateMap = await fetchPurchaseLineRateMap(ledgerRows.map((m: any) => m.purchase_line_id))

  const exportMeta = {
    companyName: companies.find((c: any) => c.id === params.company)?.name || 'All Companies',
    fromDate,
    toDate,
    filterLine: `Warehouse: ${warehouses.find((w: any) => w.id === params.warehouse)?.name || 'All Warehouses'}`,
    generatedBy: '',
  }
  const summarySheet: ProfessionalSheetSpec = {
    sheetName: 'Billing',
    title: 'Billing Report',
    emptyMessage: 'No bills found for the selected period.',
    columns: [
      { header: 'Bill No.', key: 'billNo', width: 16, align: 'left' },
      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
      { header: 'Supplier', key: 'supplier', width: 20, align: 'left' },
      { header: 'Company', key: 'company', width: 16, align: 'left' },
      { header: 'Warehouse', key: 'warehouse', width: 16, align: 'left' },
      { header: 'Material', key: 'material', width: 20, align: 'left' },
      { header: 'Size', key: 'size', width: 12, align: 'left' },
      { header: 'Qty (T)', key: 'qty', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Amount (₹)', key: 'amount', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
    ],
    rows: bills.flatMap((bill: any) => {
      const items = bill.purchase_bill_items ?? []
      const base = {
        billNo: bill.bill_number,
        date: bill.bill_date,
        supplier: bill.suppliers?.name || '',
        company: bill.companies?.name || '',
        warehouse: bill.warehouses?.name || '',
      }
      if (items.length === 0) {
        return [{ ...base, material: '', size: '', qty: null, rate: null, amount: null }]
      }
      return items.map((item: any) => ({
        ...base,
        material: item.material_types?.description || '',
        size: item.material_sizes?.size_label ?? item.size_label ?? '',
        qty: Number(item.quantity),
        rate: item.rate ? Number(item.rate) : null,
        amount: item.amount ? Number(item.amount) : null,
      }))
    }),
  }
  const ledgerDetailSheet: ProfessionalSheetSpec = {
    sheetName: 'Ledger Detail',
    title: 'Billing Report — Ledger Detail',
    emptyMessage: 'No stock ledger entries found for the selected bills.',
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
    rows: ledgerRows.map((m: any, idx: number) => {
      const qty = Number(m.quantity)
      const rate = m.purchase_line_id ? ledgerRateMap.get(m.purchase_line_id) ?? null : null
      return {
        sno: idx + 1,
        date: m.entry_date,
        type: LEDGER_TYPE_LABELS[m.entry_type] ?? m.entry_type,
        stockMovement: m.entry_type === 'PURCHASE_IN' ? 'INWARD' : 'OUTWARD',
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing Report</h1>
          <p className="text-sm text-gray-500 mt-1">Purchase bills with item details</p>
        </div>
        <div className="flex items-center gap-2">
          {bills.length > 0 && (
            <ProfessionalExportButton
              meta={exportMeta}
              sheets={[summarySheet, ledgerDetailSheet]}
              filenameBase="Billing_Report"
              successMessage="Billing Report exported successfully."
              errorMessage="Unable to export the Billing Report. Please try again."
            />
          )}
          <PrintButton />
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      {/* Print-only title */}
      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Billing / Purchase Report</h1>
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select name="company" defaultValue={params.company || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Companies</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
            <select name="warehouse" defaultValue={params.warehouse || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Warehouses</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
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
      <div className="grid grid-cols-3 gap-4 print:grid-cols-3">
        <div className="rounded-xl border bg-green-50 p-4">
          <p className="text-xs text-gray-500">Total Bills</p>
          <p className="text-xl font-bold text-green-800">{bills.length}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 p-4">
          <p className="text-xs text-gray-500">Total Quantity</p>
          <p className="text-xl font-bold text-blue-800">{totalQty.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-purple-50 p-4">
          <p className="text-xs text-gray-500">Total Amount</p>
          <p className="text-xl font-bold text-purple-800">₹{totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{bills.length} bill{bills.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          {bills.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No bills found for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <th className="px-4 py-3 text-left">Bill No.</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">Warehouse</th>
                  <th className="px-4 py-3 text-left">Material</th>
                  <th className="px-4 py-3 text-left">Size</th>
                  <th className="px-4 py-3 text-right">Qty (T)</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bills.map((bill: any) => {
                  const items = bill.purchase_bill_items ?? []
                  if (items.length === 0) {
                    return (
                      <tr key={bill.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-blue-700">{bill.bill_number}</td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(bill.bill_date)}</td>
                        <td className="px-4 py-3">{bill.suppliers?.name}</td>
                        <td className="px-4 py-3">{bill.companies?.name}</td>
                        <td className="px-4 py-3">{bill.warehouses?.name}</td>
                        <td className="px-4 py-3 text-gray-400" colSpan={4}>No items</td>
                      </tr>
                    )
                  }
                  return items.map((item: any, idx: number) => (
                    <tr key={`${bill.id}-${idx}`} className="hover:bg-gray-50">
                      {idx === 0 && (
                        <>
                          <td className="px-4 py-3 font-medium text-blue-700" rowSpan={items.length}>{bill.bill_number}</td>
                          <td className="px-4 py-3 text-gray-600" rowSpan={items.length}>{formatDate(bill.bill_date)}</td>
                          <td className="px-4 py-3" rowSpan={items.length}>{bill.suppliers?.name}</td>
                          <td className="px-4 py-3" rowSpan={items.length}>{bill.companies?.name}</td>
                          <td className="px-4 py-3" rowSpan={items.length}>{bill.warehouses?.name}</td>
                        </>
                      )}
                      <td className="px-4 py-3 font-medium">{item.material_types?.description}</td>
                      <td className="px-4 py-3 text-gray-500">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                      <td className="px-4 py-3 text-right">{Number(item.quantity).toFixed(3)}</td>
                      <td className="px-4 py-3 text-right">{item.rate ? `₹${Number(item.rate).toLocaleString('en-IN')}` : '—'}</td>
                      <td className="px-4 py-3 text-right">{item.amount ? `₹${Number(item.amount).toLocaleString('en-IN')}` : '—'}</td>
                    </tr>
                  ))
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-700" colSpan={7}>Total</td>
                  <td className="px-4 py-3 text-right">{totalQty.toFixed(3)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right">₹{totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
