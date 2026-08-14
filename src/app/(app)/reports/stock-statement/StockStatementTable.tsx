'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { TriangleAlert, ArrowRight } from 'lucide-react'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

export type BreakdownEntry = { name: string; qty: number }

export type StatementRow = {
  key: string
  itemName: string
  unit: string
  openingWarehouse: number
  openingWarehouseHref: string | null
  openingVendor: number
  purchaseIn: number
  purchaseInHref: string | null
  jwOut: number
  jwOutHref: string | null
  transferIn: number
  transferInHref: string | null
  jwReturn: number
  jwReturnHref: string | null
  dispatch: number
  dispatchHref: string | null
  transferOut: number
  transferOutHref: string | null
  otherIn: number
  otherOut: number
  stockAtWarehouse: number
  stockAtWarehouseHref: string | null
  stockAtVendor: number
  totalAvailable: number
  rate: number
  value: number
  warehouseBreakdown: BreakdownEntry[]
  vendorBreakdown: BreakdownEntry[]
}

export type StatementTotals = {
  openingWarehouse: number
  openingVendor: number
  purchase_in: number
  transfer_in: number
  jw_return: number
  other_in: number
  transfer_out: number
  dispatch_out: number
  jw_out: number
  other_out: number
  warehouse: number
  vendor: number
  value: number
}

const fmtQ = (n: number) => n.toFixed(3)
const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

function Cell({ value, href, className }: { value: number; href: string | null; className: string }) {
  const text = value !== 0 ? fmtQ(value) : '—'
  return (
    <td className={className}>
      {value !== 0 && href ? <Link href={href} className="hover:underline">{text}</Link> : text}
    </td>
  )
}

