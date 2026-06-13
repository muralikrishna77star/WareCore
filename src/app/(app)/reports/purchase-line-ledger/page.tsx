export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_LINE_LEDGER_QUERY, ALL_PURCHASE_LINE_IDS_QUERY, ACTIVE_ITEM_MASTER_QUERY } from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import { SearchForm, type ItemOption, type PurchaseLineRef } from './SearchForm'
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
  material_type_id?: string | null
  material_size_id?: string | null
  companies?: { name: string; code: string } | null
  warehouses?: { name: string } | null
  material_types?: { description: string; unit: string } | null
  material_sizes?: { size_label: string } | null
}

export default async function PurchaseLineLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string; item?: string }>
}) {
  const params = await searchParams
  const lineId = (params.line || '').trim()
  const itemId = params.item || ''

  const [lineIdsResult, itemResult, entriesResult] = await Promise.all([
    hasuraQuery(ALL_PURCHASE_LINE_IDS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    lineId
      ? hasuraQuery(PURCHASE_LINE_LEDGER_QUERY, { purchase_line_id: lineId })
      : Promise.resolve({ entries: [] }),
  ])

  const purchaseLines: PurchaseLineRef[] = (
    (lineIdsResult.purchase_bill_items ?? []) as {
      purchase_line_id: string | null
      material_type_id: string | null
      material_size_id: string | null
    }[]
  )
    .filter((r): r is PurchaseLineRef => !!r.purchase_line_id)

  type ItemMasterRow = {
    id: string
    item_code: string
    item_name: string
    material_type_id: string
    material_size_id: string | null
    size_label?: string | null
    material_sizes?: { size_label: string } | null
  }
  const itemRows: ItemMasterRow[] = itemResult.item_master ?? []
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
  const selectedItem = itemId ? itemOptions.find((i) => i.id === itemId) : undefined

  const itemLookup = new Map<string, { item_code: string; item_name: string }>()
  for (const i of itemRows) {
    itemLookup.set(`${i.material_type_id}|${i.material_size_id ?? ''}`, { item_code: i.item_code, item_name: i.item_name })
  }
  const itemLabelFor = (row: Pick<LedgerEntry, 'material_type_id' | 'material_size_id' | 'material_types'>) => {
    const info = itemLookup.get(`${row.material_type_id ?? ''}|${row.material_size_id ?? ''}`)
    return info ? `${info.item_code} — ${info.item_name}` : row.material_types?.description || '—'
  }

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
  const itemLabel = first ? itemLabelFor(first) : null
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
        <SearchForm
          items={itemOptions}
          purchaseLines={purchaseLines}
          defaultItemId={itemId}
          defaultItemLabel={selectedItem?.label || ''}
          defaultLine={lineId}
        />
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
          <div className="rounded-xl border bg-white px-4 py-2 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-semibold text-gray-900 font-mono text-sm">{lineId}</p>
              <p className="text-xs text-gray-500">
                {itemLabel || '—'}{sizeLabel ? ` (${sizeLabel})` : ''} · Unit: {unit}
                <span className="ml-1 text-gray-400">— originating item, may differ after job work conversion</span>
              </p>
            </div>
            <p className="text-xs text-gray-500">{rows.length} movement{rows.length !== 1 ? 's' : ''}</p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-green-50 px-3 py-2">
              <p className="text-xs text-gray-500">Total In</p>
              <p className="text-base font-bold text-green-700">+{fmtQ(totalIn)}</p>
            </div>
            <div className="rounded-lg border bg-red-50 px-3 py-2">
              <p className="text-xs text-gray-500">Total Out</p>
              <p className="text-base font-bold text-red-700">-{fmtQ(totalOut)}</p>
            </div>
            <div className="rounded-lg border bg-blue-50 px-3 py-2">
              <p className="text-xs text-gray-500">Current Balance</p>
              <p className={`text-base font-bold ${currentBalance < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                {fmtQ(currentBalance)}
              </p>
            </div>
          </div>

          {/* Movements table */}
          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-4 py-1.5 border-b bg-gray-50 flex justify-between items-center">
              <span className="font-semibold text-gray-700 text-xs">Movement History</span>
            </div>
            <div className="overflow-auto max-h-[80vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-gray-50 text-[11px] uppercase text-gray-500">
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Type</th>
                    <th className="px-2 py-1.5 text-left">Item</th>
                    <th className="px-2 py-1.5 text-left">Reference</th>
                    <th className="px-2 py-1.5 text-left">Linked Line ID</th>
                    <th className="px-2 py-1.5 text-left">Company</th>
                    <th className="px-2 py-1.5 text-left">Warehouse</th>
                    <th className="px-2 py-1.5 text-right">In</th>
                    <th className="px-2 py-1.5 text-right">Out</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                    <th className="px-2 py-1.5 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => {
                    const cfg = entryTypeConfig[row.entry_type] ?? { label: row.entry_type, color: 'bg-gray-100 text-gray-800' }
                    const qty = Number(row.quantity)
                    const basePath = row.reference_type ? referenceBasePath[row.reference_type] : undefined
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{formatDate(row.entry_date)}</td>
                        <td className="px-2 py-1">
                          <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-gray-700 whitespace-nowrap">
                          {itemLabelFor(row)}
                          {(row.material_sizes?.size_label || row.size_label) && (
                            <span className="ml-1 text-[11px] text-gray-400">({row.material_sizes?.size_label || row.size_label})</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-gray-500 text-[11px] whitespace-nowrap">
                          {basePath && row.reference_id ? (
                            <Link href={`${basePath}/${row.reference_id}`} className="text-blue-600 hover:underline">
                              {row.reference_number || '—'}
                            </Link>
                          ) : (
                            row.reference_number || '—'
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {row.sub_purchase_line_id ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {row.sub_purchase_line_id}
                            </span>
                          ) : <span className="text-[11px] text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-1 text-gray-700">{row.companies?.name || '—'}</td>
                        <td className="px-2 py-1 text-gray-500">{row.warehouses?.name || '—'}</td>
                        <td className="px-2 py-1 text-right text-green-700 font-medium">{qty > 0 ? fmtQ(qty) : ''}</td>
                        <td className="px-2 py-1 text-right text-red-600 font-medium">{qty < 0 ? fmtQ(Math.abs(qty)) : ''}</td>
                        <td className={`px-2 py-1 text-right font-semibold ${row.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {fmtQ(row.balance)}
                        </td>
                        <td className="px-2 py-1 text-gray-500 text-[11px]">{row.notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-xs">
                    <td className="px-2 py-1.5 text-gray-700" colSpan={7}>Current Balance</td>
                    <td className="px-2 py-1.5 text-right text-green-800">+{fmtQ(totalIn)}</td>
                    <td className="px-2 py-1.5 text-right text-red-800">-{fmtQ(totalOut)}</td>
                    <td className={`px-2 py-1.5 text-right font-bold ${currentBalance < 0 ? 'text-red-700' : 'text-gray-900'}`}>
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
