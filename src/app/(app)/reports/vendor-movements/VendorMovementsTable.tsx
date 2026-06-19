'use client'

import { Fragment, useState } from 'react'

export type Transaction = {
  id: string
  date: string
  type: 'Job Work Out' | 'Direct Sale' | 'Return' | 'Return (paired with direct sale)'
  quantity: number
  reference_number: string | null
  notes: string | null
}

export type GroupRow = {
  key: string
  vendorName: string
  companyName: string
  itemLabel: string
  sizeLabel: string
  unit: string
  jobWorkOut: number
  directSales: number
  returns: number
  balance: number
  transactions: Transaction[]
}

const typeColors: Record<Transaction['type'], string> = {
  'Job Work Out': 'bg-purple-100 text-purple-800',
  'Direct Sale': 'bg-red-100 text-red-800',
  Return: 'bg-teal-100 text-teal-800',
  'Return (paired with direct sale)': 'bg-gray-100 text-gray-600',
}

function formatDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function VendorMovementsTable({
  rows,
  sortHrefs,
  activeSort,
  activeDir,
}: {
  rows: GroupRow[]
  sortHrefs: Record<string, string>
  activeSort: string
  activeDir: 'asc' | 'desc'
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

  const SortableTh = ({ column, label, align }: { column: string; label: string; align?: 'right' }) => (
    <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase ${align === 'right' ? 'text-right' : ''}`}>
      <a href={sortHrefs[column]} className={`inline-flex items-center gap-1 hover:text-gray-800 ${activeSort === column ? 'text-gray-800' : ''}`}>
        {label}
        <span className="text-[10px]">{activeSort === column ? (activeDir === 'desc' ? '▼' : '▲') : ''}</span>
      </a>
    </th>
  )

  if (rows.length === 0) {
    return <p className="p-8 text-center text-gray-500 text-sm">No vendor movements found for the selected period.</p>
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="bg-gray-50 text-left border-b">
          <th className="px-2 py-3 w-8" />
          <SortableTh column="vendor" label="Vendor" />
          <SortableTh column="company" label="Company" />
          <SortableTh column="item" label="Item" />
          <SortableTh column="size" label="Size" />
          <SortableTh column="job_work_out" label="Job Work Out" align="right" />
          <SortableTh column="direct_sales" label="Direct Sales" align="right" />
          <SortableTh column="returns" label="Returns" align="right" />
          <SortableTh column="balance" label="Balance" align="right" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((g) => {
          const isOpen = expanded.has(g.key)
          return (
            <Fragment key={g.key}>
              <tr
                onClick={() => toggle(g.key)}
                className="hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-2 py-2.5 text-gray-400 text-center">
                  <span className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                </td>
                <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{g.vendorName}</td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{g.companyName}</td>
                <td className="px-4 py-2.5 text-gray-900 whitespace-nowrap">{g.itemLabel}</td>
                <td className="px-4 py-2.5 text-gray-600">{g.sizeLabel}</td>
                <td className="px-4 py-2.5 text-right font-medium text-purple-700">{g.jobWorkOut.toFixed(3)} {g.unit}</td>
                <td className="px-4 py-2.5 text-right font-medium text-red-700">{g.directSales.toFixed(3)} {g.unit}</td>
                <td className="px-4 py-2.5 text-right font-medium text-teal-700">{g.returns.toFixed(3)} {g.unit}</td>
                <td className={`px-4 py-2.5 text-right font-semibold ${g.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {g.balance.toFixed(3)} {g.unit}
                </td>
              </tr>
              {isOpen && (
                <tr key={`${g.key}-detail`} className="bg-gray-50/60">
                  <td colSpan={9} className="px-4 py-3">
                    {g.transactions.length === 0 ? (
                      <p className="text-xs text-gray-400 px-2">No individual transactions in this period.</p>
                    ) : (
                      <table className="w-full text-xs border rounded-lg overflow-hidden bg-white">
                        <thead>
                          <tr className="bg-gray-100 text-left text-gray-500 uppercase">
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Movement</th>
                            <th className="px-3 py-2 text-right">Quantity</th>
                            <th className="px-3 py-2">Reference</th>
                            <th className="px-3 py-2">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {g.transactions.map((t) => (
                            <tr key={t.id}>
                              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDate(t.date)}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${typeColors[t.type]}`}>
                                  {t.type}
                                </span>
                              </td>
                              <td className={`px-3 py-2 text-right font-medium ${t.quantity >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                {t.quantity >= 0 ? '+' : ''}{t.quantity.toFixed(3)} {g.unit}
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-500">{t.reference_number || '—'}</td>
                              <td className="px-3 py-2 text-gray-500">{t.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
          <td className="px-4 py-3 text-gray-700" colSpan={5}>Total</td>
          <td className="px-4 py-3 text-right text-purple-800">{rows.reduce((s, g) => s + g.jobWorkOut, 0).toFixed(3)}</td>
          <td className="px-4 py-3 text-right text-red-800">{rows.reduce((s, g) => s + g.directSales, 0).toFixed(3)}</td>
          <td className="px-4 py-3 text-right text-teal-800">{rows.reduce((s, g) => s + g.returns, 0).toFixed(3)}</td>
          <td className="px-4 py-3 text-right text-gray-900">{rows.reduce((s, g) => s + g.balance, 0).toFixed(3)}</td>
        </tr>
      </tfoot>
    </table>
  )
}
