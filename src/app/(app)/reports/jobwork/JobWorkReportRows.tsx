'use client'

import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  dispatched: 'bg-blue-100 text-blue-800',
  partially_returned: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

type JobWorkItem = {
  quantity_sent: number | string
  quantity_received: number | string
  quantity_transferred_out: number | string
  size_label: string | null
  purchase_line_id: string | null
  material_types: { description: string | null; unit?: string | null } | null
  material_sizes: { size_label: string | null } | null
  rate: number
}

export type JobWorkOrderRow = {
  id: string
  reference_number: string
  dispatch_date: string
  expected_return_date: string | null
  actual_return_date: string | null
  status: string | null
  notes?: string | null
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  suppliers: { name: string } | null
  job_work_items: JobWorkItem[]
}

function sortValue(o: JobWorkOrderRow, key: string): string | number {
  const first = o.job_work_items?.[0] ?? null
  const sent = first ? Number(first.quantity_sent || 0) : 0
  const received = first ? Number(first.quantity_received || 0) : 0
  const pending = sent - received - (first ? Number(first.quantity_transferred_out || 0) : 0)
  const rate = first?.rate ?? 0
  switch (key) {
    case 'reference': return o.reference_number ?? ''
    case 'dispatch_date': return o.dispatch_date
    case 'expected_return': return o.expected_return_date ?? ''
    case 'company': return o.companies?.name ?? ''
    case 'supplier': return o.suppliers?.name ?? ''
    case 'material': return first?.material_types?.description ?? ''
    case 'size': return first?.material_sizes?.size_label ?? first?.size_label ?? ''
    case 'sent': return sent
    case 'received': return received
    case 'pending': return pending
    case 'rate': return rate
    case 'sent_value': return sent * rate
    case 'pending_value': return pending * rate
    case 'status': return o.status ?? ''
    default: return ''
  }
}

export function JobWorkReportRows({
  orders,
}: {
  orders: JobWorkOrderRow[]
}) {
  const keys = ['reference', 'dispatch_date', 'expected_return', 'company', 'supplier', 'material', 'size', 'sent', 'received', 'pending', 'rate', 'sent_value', 'pending_value', 'status']
  const accessors = Object.fromEntries(keys.map((k) => [k, (o: JobWorkOrderRow) => sortValue(o, k)]))
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(orders, accessors)

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
          <SortableTh label="Ref No." sortKey="reference" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Dispatch Date" sortKey="dispatch_date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Exp. Return" sortKey="expected_return" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Supplier" sortKey="supplier" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Material" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Sent (T)" sortKey="sent" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Received (T)" sortKey="received" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Pending (T)" sortKey="pending" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Rate" sortKey="rate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case !text-teal-700 bg-teal-50" />
          <SortableTh label="Sent Value" sortKey="sent_value" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case !text-teal-700 bg-teal-50" />
          <SortableTh label="Pending Value" sortKey="pending_value" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case !text-amber-700 bg-amber-50" />
          <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((o) => {
          const items = o.job_work_items ?? []
          const rows: (JobWorkItem | null)[] = items.length === 0 ? [null] : items
          return rows.map((item, idx: number) => (
            <tr key={`${o.id}-${idx}`} className="hover:bg-gray-50">
              {idx === 0 && (
                <>
                  <td className="px-4 py-3 font-medium text-purple-700" rowSpan={rows.length}>{o.reference_number}</td>
                  <td className="px-4 py-3 text-gray-600" rowSpan={rows.length}>{formatDate(o.dispatch_date)}</td>
                  <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{o.expected_return_date ? formatDate(o.expected_return_date) : '—'}</td>
                  <td className="px-4 py-3" rowSpan={rows.length}>{o.companies?.name}</td>
                  <td className="px-4 py-3" rowSpan={rows.length}>{o.suppliers?.name}</td>
                </>
              )}
              {item ? (
                (() => {
                  const sent = Number(item.quantity_sent || 0)
                  const received = Number(item.quantity_received || 0)
                  const pending = sent - received - Number(item.quantity_transferred_out || 0)
                  const rate = item.rate
                  return (
                    <>
                      <td className="px-4 py-3 font-medium">{item.material_types?.description}</td>
                      <td className="px-4 py-3 text-gray-500">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                      <td className="px-4 py-3 text-right">{sent.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right text-green-700">{received.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right text-yellow-700">{pending.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right text-teal-700 bg-teal-50/40">{rate ? fmtC(rate) : '—'}</td>
                      <td className="px-4 py-3 text-right text-teal-700 bg-teal-50/40">{rate ? fmtC(sent * rate) : '—'}</td>
                      <td className="px-4 py-3 text-right text-amber-700 bg-amber-50/40">{rate ? fmtC(pending * rate) : '—'}</td>
                    </>
                  )
                })()
              ) : (
                <td className="px-4 py-3 text-gray-400" colSpan={8}>No items</td>
              )}
              {idx === 0 && (
                <td className="px-4 py-3" rowSpan={rows.length}>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[o.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                    {o.status?.replace(/_/g, ' ')}
                  </span>
                </td>
              )}
            </tr>
          ))
        })}
      </tbody>
    </>
  )
}
