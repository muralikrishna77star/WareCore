'use client'

import { useMemo, useState } from 'react'
import { formatDate } from '@/lib/utils'
import BillRow from './BillRow'

type Column = {
  key: string
  label: string
  align?: 'right'
  filterValue: (bill: any) => string
}

const columns: Column[] = [
  { key: 'bill_number', label: 'Bill No.', filterValue: (b) => b.bill_number || '' },
  { key: 'date', label: 'Date', filterValue: (b) => formatDate(b.bill_date) },
  { key: 'supplier', label: 'Supplier', filterValue: (b) => b.suppliers?.name || '' },
  { key: 'company', label: 'Company', filterValue: (b) => b.companies?.code || '' },
  { key: 'warehouse', label: 'Warehouse', filterValue: (b) => b.warehouses?.name || '' },
  { key: 'quantity', label: 'Quantity', align: 'right', filterValue: (b) => String(Number(b.total_quantity || 0)) },
  { key: 'amount', label: 'Amount', align: 'right', filterValue: (b) => String(Number(b.total_amount || 0)) },
  { key: 'status', label: 'Status', filterValue: (b) => (b.status === 'cancelled' ? 'Cancelled' : b.status === 'draft' ? 'Draft' : 'Active') },
  { key: 'notes', label: 'Notes', filterValue: (b) => b.notes || '' },
]

export default function BillsTable({ bills, highlight }: { bills: any[]; highlight?: string }) {
  const [filters, setFilters] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== '')
    if (active.length === 0) return bills
    return bills.filter((b) =>
      active.every(([key, value]) => {
        const col = columns.find((c) => c.key === key)
        if (!col) return true
        return col.filterValue(b).toLowerCase().includes(value.trim().toLowerCase())
      })
    )
  }, [bills, filters])

  return (
    <table className="w-full text-[0.9375rem]">
      <thead className="sticky top-0 z-10 bg-gray-50">
        <tr className="text-left border-b">
          {columns.map((col) => (
            <th key={col.key} className={`px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase ${col.align === 'right' ? 'text-right' : ''}`}>
              {col.label}
            </th>
          ))}
          <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Actions</th>
        </tr>
        <tr className="border-b bg-white">
          {columns.map((col) => (
            <th key={col.key} className="px-6 py-2">
              <input
                type="text"
                value={filters[col.key] ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                placeholder="Search..."
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal normal-case text-gray-700 focus:border-blue-400 focus:outline-none"
              />
            </th>
          ))}
          <th className="px-6 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {filtered.length === 0 && (
          <tr>
            <td colSpan={columns.length + 1} className="px-6 py-12 text-center text-gray-500">
              No purchase bills match your search.
            </td>
          </tr>
        )}
        {filtered.map((bill: any) => (
          <BillRow key={bill.id} bill={bill} highlight={highlight} />
        ))}
      </tbody>
    </table>
  )
}
