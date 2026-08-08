export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import StatusForm from './StatusForm'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-gray-100 text-gray-700',
  INFO: 'bg-blue-100 text-blue-700',
}

export default async function ExceptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null
  const canClose = session?.role === 'admin' || session?.role === 'developer'

  const [exceptionResult, evidenceResult, repairResult] = await Promise.all([
    hasuraRunSql(`
      SELECT e.*, r.rule_code, r.rule_name, r.description AS rule_description
      FROM reconciliation_exceptions e LEFT JOIN reconciliation_rules r ON r.id = e.rule_id
      WHERE e.id = '${id}'::uuid
    `),
    hasuraRunSql(`SELECT * FROM reconciliation_exception_rows WHERE exception_id = '${id}'::uuid ORDER BY created_at`),
    hasuraRunSql(`SELECT id, repair_batch_number, status, proposed_action, created_at FROM repair_batches WHERE exception_id = '${id}'::uuid ORDER BY created_at DESC`),
  ])

  const exceptions = rowsToObjects(exceptionResult)
  if (!exceptions.length) notFound()
  const exception = exceptions[0]
  const evidenceRows = rowsToObjects(evidenceResult)
  const repairBatches = rowsToObjects(repairResult)

  let evidence: Record<string, unknown> = {}
  try {
    evidence = JSON.parse(exception.evidence || '{}')
  } catch {
    // leave empty — malformed evidence shouldn't crash the page
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">{exception.exception_number}</h2>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[exception.severity] ?? 'bg-gray-100'}`}>{exception.severity}</span>
              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">{exception.status}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{exception.rule_code} — {exception.rule_name}</p>
          </div>
          <p className="text-xs text-gray-400">
            First detected {new Date(exception.first_detected_at).toLocaleString()} · last {new Date(exception.last_detected_at).toLocaleString()} · seen {exception.occurrence_count}×
          </p>
        </div>
        <p className="mt-3 font-medium text-gray-900">{exception.summary}</p>
        {exception.explanation && <p className="mt-1 text-sm text-gray-600">{exception.explanation}</p>}
        {exception.suspected_cause && (
          <p className="mt-2 text-sm text-gray-500"><span className="font-medium text-gray-700">Suspected cause: </span>{exception.suspected_cause}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-gray-500">Expected</p>
          <p className="text-lg font-bold text-gray-900">{exception.expected_value ?? '—'}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-gray-500">Actual</p>
          <p className="text-lg font-bold text-gray-900">{exception.actual_value ?? '—'}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-gray-500">Difference</p>
          <p className={`text-lg font-bold ${Number(exception.difference) < 0 ? 'text-red-600' : 'text-gray-900'}`}>{exception.difference ?? '—'}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Source</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-gray-500">Document type</dt><dd className="text-gray-900">{exception.source_document_type ?? '—'}</dd>
          <dt className="text-gray-500">Document id</dt><dd className="text-gray-900 font-mono text-xs">{exception.source_document_id ?? '—'}</dd>
          <dt className="text-gray-500">Line</dt><dd className="text-gray-900">{exception.source_line_id ?? exception.purchase_line_id ?? '—'}</dd>
          <dt className="text-gray-500">Reference</dt><dd className="text-gray-900">{exception.reference_number ?? '—'}</dd>
        </dl>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Evidence</p>
        <pre className="text-xs bg-gray-50 rounded p-3 overflow-auto max-h-64">{JSON.stringify(evidence, null, 2)}</pre>
      </div>

      {evidenceRows.length > 0 && (
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-6 py-3 border-b bg-gray-50">
            <span className="font-semibold text-gray-700 text-sm">Evidence rows (preserved snapshots)</span>
          </div>
          <div className="divide-y divide-gray-100">
            {evidenceRows.map((row) => (
              <div key={row.id} className="p-4 text-sm">
                <p className="text-gray-600 font-medium">{row.record_type} — {row.table_name} {row.relationship ? `(${row.relationship})` : ''}</p>
                <pre className="text-xs bg-gray-50 rounded p-2 mt-1 overflow-auto">{row.snapshot}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-amber-50 border-amber-200 p-4">
        <p className="text-sm font-semibold text-amber-900">Proposed repair</p>
        <p className="text-sm text-amber-800 mt-1">
          Repair execution is disabled. Review and approval workflow will be enabled only after validation in shadow mode.
        </p>
        {repairBatches.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-amber-900">
            {repairBatches.map((b) => (
              <li key={b.id}>{b.repair_batch_number} — {b.proposed_action} <span className="text-xs">({b.status})</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Update status</p>
        <StatusForm exceptionId={id} currentStatus={exception.status} canClose={!!canClose} />
        {exception.resolution_notes && (
          <p className="mt-3 text-sm text-gray-600"><span className="font-medium">Resolution notes: </span>{exception.resolution_notes}</p>
        )}
      </div>
    </div>
  )
}
