'use client'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

export type JobWorkTransferCancellationRow = {
  id: string
  transfer_number: string | null
  transfer_date: string
  from_reference_number: string | null
  from_vendor_name: string | null
  to_reference_number: string | null
  to_vendor_name: string | null
  cancelled_at: string | null
}

export function JobWorkTransferCancellationsRows({ records: allRecords }: { records: JobWorkTransferCancellationRow[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(allRecords, {
    transfer_number: (r) => r.transfer_number ?? '',
    date: (r) => r.transfer_date,
    from: (r) => `${r.from_reference_number ?? ''} ${r.from_vendor_name ?? ''}`,
    to: (r) => `${r.to_reference_number ?? ''} ${r.to_vendor_name ?? ''}`,
    cancelled: (r) => r.cancelled_at ?? '',
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="bg-gray-50 text-left border-b">
          <SortableTh label="Transfer No." sortKey="transfer_number" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Transfer Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="From Order / Vendor" sortKey="from" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="To Order / Vendor" sortKey="to" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Cancelled" sortKey="cancelled" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((r) => (
          <tr key={r.id} className="hover:bg-gray-50">
            <td className="px-6 py-3 font-mono text-xs text-gray-500 line-through whitespace-nowrap">{r.transfer_number || '—'}</td>
            <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.transfer_date)}</td>
            <td className="px-6 py-3 text-gray-700">
              {r.from_reference_number || '—'}
              {r.from_vendor_name ? <span className="text-gray-400"> — {r.from_vendor_name}</span> : null}
            </td>
            <td className="px-6 py-3 text-gray-700">
              {r.to_reference_number || '—'}
              {r.to_vendor_name ? <span className="text-gray-400"> — {r.to_vendor_name}</span> : null}
            </td>
            <td className="px-6 py-3 text-gray-500 text-xs whitespace-nowrap">{r.cancelled_at ? formatDate(r.cancelled_at) : '—'}</td>
            <td className="px-6 py-3">
              <Link href={`/jobwork-transfer-cancellations/${r.id}`}
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
