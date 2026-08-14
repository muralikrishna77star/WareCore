'use client'

import { TriangleAlert } from 'lucide-react'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

const STATUS_COLOR: Record<string, string> = {
  QUEUED: 'bg-gray-100 text-gray-700',
  RUNNING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  COMPLETED_WITH_EXCEPTIONS: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

export function ReconciliationRunsRows({ runs }: { runs: Record<string, string>[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(runs, {
    run: (r) => r.run_number,
    type: (r) => r.run_type,
    scope: (r) => r.scope_type,
    status: (r) => r.status,
    started: (r) => (r.started_at ? new Date(r.started_at).getTime() : null),
    duration: (r) => (r.execution_time_ms ? Number(r.execution_time_ms) : null),
    scanned: (r) => (r.records_scanned ? Number(r.records_scanned) : null),
    exceptions: (r) => (r.exceptions_found ? Number(r.exceptions_found) : 0),
  })

  return (
    <>
      <thead className="sticky top-0 bg-gray-50">
        <tr className="border-b text-xs uppercase text-gray-500">
          <SortableTh label="Run" sortKey="run" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Type" sortKey="type" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Scope" sortKey="scope" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Started" sortKey="started" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Duration" sortKey="duration" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Scanned" sortKey="scanned" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Exceptions" sortKey="exceptions" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.length === 0 && (
          <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No reconciliation runs yet.</td></tr>
        )}
        {sortedRows.map((r) => (
          <tr key={r.run_number} className="hover:bg-gray-50">
            <td className="px-4 py-3 font-medium text-gray-900">{r.run_number}</td>
            <td className="px-4 py-3 text-gray-600">{r.run_type}</td>
            <td className="px-4 py-3 text-gray-600">{r.scope_type}</td>
            <td className="px-4 py-3">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? 'bg-gray-100 text-gray-700'}`}>
                {r.status}
              </span>
              {r.error_message && <span className="ml-1 text-red-600" title={r.error_message}><TriangleAlert className="inline h-3.5 w-3.5" /></span>}
            </td>
            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</td>
            <td className="px-4 py-3 text-right text-gray-500">{r.execution_time_ms ? `${(Number(r.execution_time_ms) / 1000).toFixed(1)}s` : '—'}</td>
            <td className="px-4 py-3 text-right text-gray-500">{r.records_scanned ?? '—'}</td>
            <td className="px-4 py-3 text-right">
              <span className="font-medium">{r.exceptions_found ?? 0}</span>
              {Number(r.critical_count) > 0 && <span className="ml-1 text-xs text-red-600">({r.critical_count} crit)</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </>
  )
}
