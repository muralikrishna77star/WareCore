'use client'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

export type JobWorkCancellationRow = {
  id: string
  reference_number: string | null
  dispatch_date: string
  company_name: string | null
  warehouse_name: string | null
  vendor_name: string | null
  status: string | null
  cancelled_at: string | null
}

export function JobWorkCancellationsRows({ records: allRecords }: { records: JobWorkCancellationRow[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(allRecords, {
    reference: (r) => r.reference_number ?? '',
    date: (r) => r.dispatch_date,
    vendor: (r) => r.vendor_name ?? '',
    company: (r) => r.company_name ?? '',
    warehouse: (r) => r.warehouse_name ?? '',
    status: (r) => r.status ?? '',
    cancelled: (r) => r.cancelled_at ?? '',
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="bg-gray-50 text-left border-b">
          <SortableTh label="Reference No." sortKey="reference" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Dispatch Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Vendor" sortKey="vendor" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Warehouse" sortKey="warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Status at Cancellation" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Cancelled" sortKey="cancelled" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((r) => (
          <tr key={r.id} className="hover:bg-gray-50">
            <td className="px-6 py-3 font-mono text-xs text-gray-500 line-through whitespace-nowrap">{r.reference_number || '—'}</td>
            <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.dispatch_date)}</td>
            <td className="px-6 py-3 text-gray-700">{r.vendor_name || '—'}</td>
            <td className="px-6 py-3 text-gray-700">{r.company_name || '—'}</td>
            <td className="px-6 py-3 text-gray-600">{r.warehouse_name || '—'}</td>
            <td className="px-6 py-3">
              <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize bg-gray-100 text-gray-700">
                {r.status?.replace('_', ' ') || '—'}
              </span>
            </td>
            <td className="px-6 py-3 text-gray-500 text-xs whitespace-nowrap">{r.cancelled_at ? formatDate(r.cancelled_at) : '—'}</td>
            <td className="px-6 py-3">
              <Link href={`/jobwork-cancellations/${r.id}`}
                className="text-blue-600 hover:text-blue-800 text-xs font-medium whitespace-nowrap">
                View
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </>
  )
}
