'use client'

import { useState } from 'react'
import { formatDate } from '@/lib/utils'

export type Transaction = {
  id: string
  typeLabel: string
  typeColor: string
  itemName: string
  unit: string
  company: string
  warehouse: string
  qty: number
  isIn: boolean
  rate: number | null
  value: number | null
  reference: string
}

export type DayGroup = {
  date: string
  count: number
  openingWarehouse: number
  openingVendor: number
  purchases: number
  sales: number
  transferIn: number
  transferOut: number
  jobWorkOut: number
  jobReturns: number
  closingWarehouse: number
  closingVendor: number
  value: number
  transactions: Transaction[]
}

const fmtQ = (n: number) => n.toFixed(3)
const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

function Stat({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-gray-400">{label}:</span>
      <span className={`font-semibold ${className}`}>{value}</span>
    </span>
  )
}

export default function DaywiseStockStatementTable({ groups }: { groups: DayGroup[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (date: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  return (
    <div>
      <div className="px-4 py-2 border-b bg-gray-50 flex justify-end gap-3 text-xs print:hidden">
        <button type="button" onClick={() => setCollapsed(new Set())} className="text-blue-600 hover:underline">
          Expand All
        </button>
        <button type="button" onClick={() => setCollapsed(new Set(groups.map((g) => g.date)))} className="text-blue-600 hover:underline">
          Collapse All
        </button>
      </div>

      <div className="divide-y divide-gray-200">
        {groups.map((day) => {
          const isOpen = !collapsed.has(day.date)
          return (
            <div key={day.date}>
              <button
                type="button"
                onClick={() => toggle(day.date)}
                className="w-full flex flex-col gap-1.5 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className={`inline-block transition-transform text-gray-400 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                    <span className="font-semibold text-gray-900">{formatDate(day.date)}</span>
                    <span className="text-xs text-gray-500">{day.count} transaction{day.count !== 1 ? 's' : ''}</span>
                  </div>
                  <span className="font-semibold text-teal-800 text-sm">{fmtC(day.value)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs pl-6">
                  <Stat label="Opening (Wh)" value={fmtQ(day.openingWarehouse)} className="text-blue-800" />
                  <Stat label="Opening (Vendor)" value={fmtQ(day.openingVendor)} className="text-purple-700" />
                  <Stat label="Purchases" value={`+${fmtQ(day.purchases)}`} className="text-green-700" />
                  <Stat label="Sales" value={`-${fmtQ(day.sales)}`} className="text-red-600" />
                  <Stat label="Transfer In" value={`+${fmtQ(day.transferIn)}`} className="text-blue-700" />
                  <Stat label="Transfer Out" value={`-${fmtQ(day.transferOut)}`} className="text-orange-700" />
                  <Stat label="Job Work Out" value={`-${fmtQ(day.jobWorkOut)}`} className="text-purple-700" />
                  <Stat label="Job Returns" value={`+${fmtQ(day.jobReturns)}`} className="text-teal-700" />
                  <Stat label="Closing (Wh)" value={fmtQ(day.closingWarehouse)} className="text-gray-900" />
                  <Stat label="Closing (Vendor)" value={fmtQ(day.closingVendor)} className="text-purple-700" />
                </div>
              </button>

              {isOpen && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-white text-xs uppercase text-gray-500">
                      <th className="px-4 py-2 text-left">Type</th>
                      <th className="px-4 py-2 text-left">Item Name</th>
                      <th className="px-4 py-2 text-left">Company</th>
                      <th className="px-4 py-2 text-left">Warehouse</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-right text-teal-700 bg-teal-50">Rate</th>
                      <th className="px-4 py-2 text-right text-teal-700 bg-teal-50">Value</th>
                      <th className="px-4 py-2 text-left">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {day.transactions.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${t.typeColor}`}>
                            {t.typeLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{t.itemName}</td>
                        <td className="px-4 py-2.5 text-gray-600">{t.company}</td>
                        <td className="px-4 py-2.5 text-gray-500">{t.warehouse}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${t.isIn ? 'text-green-700' : 'text-red-600'}`}>
                          {t.isIn ? '+' : '-'}{fmtQ(Math.abs(t.qty))}
                        </td>
                        <td className="px-4 py-2.5 text-right text-teal-700 bg-teal-50/40">{t.rate != null ? fmtC(t.rate) : '—'}</td>
                        <td className={`px-4 py-2.5 text-right font-medium bg-teal-50/40 ${t.value != null && t.value < 0 ? 'text-red-600' : 'text-teal-800'}`}>
                          {t.value != null ? fmtC(t.value) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{t.reference || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
