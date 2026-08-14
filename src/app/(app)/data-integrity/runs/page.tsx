export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_RUN_SCAN } from '@/lib/dataIntegrity/auth'
import StartScanForm from './StartScanForm'
import { ReconciliationRunsRows } from './ReconciliationRunsRows'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
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
            <ReconciliationRunsRows runs={runs} />
          </table>
        </div>
      </div>
    </div>
  )
}
