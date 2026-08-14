'use client'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

export type DispatchCancellationRow = {
  id: string
  invoice_number: string | null
  dispatch_date: string
  company_name: string | null
  warehouse_name: string | null
  customer_name: string | null
  total_quantity: number | string | null
  total_amount: number | string | null
  cancelled_at: string | null
  purged_at: string
}

export function SaleCancellationsRows({ records: allRecords }: { records: DispatchCancellationRow[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(allRecords, {
    invoice: (r) => r.invoice_number ?? '',
    date: (r) => r.dispatch_date,
    customer: (r) => r.customer_name ?? '',
    company: (r) => r.company_name ?? '',
    warehouse: (r) => r.warehouse_name ?? '',
    qty: (r) => Number(r.total_quantity || 0),
    amount: (r) => (r.total_amount ? Number(r.total_amount) : null),
    cancelled: (r) => r.cancelled_at ?? '',
    purged: (r) => r.purged_at,
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="bg-gray-50 text-left border-b">
          <SortableTh label="Invoice No." sortKey="invoice" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Dispatch Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
          <SortableTh label="Customer" sortKey="customer" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-6 !text-[0.6875rem]" />
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
            <td className="px-6 py-3 font-mono text-[0.8125rem] text-gray-500 line-through whitespace-nowrap">{r.invoice_number || '—'}</td>
            <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.dispatch_date)}</td>
            <td className="px-6 py-3 text-gray-700">{r.customer_name || '—'}</td>
            <td className="px-6 py-3 text-gray-700">{r.company_name || '—'}</td>
            <td className="px-6 py-3 text-gray-600">{r.warehouse_name || '—'}</td>
            <td className="px-6 py-3 text-right text-gray-700">{Number(r.total_quantity || 0).toFixed(3)}</td>
            <td className="px-6 py-3 text-right text-gray-700">
              {r.total_amount ? `₹${Number(r.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
            </td>
            <td className="px-6 py-3 text-gray-500 text-[0.8125rem] whitespace-nowrap">{r.cancelled_at ? formatDate(r.cancelled_at) : '—'}</td>
            <td className="px-6 py-3 text-gray-500 text-[0.8125rem] whitespace-nowrap">{formatDate(r.purged_at)}</td>
            <td className="px-6 py-3">
              <Link href={`/sale-cancellations/${r.id}`}
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
