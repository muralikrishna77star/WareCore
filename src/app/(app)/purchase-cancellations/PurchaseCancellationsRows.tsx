'use client'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

export type PurchaseCancellationRow = {
  id: string
  bill_number: string
  bill_date: string
  company_name: string | null
  warehouse_name: string | null
  supplier_name: string | null
  total_quantity: number
  total_amount: number
  cancelled_at: string | null
  purged_at: string
}

export function PurchaseCancellationsRows({ records: allRecords }: { records: PurchaseCancellationRow[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(allRecords, {
    bill_number: (r) => r.bill_number,
    bill_date: (r) => r.bill_date,
    supplier: (r) => r.supplier_name ?? '',
    company: (r) => r.company_name ?? '',
    warehouse: (r) => r.warehouse_name ?? '',
    qty: (r) => Number(r.total_quantity || 0),
    amount: (r) => Number(r.total_amount || 0),
    cancelled: (r) => r.cancelled_at ?? '',
    purged: (r) => r.purged_at,
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="bg-gray-50 text-left border-b">
          <SortableTh label="Bill No." sortKey="bill_number" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Bill Date" sortKey="bill_date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Supplier" sortKey="supplier" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Warehouse" sortKey="warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Qty" sortKey="qty" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Amount" sortKey="amount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Cancelled" sortKey="cancelled" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Purged" sortKey="purged" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((r) => (
          <tr key={r.id} className="hover:bg-gray-50">
            <td className="px-6 py-3 font-mono text-[0.8125rem] text-gray-500 line-through whitespace-nowrap">{r.bill_number}</td>
            <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.bill_date)}</td>
            <td className="px-6 py-3 text-gray-700">{r.supplier_name || '—'}</td>
            <td className="px-6 py-3 text-gray-700">{r.company_name || '—'}</td>
            <td className="px-6 py-3 text-gray-600">{r.warehouse_name || '—'}</td>
            <td className="px-6 py-3 text-right text-gray-700">{Number(r.total_quantity || 0).toFixed(3)}</td>
            <td className="px-6 py-3 text-right text-gray-700">
              ₹{Number(r.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </td>
            <td className="px-6 py-3 text-gray-500 text-[0.8125rem] whitespace-nowrap">{r.cancelled_at ? formatDate(r.cancelled_at) : '—'}</td>
            <td className="px-6 py-3 text-gray-500 text-[0.8125rem] whitespace-nowrap">{formatDate(r.purged_at)}</td>
            <td className="px-6 py-3">
              <Link href={`/purchase-cancellations/${r.id}`}
                className="text-blue-600 hover:text-blue-800 text-[0.6875rem] font-medium whitespace-nowrap">
                View
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </>
  )
}
