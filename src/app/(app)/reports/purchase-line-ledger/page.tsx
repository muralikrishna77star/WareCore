export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_LINE_LEDGER_QUERY, ALL_PURCHASE_LINE_IDS_QUERY } from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

const entryTypeConfig: Record<string, { label: string; color: string }> = {
  PURCHASE_IN: { label: 'Purchase In', color: 'bg-green-100 text-green-800' },
  VENDOR_RETURN_IN: { label: 'Vendor Return In', color: 'bg-green-100 text-green-800' },
  SALE_OUT: { label: 'Sale / Dispatch', color: 'bg-red-100 text-red-800' },
  SALE_CANCEL: { label: 'Sale Cancelled', color: 'bg-gray-100 text-gray-700' },
  PURCHASE_CANCEL: { label: 'Purchase Cancelled', color: 'bg-gray-100 text-gray-700' },
  TRANSFER_OUT: { label: 'Transfer Out', color: 'bg-orange-100 text-orange-800' },
  TRANSFER_IN: { label: 'Transfer In', color: 'bg-blue-100 text-blue-800' },
  JOB_WORK_OUT: { label: 'Job Work Out', color: 'bg-purple-100 text-purple-800' },
  JOB_WORK_RETURN_IN: { label: 'Job Work Return In', color: 'bg-teal-100 text-teal-800' },
  JOB_WORK_OUTPUT_IN: { label: 'Job Work Output In', color: 'bg-teal-100 text-teal-800' },
  JOB_WORK_CANCEL: { label: 'Job Work Cancelled', color: 'bg-gray-100 text-gray-700' },
  ADJUSTMENT_IN: { label: 'Adjustment In', color: 'bg-gray-100 text-gray-800' },
  ADJUSTMENT_OUT: { label: 'Adjustment Out', color: 'bg-gray-100 text-gray-800' },
}

// Maps stock_ledger.reference_type to the detail page for that record
const referenceBasePath: Record<string, string> = {
  purchase_bill: '/bills',
  dispatch: '/dispatch',
  job_work: '/jobwork',
  transfer: '/transfers',
}

type LedgerEntry = {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number?: string | null
  reference_type?: string | null
  reference_id?: string | null
  sub_purchase_line_id?: string | null
  size_label?: string | null
  notes?: string | null
  companies?: { name: string; code: string } | null
  warehouses?: { name: string } | null
  material_types?: { description: string; unit: string } | null
  material_sizes?: { size_label: string } | null
}

