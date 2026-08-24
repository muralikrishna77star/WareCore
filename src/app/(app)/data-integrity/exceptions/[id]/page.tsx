export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import Link from 'next/link'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE, CAN_PROPOSE_REPAIR } from '@/lib/dataIntegrity/auth'
import StatusForm from './StatusForm'
import ProposeRepairForm from './ProposeRepairForm'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// hasuraRunSql's run_sql endpoint stringifies booleans using Postgres's own
// text output format — 't'/'f' — not 'true'/'false'. See
// src/lib/purchaseImport/db.ts's toBool() for the same fix elsewhere.
const isTrue = (v: string | undefined) => v === 'true' || v === 't'

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
  const canPropose = !!session && CAN_PROPOSE_REPAIR.has(session.role)

  const [exceptionResult, evidenceResult, repairResult, settingsResult] = await Promise.all([
    hasuraRunSql(`
      SELECT e.*, r.rule_code, r.rule_name, r.description AS rule_description
      FROM reconciliation_exceptions e LEFT JOIN reconciliation_rules r ON r.id = e.rule_id
      WHERE e.id = '${id}'::uuid
    `),
    hasuraRunSql(`SELECT * FROM reconciliation_exception_rows WHERE exception_id = '${id}'::uuid ORDER BY created_at`),
    hasuraRunSql(`SELECT id, repair_batch_number, status, proposed_action, created_at FROM repair_batches WHERE exception_id = '${id}'::uuid ORDER BY created_at DESC`),
    hasuraRunSql(`SELECT repair_execution_enabled FROM reconciliation_settings WHERE id = TRUE`),
  ])

  const exceptions = rowsToObjects(exceptionResult)
  if (!exceptions.length) notFound()
  const exception = exceptions[0]
  const evidenceRows = rowsToObjects(evidenceResult)
  const repairBatches = rowsToObjects(repairResult)
  const repairExecutionEnabled = isTrue(rowsToObjects(settingsResult)[0]?.repair_execution_enabled)

  let evidence: Record<string, unknown> = {}
  try {
    evidence = JSON.parse(exception.evidence || '{}')
  } catch {
    // leave empty — malformed evidence shouldn't crash the page
  }

  // REC-005 (Negative company-wide stock) only: pull the actual chronological
  // ledger movement trail for this exact scope, plus a read-only diagnosis of
  // WHICH known pattern produced the dip — the generic evidence JSON above
  // only ever carried the minimum/current balance, never the transactions
  // themselves or a specific reason, matching the user's ask to see the data
  // and the "why" rather than just the number. Deliberately diagnose-only —
  // no write actions — same scope choice already made for Item-by-Item
  // Reconciliation's Review & Fix.
  let movementHistory: Record<string, string>[] = []
  let diagnosis: {
    duplicates: Record<string, string>[]
    reversalExceedsOriginal: Record<string, string>[]
    negativeLines: Record<string, string>[]
    missingPurchaseInflow: Record<string, string>[]
  } | null = null

  if (exception.rule_code === 'REC-005' && exception.company_id && exception.material_type_id) {
    const sizeFilter = exception.material_size_id
      ? `material_size_id = '${exception.material_size_id}'::uuid`
      : `material_size_id IS NULL`

    const [movementResult, dupResult, reversalResult, lineResult, missingInflowResult] = await Promise.all([
      hasuraRunSql(`
        SELECT sl.id, sl.entry_type, sl.quantity, sl.entry_date, sl.created_at,
               sl.reference_type, sl.reference_number, sl.purchase_line_id, sl.sub_purchase_line_id,
               sl.notes,
               SUM(sl.quantity) OVER (
                 ORDER BY sl.entry_date, sl.quantity DESC, sl.created_at
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS running_balance
        FROM stock_ledger sl
        WHERE sl.company_id = '${exception.company_id}'::uuid
          AND sl.material_type_id = '${exception.material_type_id}'::uuid
          AND sl.${sizeFilter}
        ORDER BY sl.entry_date, sl.quantity DESC, sl.created_at
      `),
      // Pattern 1: exact duplicate rows (same entry_type/reference/line/qty
      // more than once) — the CR00700-shaped defect (double-submit/edit).
      hasuraRunSql(`
        SELECT entry_type, reference_id::text, purchase_line_id, sub_purchase_line_id, quantity::text,
               count(*)::text AS dup_count, array_agg(id)::text AS ledger_ids, array_agg(reference_number)::text AS reference_numbers
        FROM stock_ledger
        WHERE company_id = '${exception.company_id}'::uuid
          AND material_type_id = '${exception.material_type_id}'::uuid
          AND ${sizeFilter}
          AND (purchase_line_id IS NOT NULL OR sub_purchase_line_id IS NOT NULL OR reference_id IS NOT NULL)
        GROUP BY entry_type, reference_id, purchase_line_id, sub_purchase_line_id, quantity
        HAVING count(*) > 1
      `),
      // Pattern 2: a PURCHASE_CANCEL exceeding what was ever purchased on
      // that line (over-cancellation) — same invariant as REC-007, scoped
      // down to this exception's exact company/material/size.
      hasuraRunSql(`
        SELECT purchase_line_id,
               COALESCE(SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_IN'), 0)::text AS total_in,
               COALESCE(-SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_CANCEL'), 0)::text AS total_cancelled
        FROM stock_ledger
        WHERE company_id = '${exception.company_id}'::uuid
          AND material_type_id = '${exception.material_type_id}'::uuid
          AND ${sizeFilter}
          AND purchase_line_id IS NOT NULL
        GROUP BY purchase_line_id
        HAVING COALESCE(-SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_CANCEL'), 0)
             > COALESCE(SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_IN'), 0) + 0.001
      `),
      // Pattern 3: which SPECIFIC purchase line within this material/size
      // scope is actually negative on its own — pinpoints the concentrated
      // culprit rather than leaving it as an aggregate-only number, since
      // REC-005 groups by material/size, not by line.
      hasuraRunSql(`
        SELECT purchase_line_id, SUM(quantity)::text AS net_balance
        FROM stock_ledger
        WHERE company_id = '${exception.company_id}'::uuid
          AND material_type_id = '${exception.material_type_id}'::uuid
          AND ${sizeFilter}
          AND purchase_line_id IS NOT NULL
        GROUP BY purchase_line_id
        HAVING SUM(quantity) < -0.001
        ORDER BY SUM(quantity) ASC
      `),
      // Pattern 4: a purchase line with outflow activity (job work/sale) in
      // this scope but NO PURCHASE_IN at all — the single most common real
      // shape found while building this (e.g. a sale posted against a line
      // whose purchase was recorded under a different material/size, or
      // never posted at all).
      hasuraRunSql(`
        SELECT purchase_line_id,
               COALESCE(SUM(quantity) FILTER (WHERE entry_type <> 'PURCHASE_IN'), 0)::text AS total_other_activity
        FROM stock_ledger
        WHERE company_id = '${exception.company_id}'::uuid
          AND material_type_id = '${exception.material_type_id}'::uuid
          AND ${sizeFilter}
          AND purchase_line_id IS NOT NULL
        GROUP BY purchase_line_id
        HAVING COALESCE(SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_IN'), 0) = 0
           AND COALESCE(SUM(quantity) FILTER (WHERE entry_type <> 'PURCHASE_IN'), 0) <> 0
      `),
    ])

    movementHistory = rowsToObjects(movementResult)
    diagnosis = {
      duplicates: rowsToObjects(dupResult),
      reversalExceedsOriginal: rowsToObjects(reversalResult),
      negativeLines: rowsToObjects(lineResult),
      missingPurchaseInflow: rowsToObjects(missingInflowResult),
    }
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

      {diagnosis && (
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm font-semibold text-gray-700 mb-1">Why it went negative</p>
          <p className="text-xs text-gray-500 mb-3">Read-only diagnosis against the exact company/material/size scope above — no data is changed here.</p>

          {diagnosis.duplicates.length === 0 && diagnosis.reversalExceedsOriginal.length === 0 &&
            diagnosis.negativeLines.length === 0 && diagnosis.missingPurchaseInflow.length === 0 && (
            <p className="text-sm text-gray-600">No known pattern (duplicate posting, over-cancellation, a single negative purchase line, or a missing purchase inflow) matched — review the movement history below manually.</p>
          )}

          {diagnosis.missingPurchaseInflow.length > 0 && (
            <div className="mb-3">
              <p className="text-sm font-medium text-red-700">Purchase line has activity but no purchase-in was ever posted</p>
              <ul className="mt-1 text-sm text-gray-700 space-y-1">
                {diagnosis.missingPurchaseInflow.map((l, i) => (
                  <li key={i}>Line {l.purchase_line_id}: {l.total_other_activity} of outflow activity, but 0 purchased in this exact material/size scope — likely posted under a different size, or never invoiced.</li>
                ))}
              </ul>
            </div>
          )}

          {diagnosis.duplicates.length > 0 && (
            <div className="mb-3">
              <p className="text-sm font-medium text-red-700">Duplicate ledger rows found</p>
              <ul className="mt-1 text-sm text-gray-700 space-y-1">
                {diagnosis.duplicates.map((d, i) => (
                  <li key={i}>
                    {d.dup_count}× <span className="font-mono text-xs">{d.entry_type}</span> rows of quantity {d.quantity}
                    {d.purchase_line_id ? ` on line ${d.purchase_line_id}` : ''} — reference numbers {d.reference_numbers}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diagnosis.reversalExceedsOriginal.length > 0 && (
            <div className="mb-3">
              <p className="text-sm font-medium text-red-700">Cancellation exceeds what was ever purchased</p>
              <ul className="mt-1 text-sm text-gray-700 space-y-1">
                {diagnosis.reversalExceedsOriginal.map((r, i) => (
                  <li key={i}>Line {r.purchase_line_id}: purchased {r.total_in}, cancelled {r.total_cancelled}</li>
                ))}
              </ul>
            </div>
          )}

          {diagnosis.negativeLines.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-700">Specific purchase line(s) actually negative</p>
              <ul className="mt-1 text-sm text-gray-700 space-y-1">
                {diagnosis.negativeLines.map((l, i) => (
                  <li key={i}>Line {l.purchase_line_id}: net {l.net_balance}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {movementHistory.length > 0 && (
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-6 py-3 border-b bg-gray-50">
            <span className="font-semibold text-gray-700 text-sm">Ledger movement history for this scope</span>
          </div>
          <div className="overflow-auto max-h-96">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Entry Type</th>
                  <th className="px-4 py-2 text-left">Reference</th>
                  <th className="px-4 py-2 text-left">Line</th>
                  <th className="px-4 py-2 text-right">Quantity</th>
                  <th className="px-4 py-2 text-right">Running Balance</th>
                  <th className="px-4 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movementHistory.map((m) => (
                  <tr key={m.id} className={Number(m.running_balance) < 0 ? 'bg-red-50' : undefined}>
                    <td className="px-4 py-2 whitespace-nowrap">{m.entry_date}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.entry_type}</td>
                    <td className="px-4 py-2">{m.reference_number ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.purchase_line_id ?? m.sub_purchase_line_id ?? '—'}</td>
                    <td className="px-4 py-2 text-right">{m.quantity}</td>
                    <td className={`px-4 py-2 text-right font-medium ${Number(m.running_balance) < 0 ? 'text-red-600' : 'text-gray-900'}`}>{m.running_balance}</td>
                    <td className="px-4 py-2 text-gray-500">{m.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
        {!repairExecutionEnabled && (
          <p className="text-sm text-amber-800 mt-1">
            Repair execution is disabled (reconciliation_settings.repair_execution_enabled = FALSE) — an admin/developer can enable it from the Rules page.
          </p>
        )}
        {repairBatches.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-amber-900">
            {repairBatches.map((b) => (
              <li key={b.id}>
                <Link href={`/data-integrity/repair-batches/${b.id}`} className="underline hover:no-underline">
                  {b.repair_batch_number}
                </Link>
                {' '}— {b.proposed_action} <span className="text-xs">({b.status})</span>
              </li>
            ))}
          </ul>
        )}
        {repairExecutionEnabled &&
          canPropose &&
          exception.rule_code === 'REC-001' &&
          evidence.confidence === 'CONFIRMED' &&
          !['RESOLVED', 'IGNORED'].includes(exception.status) &&
          !repairBatches.some((b) => b.status !== 'REJECTED') && (
            <div className="mt-3">
              <ProposeRepairForm exceptionId={id} />
            </div>
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
