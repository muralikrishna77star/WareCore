export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_RUN_SCAN } from '@/lib/dataIntegrity/auth'
import StartScanForm from './StartScanForm'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

const STATUS_COLOR: Record<string, string> = {
  QUEUED: 'bg-gray-100 text-gray-700',
  RUNNING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  COMPLETED_WITH_EXCEPTIONS: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

export default async function ReconciliationRunsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null
  const canRun = !!session && CAN_RUN_SCAN.has(session.role)

  const result = await hasuraRunSql(`
    SELECT run_number, run_type, scope_type, status, started_at, completed_at, execution_time_ms,
           records_scanned, exceptions_found, critical_count, high_count, medium_count, low_count, error_message
    FROM reconciliation_runs
    ORDER BY created_at DESC
    LIMIT 100
  `)
  const runs = rowsToObjects(result)

  return (
    <div className="space-y-6">
      <StartScanForm canRun={canRun} />

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">Reconciliation Runs</span>
          <span className="text-xs text-gray-500">{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="border-b text-xs uppercase text-gray-500">
                <th className="px-4 py-3 text-left">Run</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Scope</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Started</th>
                <th className="px-4 py-3 text-right">Duration</th>
                <th className="px-4 py-3 text-right">Scanned</th>
                <th className="px-4 py-3 text-right">Exceptions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No reconciliation runs yet.</td></tr>
              )}
              {runs.map((r) => (
                <tr key={r.run_number} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.run_number}</td>
                  <td className="px-4 py-3 text-gray-600">{r.run_type}</td>
                  <td className="px-4 py-3 text-gray-600">{r.scope_type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {r.status}
                    </span>
                    {r.error_message && <span className="ml-1 text-xs text-red-600" title={r.error_message}>⚠</span>}
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
          </table>
        </div>
      </div>
    </div>
  )
}
