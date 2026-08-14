'use client'

import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

export function OpenByRuleRows({ openByRule }: { openByRule: Record<string, string>[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(openByRule, {
    rule: (r) => `${r.rule_code} — ${r.rule_name}`,
    category: (r) => r.category,
    open: (r) => Number(r.n),
  })

  return (
    <>
      <thead>
        <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
          <SortableTh label="Rule" sortKey="rule" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Category" sortKey="category" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Open" sortKey="open" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((r) => (
          <tr key={r.rule_code} className={Number(r.n) > 0 ? '' : 'text-gray-400'}>
            <td className="px-4 py-2">{r.rule_code} — {r.rule_name}</td>
            <td className="px-4 py-2">{r.category}</td>
            <td className="px-4 py-2 text-right font-medium">{r.n}</td>
          </tr>
        ))}
      </tbody>
    </>
  )
}
