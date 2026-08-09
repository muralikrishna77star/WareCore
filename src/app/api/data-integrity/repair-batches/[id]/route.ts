import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_VIEW, CAN_PROPOSE_REPAIR, CAN_APPROVE_REPAIR, UUID_RE } from '@/lib/dataIntegrity/auth'
import { sqlText, sqlTextOrNull } from '@/lib/dataIntegrity/sqlSafe'
import { runReconciliation } from '@/lib/dataIntegrity/engine'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// Every reachable status transition, keyed by the batch's CURRENT status.
// Mirrors the allowlist style of src/app/api/data-integrity/exceptions/[id]/route.ts.
// No route anywhere may move a batch to a status not listed here for its
// current status — this is the entire enforcement of the lifecycle diagram
// in docs/data-integrity/REPAIR_GOVERNANCE.md.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING_APPROVAL'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['EXECUTED'],
  EXECUTION_FAILED: ['ROLLED_BACK'],
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid repair batch id' }, { status: 400 })

  try {
    const result = await hasuraRunSql(`SELECT * FROM repair_batches WHERE id = '${id}'::uuid`)
    const rows = rowsToObjects(result)
    if (!rows.length) return NextResponse.json({ error: 'Repair batch not found' }, { status: 404 })

    const auditResult = await hasuraRunSql(`SELECT * FROM repair_audit_rows WHERE repair_batch_id = '${id}'::uuid ORDER BY created_at`)
    return NextResponse.json({ repairBatch: rows[0], auditRows: rowsToObjects(auditResult) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load repair batch' }, { status: 500 })
  }
}

// Drives the entire repair_batches status lifecycle (see ALLOWED_TRANSITIONS
// above) through one PATCH + {status: <target>}, matching the convention in
// src/app/api/data-integrity/exceptions/[id]/route.ts rather than separate
// /approve, /reject, /execute endpoints.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid repair batch id' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const targetStatus = typeof body.status === 'string' ? body.status : ''

  let batch: Record<string, string>
  try {
    const batchResult = await hasuraRunSql(`SELECT * FROM repair_batches WHERE id = '${id}'::uuid`)
    const batches = rowsToObjects(batchResult)
    if (!batches.length) return NextResponse.json({ error: 'Repair batch not found' }, { status: 404 })
    batch = batches[0]
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load repair batch' }, { status: 500 })
  }

  const allowed = ALLOWED_TRANSITIONS[batch.status] ?? []
  if (!allowed.includes(targetStatus)) {
    return NextResponse.json({ error: `Cannot transition batch from ${batch.status} to ${targetStatus || '(missing status)'}` }, { status: 400 })
  }

  try {
    if (targetStatus === 'PENDING_APPROVAL') {
      if (!CAN_PROPOSE_REPAIR.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      await hasuraRunSql(`UPDATE repair_batches SET status = 'PENDING_APPROVAL' WHERE id = '${id}'::uuid AND status = 'DRAFT'`)
      return NextResponse.json({ ok: true })
    }

    if (targetStatus === 'APPROVED' || targetStatus === 'REJECTED') {
      if (!CAN_APPROVE_REPAIR.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      if (batch.requested_by && batch.requested_by === session.userId) {
        return NextResponse.json({ error: 'Maker-checker: the approver must differ from the requester' }, { status: 403 })
      }

      if (targetStatus === 'APPROVED') {
        await hasuraRunSql(`
          UPDATE repair_batches SET status = 'APPROVED', approved_by = '${session.userId}'::uuid, approved_at = NOW()
          WHERE id = '${id}'::uuid AND status = 'PENDING_APPROVAL'
        `)
        await hasuraRunSql(`UPDATE reconciliation_exceptions SET status = 'APPROVED' WHERE id = '${batch.exception_id}'::uuid AND status NOT IN ('RESOLVED', 'IGNORED')`)
      } else {
        const reason = typeof body.rejectionReason === 'string' ? sqlTextOrNull(body.rejectionReason) : 'NULL'
        await hasuraRunSql(`
          UPDATE repair_batches SET status = 'REJECTED', approved_by = '${session.userId}'::uuid, approved_at = NOW(), error_message = ${reason}
          WHERE id = '${id}'::uuid AND status = 'PENDING_APPROVAL'
        `)
        // Returns the exception to the triage queue — a rejected proposal
        // means "no active repair", not "still under review".
        await hasuraRunSql(`UPDATE reconciliation_exceptions SET status = 'OPEN' WHERE id = '${batch.exception_id}'::uuid AND status NOT IN ('RESOLVED', 'IGNORED')`)
      }
      return NextResponse.json({ ok: true })
    }

    if (targetStatus === 'EXECUTED') {
      if (!CAN_APPROVE_REPAIR.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

      // hasuraRunSql renders boolean columns using Postgres's own text
      // output format — 't'/'f' — not 'true'/'false' (see
      // src/lib/purchaseImport/db.ts's toBool()).
      const settingsResult = await hasuraRunSql(`SELECT repair_execution_enabled FROM reconciliation_settings WHERE id = TRUE`)
      const executionEnabled = rowsToObjects(settingsResult)[0]?.repair_execution_enabled
      if (executionEnabled !== 'true' && executionEnabled !== 't') {
        return NextResponse.json({ error: 'Repair execution is disabled (reconciliation_settings.repair_execution_enabled = FALSE)' }, { status: 403 })
      }

      const flipResult = await hasuraRunSql(`UPDATE repair_batches SET status = 'EXECUTING' WHERE id = '${id}'::uuid AND status = 'APPROVED' RETURNING id`)
      if (!rowsToObjects(flipResult).length) {
        return NextResponse.json({ error: 'Batch is no longer APPROVED — someone else may already be executing it' }, { status: 409 })
      }

      try {
        const execResult = await hasuraRunSql(`SELECT * FROM fn_repair_archive_duplicate_ledger_row('${id}'::uuid, '${session.userId}'::uuid)`)
        const executed = rowsToObjects(execResult)[0]

        // Same fingerprint-based mechanism the engine already uses for
        // RESOLVED/REOPENED/IGNORED-sticky semantics — closes REC-001 (fully
        // resolved) and lets REC-007 self-resolve on the same purchase line.
        // Awaited deliberately: this is a Vercel-deployed serverless app, so
        // work left running after the response is sent is not guaranteed to
        // finish (see src/app/api/data-integrity/runs/route.ts, which
        // already awaits the identical call shape for a manual scan).
        const today = new Date().toISOString().slice(0, 10)
        await runReconciliation({
          runType: 'POST_REPAIR',
          scopeType: 'FULL',
          companyId: null,
          fromDate: '2000-01-01',
          toDate: today,
          startedBy: session.userId,
        })

        return NextResponse.json({ repairBatch: executed })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Repair execution failed'
        await hasuraRunSql(`
          UPDATE repair_batches SET status = 'EXECUTION_FAILED', error_message = ${sqlText(message)}
          WHERE id = '${id}'::uuid AND status = 'EXECUTING'
        `).catch(() => {})
        return NextResponse.json({ error: message }, { status: 500 })
      }
    }

    if (targetStatus === 'ROLLED_BACK') {
      if (!CAN_APPROVE_REPAIR.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      await hasuraRunSql(`UPDATE repair_batches SET status = 'ROLLED_BACK' WHERE id = '${id}'::uuid AND status = 'EXECUTION_FAILED'`)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unhandled transition' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update repair batch' }, { status: 500 })
  }
}
