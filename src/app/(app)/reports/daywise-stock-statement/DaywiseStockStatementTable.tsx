'use client'

import { Fragment, useState } from 'react'
import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

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

const DETAIL_COLSPAN = 14

const sortAccessors: Record<string, (d: DayGroup) => string | number> = {
  date: (d) => d.date,
  count: (d) => d.count,
  openingWarehouse: (d) => d.openingWarehouse,
  openingVendor: (d) => d.openingVendor,
  purchases: (d) => d.purchases,
  sales: (d) => d.sales,
  transferIn: (d) => d.transferIn,
  transferOut: (d) => d.transferOut,
  jobWorkOut: (d) => d.jobWorkOut,
  jobReturns: (d) => d.jobReturns,
  closingWarehouse: (d) => d.closingWarehouse,
  closingVendor: (d) => d.closingVendor,
  value: (d) => d.value,
}

export default function DaywiseStockStatementTable({ groups }: { groups: DayGroup[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { sortedRows: sortedGroups, sortKey, sortDir, toggleSort } = useTableSort(groups, sortAccessors, { key: 'date' })

  const toggle = (date: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  return (
    <div>
      <div className="px-3 py-1.5 border-b bg-gray-50 flex justify-end gap-3 text-xs print:hidden">
        <button type="button" onClick={() => setExpanded(new Set(groups.map((g) => g.date)))} className="text-blue-600 hover:underline">
          Expand All
        </button>
        <button type="button" onClick={() => setExpanded(new Set())} className="text-blue-600 hover:underline">
          Collapse All
        </button>
      </div>

      <table className="w-full text-xs whitespace-nowrap">
        <thead className="sticky top-0 z-10">
          <tr className="border-b text-[11px] font-semibold uppercase">
            <th className="px-1 py-2 w-6 bg-white" />
            <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-2 !text-gray-600 bg-white" />
            <SortableTh label="Txns" sortKey="count" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-gray-400 bg-white" />
            <SortableTh label="Opening Wh" sortKey="openingWarehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-blue-700 bg-blue-50" />
            <SortableTh label="Opening Vd" sortKey="openingVendor" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-purple-700 bg-purple-50" />
            <SortableTh label="Purchases" sortKey="purchases" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-green-700 bg-green-50" />
            <SortableTh label="Sales" sortKey="sales" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-red-700 bg-red-50" />
            <SortableTh label="Transfer In" sortKey="transferIn" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-blue-700 bg-blue-50" />
            <SortableTh label="Transfer Out" sortKey="transferOut" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-orange-700 bg-orange-50" />
            <SortableTh label="JW Out" sortKey="jobWorkOut" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-purple-700 bg-purple-50" />
            <SortableTh label="JW Return" sortKey="jobReturns" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-teal-700 bg-teal-50" />
            <SortableTh label="Closing Wh" sortKey="closingWarehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-gray-800 bg-gray-100" />
            <SortableTh label="Closing Vd" sortKey="closingVendor" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-purple-800 bg-purple-50" />
            <SortableTh label="Value" sortKey="value" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-2 !text-teal-700 bg-teal-50" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedGroups.map((day) => {
            const isOpen = expanded.has(day.date)
            return (
              <Fragment key={day.date}>
                <tr onClick={() => toggle(day.date)} className="hover:bg-gray-50 transition-colors cursor-pointer bg-gray-50/40">
                  <td className="px-1 py-1.5 text-center text-gray-400">
                    <span className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  </td>
                  <td className="px-2 py-1.5 font-medium text-gray-900">{formatDate(day.date)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-400">{day.count}</td>
                  <td className="px-2 py-1.5 text-right text-blue-800 bg-blue-50/40">{fmtQ(day.openingWarehouse)}</td>
                  <td className="px-2 py-1.5 text-right text-purple-700 bg-purple-50/40">{fmtQ(day.openingVendor)}</td>
                  <td className="px-2 py-1.5 text-right text-green-700 bg-green-50/40">+{fmtQ(day.purchases)}</td>
                  <td className="px-2 py-1.5 text-right text-red-600 bg-red-50/40">-{fmtQ(day.sales)}</td>
                  <td className="px-2 py-1.5 text-right text-blue-700 bg-blue-50/40">+{fmtQ(day.transferIn)}</td>
                  <td className="px-2 py-1.5 text-right text-orange-700 bg-orange-50/40">-{fmtQ(day.transferOut)}</td>
                  <td className="px-2 py-1.5 text-right text-purple-700 bg-purple-50/40">-{fmtQ(day.jobWorkOut)}</td>
                  <td className="px-2 py-1.5 text-right text-teal-700 bg-teal-50/40">+{fmtQ(day.jobReturns)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-gray-900 bg-gray-100/60">{fmtQ(day.closingWarehouse)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-purple-800 bg-purple-50/60">{fmtQ(day.closingVendor)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-teal-800 bg-teal-50/60">{fmtC(day.value)}</td>
                </tr>
                {isOpen && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={DETAIL_COLSPAN} className="p-0">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-y bg-white text-[11px] uppercase text-gray-500">
                            <th className="px-2 py-1.5 text-left">Type</th>
                            <th className="px-2 py-1.5 text-left">Item Name</th>
                            <th className="px-2 py-1.5 text-left">Company</th>
                            <th className="px-2 py-1.5 text-left">Warehouse</th>
                            <th className="px-2 py-1.5 text-right">Qty</th>
                            <th className="px-2 py-1.5 text-right text-teal-700 bg-teal-50">Rate</th>
                            <th className="px-2 py-1.5 text-right text-teal-700 bg-teal-50">Value</th>
                            <th className="px-2 py-1.5 text-left">Reference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {day.transactions.map((t) => (
                            <tr key={t.id} className="hover:bg-gray-100/60">
                              <td className="px-2 py-1.5">
                                <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium ${t.typeColor}`}>
                                  {t.typeLabel}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 font-medium text-gray-900">{t.itemName}</td>
                              <td className="px-2 py-1.5 text-gray-600">{t.company}</td>
                              <td className="px-2 py-1.5 text-gray-500">{t.warehouse}</td>
                              <td className={`px-2 py-1.5 text-right font-medium ${t.isIn ? 'text-green-700' : 'text-red-600'}`}>
                                {t.isIn ? '+' : '-'}{fmtQ(Math.abs(t.qty))}
                              </td>
                              <td className="px-2 py-1.5 text-right text-teal-700 bg-teal-50/40">{t.rate != null ? fmtC(t.rate) : '—'}</td>
                              <td className={`px-2 py-1.5 text-right font-medium bg-teal-50/40 ${t.value != null && t.value < 0 ? 'text-red-600' : 'text-teal-800'}`}>
                                {t.value != null ? fmtC(t.value) : '—'}
                              </td>
                              <td className="px-2 py-1.5 text-gray-500 text-[11px]">{t.reference || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