export default async function PurchaseLineLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string }>
}) {
  const params = await searchParams
  const lineId = (params.line || '').trim()

  const [lineIdsResult, entriesResult] = await Promise.all([
    hasuraQuery(ALL_PURCHASE_LINE_IDS_QUERY),
    lineId
      ? hasuraQuery(PURCHASE_LINE_LEDGER_QUERY, { purchase_line_id: lineId })
      : Promise.resolve({ entries: [] }),
  ])

  const allLineIds: string[] = Array.from(
    new Set(
      ((lineIdsResult.purchase_bill_items ?? []) as { purchase_line_id: string | null }[])
        .map((r) => r.purchase_line_id)
        .filter((id): id is string => !!id)
    )
  ).sort()

  const entries: LedgerEntry[] = entriesResult.entries ?? []

  let running = 0
  const rows = entries.map((e) => {
    running += Number(e.quantity)
    return { ...e, balance: running }
  })
  const currentBalance = running

  const totalIn = entries
    .filter((e) => Number(e.quantity) > 0)
    .reduce((s, e) => s + Number(e.quantity), 0)
  const totalOut = entries
    .filter((e) => Number(e.quantity) < 0)
    .reduce((s, e) => s + Math.abs(Number(e.quantity)), 0)

  const first = entries[0]
  const materialLabel = first?.material_types?.description
  const sizeLabel = first?.material_sizes?.size_label || first?.size_label
  const unit = first?.material_types?.unit || 'MT'

  const fmtQ = (n: number) => n.toFixed(3)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Line Movements</h1>
          <p className="text-sm text-gray-500 mt-1">
            Full traceability of every movement (in &amp; out) for a single Purchase Line ID
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lineId && <PrintButton />}
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Purchase Line Movements</h1>
        {lineId && <p className="text-sm text-gray-700 font-mono font-medium">{lineId}</p>}
      </div>

      {/* Filter */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[16rem]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Purchase Line ID *</label>
            <input
              type="text"
              name="line"
              list="purchase-line-ids"
              defaultValue={lineId}
              placeholder="e.g. HR0625-0001"
              autoComplete="off"
              className="rounded border border-gray-300 px-2 py-1.5 text-sm font-mono w-full focus:border-blue-500 focus:outline-none"
            />
            <datalist id="purchase-line-ids">
              {allLineIds.map((id) => <option key={id} value={id} />)}
            </datalist>
          </div>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            View
          </button>
        </div>
      </form>

      {!lineId ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <p className="text-4xl mb-3">🔎</p>
          <p className="text-gray-500 text-sm">Enter a Purchase Line ID above to view its full movement history.</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <p className="text-4xl mb-3">🤷</p>
          <p className="text-gray-500 text-sm">No stock ledger entries found for purchase line <span className="font-mono font-medium">{lineId}</span>.</p>
        </div>
      ) : (
        <>
          {/* Line header */}
          <div className="rounded-xl border bg-white p-4 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-semibold text-gray-900 font-mono">{lineId}</p>
              <p className="text-sm text-gray-500">
                {materialLabel || '—'}{sizeLabel ? ` (${sizeLabel})` : ''} · Unit: {unit}
              </p>
            </div>
            <p className="text-sm text-gray-500">{rows.length} movement{rows.length !== 1 ? 's' : ''}</p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-green-50 p-4">
              <p className="text-xs text-gray-500">Total In</p>
              <p className="text-xl font-bold text-green-700">+{fmtQ(totalIn)}</p>
            </div>
            <div className="rounded-xl border bg-red-50 p-4">
              <p className="text-xs text-gray-500">Total Out</p>
              <p className="text-xl font-bold text-red-700">-{fmtQ(totalOut)}</p>
            </div>
            <div className="rounded-xl border bg-blue-50 p-4">
              <p className="text-xs text-gray-500">Current Balance</p>
              <p className={`text-xl font-bold ${currentBalance < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                {fmtQ(currentBalance)}
              </p>
            </div>
          </div>

          {/* Movements table */}
          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
              <span className="font-semibold text-gray-700 text-sm">Movement History</span>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Reference</th>
                    <th className="px-4 py-3 text-left">Linked Line ID</th>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-left">Warehouse</th>
                    <th className="px-4 py-3 text-right">In</th>
                    <th className="px-4 py-3 text-right">Out</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => {
                    const cfg = entryTypeConfig[row.entry_type] ?? { label: row.entry_type, color: 'bg-gray-100 text-gray-800' }
                    const qty = Number(row.quantity)
                    const basePath = row.reference_type ? referenceBasePath[row.reference_type] : undefined
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(row.entry_date)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {basePath && row.reference_id ? (
                            <Link href={`${basePath}/${row.reference_id}`} className="text-blue-600 hover:underline">
                              {row.reference_number || '—'}
                            </Link>
                          ) : (
                            row.reference_number || '—'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.sub_purchase_line_id ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {row.sub_purchase_line_id}
                            </span>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{row.companies?.name || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{row.warehouses?.name || '—'}</td>
                        <td className="px-4 py-3 text-right text-green-700 font-medium">{qty > 0 ? fmtQ(qty) : ''}</td>
                        <td className="px-4 py-3 text-right text-red-600 font-medium">{qty < 0 ? fmtQ(Math.abs(qty)) : ''}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${row.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {fmtQ(row.balance)}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{row.notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-sm">
                    <td className="px-4 py-3 text-gray-700" colSpan={6}>Current Balance</td>
                    <td className="px-4 py-3 text-right text-green-800">+{fmtQ(totalIn)}</td>
                    <td className="px-4 py-3 text-right text-red-800">-{fmtQ(totalOut)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${currentBalance < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {fmtQ(currentBalance)}
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
