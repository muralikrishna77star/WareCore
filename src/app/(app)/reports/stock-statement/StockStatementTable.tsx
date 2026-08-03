'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'

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

  return (
    <table className="w-full text-sm whitespace-nowrap">
      <thead className="sticky top-0 z-10">
        <tr className="border-b text-xs font-semibold uppercase">
          <th className="px-2 py-3 w-8 bg-white" />
          <th className="px-4 py-3 text-left text-gray-600 bg-white">Item Name</th>
          <th className="px-4 py-3 text-left text-gray-400 bg-white">Unit</th>
          {/* Opening */}
          <th className="px-4 py-3 text-right text-blue-700 bg-blue-50">Opening (Wh)</th>
          <th className="px-4 py-3 text-right text-amber-700 bg-amber-50">Opening (Vendor)</th>
          {/* IN columns */}
          <th className="px-4 py-3 text-right text-green-700 bg-green-50">Purchase In</th>
          {/* Job Work Out sits right after Purchase In — mirrors the purchase → sent-for-job-work flow */}
          <th className="px-4 py-3 text-right text-red-700 bg-red-50">Job Work Out</th>
          <th className="px-4 py-3 text-right text-green-700 bg-green-50">Transfer In</th>
          <th className="px-4 py-3 text-right text-green-700 bg-green-50">JW Return</th>
          <th className="px-4 py-3 text-right text-green-700 bg-green-50">Other In</th>
          {/* OUT columns */}
          <th className="px-4 py-3 text-right text-red-700 bg-red-50">Dispatch</th>
          <th className="px-4 py-3 text-right text-red-700 bg-red-50">Transfer Out</th>
          <th className="px-4 py-3 text-right text-red-700 bg-red-50">Other Out</th>
          {/* Closing, as on To Date */}
          <th className="px-4 py-3 text-right text-gray-800 bg-gray-100">Stock at Warehouse</th>
          <th className="px-4 py-3 text-right text-amber-700 bg-amber-50">Stock at Vendor</th>
          <th className="px-4 py-3 text-right text-indigo-700 bg-indigo-50">Total Available</th>
          {/* Valuation */}
          <th className="px-4 py-3 text-right text-teal-700 bg-teal-50">Avg Rate</th>
          <th className="px-4 py-3 text-right text-teal-700 bg-teal-50">Value</th>
        </tr>
      </thead>

      <tbody className="divide-y divide-gray-100">
        {rows.map((item) => {
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
                  {item.stockAtWarehouse < 0 && <span title="Negative stock — data-quality warning" className="ml-1">⚠️</span>}
                </td>
                <td className={`px-4 py-3 text-right font-bold bg-amber-50/60 ${item.stockAtVendor < 0 ? 'text-red-600' : 'text-amber-800'}`}>
                  {fmtQ(item.stockAtVendor)}
                  {item.stockAtVendor < 0 && <span title="Negative stock — data-quality warning" className="ml-1">⚠️</span>}
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
                        className="mb-3 text-xs font-medium text-blue-600 hover:underline"
                      >
                        View Transactions for this item →
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
