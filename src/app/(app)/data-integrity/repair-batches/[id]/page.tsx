export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE, CAN_PROPOSE_REPAIR, CAN_APPROVE_REPAIR } from '@/lib/dataIntegrity/auth'
import RepairBatchActions from './RepairBatchActions'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  REJECTED: 'bg-gray-100 text-gray-500',
  EXECUTING: 'bg-amber-100 text-amber-800',
  EXECUTED: 'bg-green-100 text-green-800',
  EXECUTION_FAILED: 'bg-red-100 text-red-800',
  ROLLED_BACK: 'bg-gray-100 text-gray-500',
}

export default async function RepairBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null
  const canPropose = !!session && CAN_PROPOSE_REPAIR.has(session.role)
  const canApprove = !!session && CAN_APPROVE_REPAIR.has(session.role)

  const [batchResult, auditResult] = await Promise.all([
    hasuraRunSql(`
      SELECT b.*, e.exception_number, e.summary AS exception_summary, e.status AS exception_status
      FROM repair_batches b LEFT JOIN reconciliation_exceptions e ON e.id = b.exception_id
      WHERE b.id = '${id}'::uuid
    `),
    hasuraRunSql(`SELECT * FROM repair_audit_rows WHERE repair_batch_id = '${id}'::uuid ORDER BY created_at`),
  ])

  const batches = rowsToObjects(batchResult)
  if (!batches.length) notFound()
  const batch = batches[0]
  const auditRows = rowsToObjects(auditResult)

  let executionResult: Record<string, unknown> | null = null
  try {
    executionResult = batch.execution_result ? JSON.parse(batch.execution_result) : null
  } catch {
    executionResult = null
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">{batch.repair_batch_number}</h2>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[batch.status] ?? 'bg-gray-100'}`}>{batch.status}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{batch.proposed_action}</p>
          </div>
          {batch.exception_id && (
            <Link href={`/data-integrity/exceptions/${batch.exception_id}`} className="text-sm text-blue-600 underline hover:no-underline">
              {batch.exception_number} — {batch.exception_status}
            </Link>
          )}
        </div>
        {batch.exception_summary && <p className="mt-3 text-sm text-gray-600">{batch.exception_summary}</p>}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Lifecycle</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <dt className="text-gray-500">Requested</dt>
          <dd className="text-gray-900 col-span-2">{batch.requested_at ? new Date(batch.requested_at).toLocaleString() : '—'}</dd>
          <dt className="text-gray-500">Approved</dt>
          <dd className="text-gray-900 col-span-2">{batch.approved_at ? new Date(batch.approved_at).toLocaleString() : '—'}</dd>
          <dt className="text-gray-500">Executed</dt>
          <dd className="text-gray-900 col-span-2">{batch.executed_at ? new Date(batch.executed_at).toLocaleString() : '—'}</dd>
        </dl>
        {batch.error_message && (
          <p className="mt-3 text-sm text-red-700"><span className="font-medium">Error: </span>{batch.error_message}</p>
        )}
      </div>

      {executionResult && (
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">Execution result</p>
          <pre className="text-xs bg-gray-50 rounded p-3 overflow-auto max-h-64">{JSON.stringify(executionResult, null, 2)}</pre>
        </div>
      )}

      {auditRows.length > 0 && (
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-6 py-3 border-b bg-gray-50">
            <span className="font-semibold text-gray-700 text-sm">Audit rows (before/after images)</span>
          </div>
          <div className="divide-y divide-gray-100">
            {auditRows.map((row) => (
              <div key={row.id} className="p-4 text-sm">
                <p className="text-gray-600 font-medium">{row.action} — {row.table_name} <span className="font-mono text-xs text-gray-400">{row.record_id}</span></p>
                <div className="grid grid-cols-1 gap-2 mt-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Before</p>
                    <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto max-h-48">{row.before_image ?? '—'}</pre>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">After</p>
                    <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto max-h-48">{row.after_image ?? '—'}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-white p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Actions</p>
        <RepairBatchActions
          batchId={id}
          currentStatus={batch.status}
          canPropose={canPropose}
          canApprove={canApprove}
          isOwnRequest={!!session && batch.requested_by === session.userId}
        />
      </div>
    </div>
  )
}
