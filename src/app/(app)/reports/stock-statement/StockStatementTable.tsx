'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'

export type BreakdownEntry = { name: string; qty: number }

export type StatementRow = {
  key: string
  itemName: string
  unit: string
  opening: number
  openingHref: string | null
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
  closing: number
  closingHref: string | null
  atVendor: number
  liveStock: number
  liveHref: string | null
  rate: number
  value: number
  warehouseBreakdown: BreakdownEntry[]
  vendorBreakdown: BreakdownEntry[]
}

export type StatementTotals = {
  opening: number
  purchase_in: number
  transfer_in: number
  jw_return: number
  transfer_out: number
  dispatch_out: number
  jw_out: number
  closing: number
  at_vendor: number
  current_stock: number
  value: number
}

const fmtQ = (n: number) => n.toFixed(3)
const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

function Cell({ value, href, className }: { value: number; href: string | null; className: string }) {
  const text = value > 0 ? fmtQ(value) : '—'
  return (
    <td className={className}>
      {value > 0 && href ? <Link href={href} className="hover:underline">{text}</Link> : text}
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
}: {
  rows: StatementRow[]
  totals: StatementTotals
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
          <th className="px-4 py-3 text-right text-blue-700 bg-blue-50">Opening</th>
          {/* IN columns */}
          <th className="px-4 py-3 text-right text-green-700 bg-green-50">Purchase In</th>
          {/* Job Work Out sits right after Purchase In — mirrors the purchase → sent-for-job-work flow */}
          <th className="px-4 py-3 text-right text-red-700 bg-red-50">Job Work Out</th>
          <th className="px-4 py-3 text-right text-green-700 bg-green-50">Transfer In</th>
          <th className="px-4 py-3 text-right text-green-700 bg-green-50">JW Return</th>
          {/* OUT columns */}
          <th className="px-4 py-3 text-right text-red-700 bg-red-50">Dispatch</th>
          <th className="px-4 py-3 text-right text-red-700 bg-red-50">Transfer Out</th>
          {/* Closing */}
          <th className="px-4 py-3 text-right text-gray-800 bg-gray-100">Closing</th>
          {/* At Vendor / Current / Live */}
          <th className="px-4 py-3 text-right text-amber-700 bg-amber-50">At Vendor</th>
          <th className="px-4 py-3 text-right text-purple-700 bg-purple-50">Live Stock</th>
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
                  {item.openingHref ? <Link href={item.openingHref} className="hover:underline">{fmtQ(item.opening)}</Link> : fmtQ(item.opening)}
                </td>
                <Cell value={item.purchaseIn} href={item.purchaseInHref} className="px-4 py-3 text-right text-green-700 bg-green-50/40" />
                <Cell value={item.jwOut} href={item.jwOutHref} className="px-4 py-3 text-right text-red-700 bg-red-50/40" />
                <Cell value={item.transferIn} href={item.transferInHref} className="px-4 py-3 text-right text-green-700 bg-green-50/40" />
                <Cell value={item.jwReturn} href={item.jwReturnHref} className="px-4 py-3 text-right text-green-700 bg-green-50/40" />
                <Cell value={item.dispatch} href={item.dispatchHref} className="px-4 py-3 text-right text-red-700 bg-red-50/40" />
                <Cell value={item.transferOut} href={item.transferOutHref} className="px-4 py-3 text-right text-red-700 bg-red-50/40" />
                <td className={`px-4 py-3 text-right font-bold bg-gray-100/60 ${item.closing < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {item.closingHref ? <Link href={item.closingHref} className="hover:underline">{fmtQ(item.closing)}</Link> : fmtQ(item.closing)}
                </td>
                <td className={`px-4 py-3 text-right font-bold bg-amber-50/60 ${item.atVendor < 0 ? 'text-red-600' : 'text-amber-800'}`}>
                  {item.atVendor > 0 ? fmtQ(item.atVendor) : '—'}
                </td>
                <td className={`px-4 py-3 text-right font-bold bg-purple-50/60 ${item.liveStock < 0 ? 'text-red-600' : 'text-purple-800'}`}>
                  {item.liveHref ? <Link href={item.liveHref} className="hover:underline">{fmtQ(item.liveStock)}</Link> : fmtQ(item.liveStock)}
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
                  <td colSpan={15} className="px-4 py-3">
                    {item.warehouseBreakdown.length === 0 && item.vendorBreakdown.length === 0 ? (
                      <p className="text-xs text-gray-400 px-2">No stock currently at any warehouse or vendor.</p>
                    ) : (
                      <div className="flex flex-wrap gap-6">
                        <BreakdownTable title="Stock by Warehouse (Live Stock)" unit={item.unit} rows={item.warehouseBreakdown} />
                        <BreakdownTable title="Stock by Vendor (At Vendor)" unit={item.unit} rows={item.vendorBreakdown} />
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
          <td className="px-4 py-3 text-right text-blue-800">{fmtQ(totals.opening)}</td>
          <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.purchase_in)}</td>
          <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.jw_out)}</td>
          <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.transfer_in)}</td>
          <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.jw_return)}</td>
          <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.dispatch_out)}</td>
          <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.transfer_out)}</td>
          <td className={`px-4 py-3 text-right font-bold ${totals.closing < 0 ? 'text-red-700' : 'text-gray-900'}`}>
            {fmtQ(totals.closing)}
          </td>
          <td className={`px-4 py-3 text-right font-bold ${totals.at_vendor < 0 ? 'text-red-700' : 'text-amber-800'}`}>
            {fmtQ(totals.at_vendor)}
          </td>
          <td className={`px-4 py-3 text-right font-bold ${totals.current_stock < 0 ? 'text-red-700' : 'text-purple-800'}`}>
            {fmtQ(totals.current_stock)}
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
