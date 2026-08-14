'use client'

import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-gray-100 text-gray-700',
  INFO: 'bg-blue-100 text-blue-700',
}

const isTrue = (v: string | undefined) => v === 'true' || v === 't'

export function RuleCatalogueRows({ rules }: { rules: Record<string, string>[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(rules, {
    rule: (r) => `${r.rule_code} — ${r.rule_name}`,
    category: (r) => r.category,
    severity: (r) => r.severity,
    status: (r) => (isTrue(r.is_enabled) ? 1 : 0),
    tolerance: (r) => (r.tolerance ? Number(r.tolerance) : null),
    version: (r) => r.version,
  })

  return (
    <>
      <thead>
        <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
          <SortableTh label="Rule" sortKey="rule" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Category" sortKey="category" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Severity" sortKey="severity" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Tolerance" sortKey="tolerance" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Version" sortKey="version" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((r) => (
          <tr key={r.rule_code} className="align-top hover:bg-gray-50">
            <td className="px-4 py-3">
              <p className="font-medium text-gray-900">{r.rule_code} — {r.rule_name}</p>
              <p className="text-xs text-gray-500 mt-0.5 max-w-xl">{r.description}</p>
            </td>
            <td className="px-4 py-3 text-gray-600">{r.category}</td>
            <td className="px-4 py-3">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[r.severity] ?? 'bg-gray-100'}`}>{r.severity}</span>
            </td>
            <td className="px-4 py-3">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${isTrue(r.is_enabled) ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                {isTrue(r.is_enabled) ? 'Implemented' : 'Catalogued only'}
              </span>
            </td>
            <td className="px-4 py-3 text-right text-gray-500">{r.tolerance ?? '—'}</td>
            <td className="px-4 py-3 text-right text-gray-500">{r.version}</td>
          </tr>
        ))}
      </tbody>
    </>
  )
}
