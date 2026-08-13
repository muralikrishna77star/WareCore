export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraRunSql } from '@/lib/hasura/server'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'REPAIR_PROPOSED', 'APPROVED', 'RESOLVED', 'IGNORED', 'REOPENED']

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-gray-100 text-gray-700',
  INFO: 'bg-blue-100 text-blue-700',
}

export default async function ExceptionWorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; status?: string; openOnly?: string; rule?: string }>
}) {
  const params = await searchParams
  const severity: string = SEVERITIES.includes(params.severity ?? '') ? (params.severity as string) : ''
  const status: string = STATUSES.includes(params.status ?? '') ? (params.status as string) : ''
  const openOnly = params.openOnly === '1'

  const conditions: string[] = []
  if (severity) conditions.push(`e.severity = '${severity}'`)
  if (status) conditions.push(`e.status = '${status}'`)
  else if (openOnly) conditions.push(`e.status NOT IN ('RESOLVED', 'IGNORED')`)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await hasuraRunSql(`
    SELECT e.id, e.exception_number, e.severity, e.status, e.summary, e.reference_number,
           e.expected_value, e.actual_value, e.difference, e.first_detected_at, e.last_detected_at,
           e.occurrence_count, r.rule_code
    FROM reconciliation_exceptions e
    LEFT JOIN reconciliation_rules r ON r.id = e.rule_id
    ${where}
    ORDER BY e.severity = 'CRITICAL' DESC, e.severity = 'HIGH' DESC, e.severity = 'MEDIUM' DESC, e.last_detected_at DESC
    LIMIT 500
  `)
  const exceptions = rowsToObjects(result)

  const filterLink = (next: Partial<{ severity: string; status: string; openOnly: string }>) => {
    const merged = { severity, status, openOnly: openOnly ? '1' : '', ...next }
    const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v)).toString()
    return `/data-integrity/exceptions${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Severity:</span>
        <Link href={filterLink({ severity: '' })} className={`text-xs px-2 py-1 rounded ${!severity ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>All</Link>
        {SEVERITIES.map((s) => (
          <Link key={s} href={filterLink({ severity: s })} className={`text-xs px-2 py-1 rounded ${severity === s ? 'bg-gray-800 text-white' : SEVERITY_COLOR[s]}`}>{s}</Link>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        <Link href={filterLink({ openOnly: openOnly ? '' : '1', status: '' })} className={`text-xs px-2 py-1 rounded ${openOnly ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>
          Open only
        </Link>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">Exception Workbench</span>
          <span className="text-xs text-gray-500">{exceptions.length} shown (max 500)</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="border-b text-xs uppercase text-gray-500">
                <th className="px-4 py-3 text-left">Exception</th>
                <th className="px-4 py-3 text-left">Severity</th>
                <th className="px-4 py-3 text-left">Rule</th>
                <th className="px-4 py-3 text-left">Summary</th>
                <th className="px-4 py-3 text-right">Difference</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Last Detected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {exceptions.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No exceptions match this filter.</td></tr>
              )}
              {exceptions.map((e) => (
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
          </table>
        </div>
      </div>
    </div>
  )
}