function BreakdownTable({ title, unit, rows }: { title: string; unit: string; rows: BreakdownEntry[] }) {
  return (
    <div className="min-w-[16rem] flex-1">
      <p className="mb-1.5 text-xs font-semibold text-gray-600">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 px-2">None</p>
      ) : (
        <table className="w-full text-xs border rounded-lg overflow-hidden bg-white">
          <thead>
            <tr className="bg-gray-100 text-left text-gray-500 uppercase">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="px-3 py-2 text-gray-700">{r.name}</td>
                <td className={`px-3 py-2 text-right font-medium ${r.qty < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {fmtQ(r.qty)} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function StockStatementTable({
  rows,
  totals,
  onViewTransactions,
}: {
  rows: StatementRow[]
  totals: StatementTotals
  onViewTransactions?: (key: string, label: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(rows, {
    itemName: (r) => r.itemName,
    unit: (r) => r.unit,
    openingWarehouse: (r) => r.openingWarehouse,
    openingVendor: (r) => r.openingVendor,
    purchaseIn: (r) => r.purchaseIn,
    jwOut: (r) => r.jwOut,
    transferIn: (r) => r.transferIn,
    jwReturn: (r) => r.jwReturn,
    otherIn: (r) => r.otherIn,
    dispatch: (r) => r.dispatch,
    transferOut: (r) => r.transferOut,
    otherOut: (r) => r.otherOut,
    stockAtWarehouse: (r) => r.stockAtWarehouse,
    stockAtVendor: (r) => r.stockAtVendor,
    totalAvailable: (r) => r.totalAvailable,
    rate: (r) => r.rate,
    value: (r) => r.value,
  })

  return (
    <table className="w-full text-sm whitespace-nowrap">
      <thead className="sticky top-0 z-10">
        <tr className="border-b text-xs font-semibold uppercase">
          <th className="px-2 py-3 w-8 bg-white" />
          <SortableTh label="Item Name" sortKey="itemName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-4 !py-3 !text-gray-600 bg-white" />
          <SortableTh label="Unit" sortKey="unit" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-4 !py-3 !text-gray-400 bg-white" />
          {/* Opening */}
          <SortableTh label="Opening (Wh)" sortKey="openingWarehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-blue-700 bg-blue-50" />
          <SortableTh label="Opening (Vendor)" sortKey="openingVendor" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-amber-700 bg-amber-50" />
          {/* IN columns */}
          <SortableTh label="Purchase In" sortKey="purchaseIn" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-green-700 bg-green-50" />
          {/* Job Work Out sits right after Purchase In — mirrors the purchase → sent-for-job-work flow */}
          <SortableTh label="Job Work Out" sortKey="jwOut" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-red-700 bg-red-50" />
          <SortableTh label="Transfer In" sortKey="transferIn" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-green-700 bg-green-50" />
          <SortableTh label="JW Return" sortKey="jwReturn" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-green-700 bg-green-50" />
          <SortableTh label="Other In" sortKey="otherIn" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-green-700 bg-green-50" />
          {/* OUT columns */}
          <SortableTh label="Dispatch" sortKey="dispatch" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-red-700 bg-red-50" />
          <SortableTh label="Transfer Out" sortKey="transferOut" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-red-700 bg-red-50" />
          <SortableTh label="Other Out" sortKey="otherOut" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-red-700 bg-red-50" />
          {/* Closing, as on To Date */}
          <SortableTh label="Stock at Warehouse" sortKey="stockAtWarehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-gray-800 bg-gray-100" />
          <SortableTh label="Stock at Vendor" sortKey="stockAtVendor" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-amber-700 bg-amber-50" />
          <SortableTh label="Total Available" sortKey="totalAvailable" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-indigo-700 bg-indigo-50" />
          {/* Valuation */}
          <SortableTh label="Avg Rate" sortKey="rate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-teal-700 bg-teal-50" />
          <SortableTh label="Value" sortKey="value" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-4 !py-3 !text-teal-700 bg-teal-50" />
        </tr>
      </thead>

      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((item) => {
          const isOpen = expanded.has(item.key)
          return (
            <Fragment key={item.key}>
              <tr onClick={() => toggle(item.key)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-2 py-3 text-gray-400 text-center">
                  <span className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{item.itemName}</td>
                <td className="px-4 py-3 text-gray-400">{item.unit}</td>
                <td className="px-4 py-3 text-right text-blue-700 bg-blue-50/40">
                  {item.openingWarehouseHref ? <Link href={item.openingWarehouseHref} className="hover:underline">{fmtQ(item.openingWarehouse)}</Link> : fmtQ(item.openingWarehouse)}
                </td>
                <td className={`px-4 py-3 text-right bg-amber-50/40 ${item.openingVendor < 0 ? 'text-red-600' : 'text-amber-700'}`}>
                  {fmtQ(item.openingVendor)}
                </td>
                <Cell value={item.purchaseIn} href={item.purchaseInHref} className="px-4 py-3 text-right text-green-700 bg-green-50/40" />
                <Cell value={item.jwOut} href={item.jwOutHref} className="px-4 py-3 text-right text-red-700 bg-red-50/40" />
                <Cell value={item.transferIn} href={item.transferInHref} className="px-4 py-3 text-right text-green-700 bg-green-50/40" />
                <Cell value={item.jwReturn} href={item.jwReturnHref} className="px-4 py-3 text-right text-green-700 bg-green-50/40" />
                <td className="px-4 py-3 text-right text-green-700 bg-green-50/40">{item.otherIn !== 0 ? fmtQ(item.otherIn) : '—'}</td>
                <Cell value={item.dispatch} href={item.dispatchHref} className="px-4 py-3 text-right text-red-700 bg-red-50/40" />
                <Cell value={item.transferOut} href={item.transferOutHref} className="px-4 py-3 text-right text-red-700 bg-red-50/40" />
                <td className="px-4 py-3 text-right text-red-700 bg-red-50/40">{item.otherOut !== 0 ? fmtQ(item.otherOut) : '—'}</td>
                <td className={`px-4 py-3 text-right font-bold bg-gray-100/60 ${item.stockAtWarehouse < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {item.stockAtWarehouseHref ? <Link href={item.stockAtWarehouseHref} className="hover:underline">{fmtQ(item.stockAtWarehouse)}</Link> : fmtQ(item.stockAtWarehouse)}
                  {item.stockAtWarehouse < 0 && <span title="Negative stock — data-quality warning" className="ml-1 inline-block"><TriangleAlert className="inline h-3.5 w-3.5" /></span>}
                </td>
                <td className={`px-4 py-3 text-right font-bold bg-amber-50/60 ${item.stockAtVendor < 0 ? 'text-red-600' : 'text-amber-800'}`}>
                  {fmtQ(item.stockAtVendor)}
                  {item.stockAtVendor < 0 && <span title="Negative stock — data-quality warning" className="ml-1 inline-block"><TriangleAlert className="inline h-3.5 w-3.5" /></span>}
                </td>
                <td className={`px-4 py-3 text-right font-bold bg-indigo-50/60 ${item.totalAvailable < 0 ? 'text-red-600' : 'text-indigo-800'}`}>
                  {fmtQ(item.totalAvailable)}
                </td>
                <td className="px-4 py-3 text-right text-teal-700 bg-teal-50/40">
                  {item.rate ? fmtC(item.rate) : '—'}
                </td>
                <td className={`px-4 py-3 text-right font-bold bg-teal-50/60 ${item.value < 0 ? 'text-red-600' : 'text-teal-800'}`}>
                  {item.rate ? fmtC(item.value) : '—'}
                </td>
              </tr>
              {isOpen && (
                <tr key={`${item.key}-detail`} className="bg-gray-50/60">
                  <td colSpan={18} className="px-4 py-3">
                    {onViewTransactions && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onViewTransactions(item.key, item.itemName) }}
                        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                      >
                        View Transactions for this item <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {item.warehouseBreakdown.length === 0 && item.vendorBreakdown.length === 0 ? (
                      <p className="text-xs text-gray-400 px-2">No stock at any warehouse or vendor as on the To Date.</p>
                    ) : (
                      <div className="flex flex-wrap gap-6">
                        <BreakdownTable title="Stock by Warehouse (as on To Date)" unit={item.unit} rows={item.warehouseBreakdown} />
                        <BreakdownTable title="Stock by Vendor (as on To Date)" unit={item.unit} rows={item.vendorBreakdown} />
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>

      {/* Totals */}
      <tfoot>
        <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-sm">
          <td className="px-4 py-3 text-gray-700" colSpan={3}>Total</td>
          <td className="px-4 py-3 text-right text-blue-800">{fmtQ(totals.openingWarehouse)}</td>
          <td className="px-4 py-3 text-right text-amber-800">{fmtQ(totals.openingVendor)}</td>
          <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.purchase_in)}</td>
          <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.jw_out)}</td>
          <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.transfer_in)}</td>
          <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.jw_return)}</td>
          <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.other_in)}</td>
          <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.dispatch_out)}</td>
          <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.transfer_out)}</td>
          <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.other_out)}</td>
          <td className={`px-4 py-3 text-right font-bold ${totals.warehouse < 0 ? 'text-red-700' : 'text-gray-900'}`}>
            {fmtQ(totals.warehouse)}
          </td>
          <td className={`px-4 py-3 text-right font-bold ${totals.vendor < 0 ? 'text-red-700' : 'text-amber-800'}`}>
            {fmtQ(totals.vendor)}
          </td>
          <td className={`px-4 py-3 text-right font-bold ${totals.warehouse + totals.vendor < 0 ? 'text-red-700' : 'text-indigo-800'}`}>
            {fmtQ(totals.warehouse + totals.vendor)}
          </td>
          <td className="px-4 py-3 text-right text-gray-400">—</td>
          <td className={`px-4 py-3 text-right font-bold ${totals.value < 0 ? 'text-red-700' : 'text-teal-800'}`}>
            {fmtC(totals.value)}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
