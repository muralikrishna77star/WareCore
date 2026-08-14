'use client'

import Link from 'next/link'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-gray-100 text-gray-700',
  INFO: 'bg-blue-100 text-blue-700',
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 }

export function ExceptionWorkbenchRows({ exceptions }: { exceptions: Record<string, string>[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(exceptions, {
    exception: (e) => e.exception_number,
    severity: (e) => SEVERITY_RANK[e.severity] ?? 0,
    rule: (e) => e.rule_code ?? '',
    summary: (e) => e.summary ?? '',
    difference: (e) => (e.difference ? Number(e.difference) : null),
    status: (e) => e.status ?? '',
    last_detected: (e) => new Date(e.last_detected_at).getTime(),
  })

  return (
    <>
      <thead className="sticky top-0 bg-gray-50">
        <tr className="border-b text-xs uppercase text-gray-500">
          <SortableTh label="Exception" sortKey="exception" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Severity" sortKey="severity" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Rule" sortKey="rule" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Summary" sortKey="summary" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Difference" sortKey="difference" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Last Detected" sortKey="last_detected" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No exceptions match this filter.</td></tr>
        )}
        {sortedRows.map((e) => (
          <tr key={e.id} className="hover:bg-gray-50">
            <td className="px-4 py-3">
              <Link href={`/data-integrity/exceptions/${e.id}`} className="font-medium text-blue-600 hover:underline">{e.exception_number}</Link>
            </td>
            <td className="px-4 py-3">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[e.severity] ?? 'bg-gray-100'}`}>{e.severity}</span>
            </td>
            <td className="px-4 py-3 text-gray-600 font-mono text-xs">{e.rule_code}</td>
            <td className="px-4 py-3 text-gray-700 max-w-md truncate" title={e.summary}>{e.summary}</td>
            <td className="px-4 py-3 text-right text-gray-600">{e.difference ?? '—'}</td>
            <td className="px-4 py-3 text-gray-600">{e.status}{Number(e.occurrence_count) > 1 && <span className="ml-1 text-xs text-gray-400">×{e.occurrence_count}</span>}</td>
            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(e.last_detected_at).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </>
  )
}
