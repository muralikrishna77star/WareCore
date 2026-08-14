export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraRunSql } from '@/lib/hasura/server'
import { ExceptionWorkbenchRows } from './ExceptionWorkbenchRows'

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
            <ExceptionWorkbenchRows exceptions={exceptions} />
          </table>
        </div>
      </div>
    </div>
  )
}
