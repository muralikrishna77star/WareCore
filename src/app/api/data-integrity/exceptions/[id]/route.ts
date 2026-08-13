import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_VIEW, UUID_RE } from '@/lib/dataIntegrity/auth'

// Only review/triage transitions are reachable through this route.
// APPROVED and REPAIR_PROPOSED are set exclusively by the repair-proposal
// and repair-batch-approval flows (POST /api/data-integrity/repair-proposals,
// a future approval endpoint) — never by a bare status PATCH here, so an
// exception can never be waved through to "approved for repair" by a
// client-side status edit alone.
const PATCHABLE_STATUSES = new Set(['ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'IGNORED'])

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid exception id' }, { status: 400 })

  try {
    const exceptionResult = await hasuraRunSql(`
      SELECT e.*, r.rule_code, r.rule_name, r.description AS rule_description
      FROM reconciliation_exceptions e
      LEFT JOIN reconciliation_rules r ON r.id = e.rule_id
      WHERE e.id = '${id}'::uuid
    `)
    const exceptions = rowsToObjects(exceptionResult)
    if (!exceptions.length) return NextResponse.json({ error: 'Exception not found' }, { status: 404 })

    const [rowsResult, batchesResult] = await Promise.all([
      hasuraRunSql(`SELECT * FROM reconciliation_exception_rows WHERE exception_id = '${id}'::uuid ORDER BY created_at`),
      hasuraRunSql(`SELECT id, repair_batch_number, status, proposed_action, created_at FROM repair_batches WHERE exception_id = '${id}'::uuid ORDER BY created_at DESC`),
    ])

    return NextResponse.json({
      exception: exceptions[0],
      evidenceRows: rowsToObjects(rowsResult),
      repairBatches: rowsToObjects(batchesResult),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load exception' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  // company_manager/billing_staff may triage (acknowledge/investigate/note)
  // but resolving or ignoring an exception is left to admin/developer to
  // keep the "who can close a defect" bar consistent with who can manage
  // rules — narrower than CAN_VIEW, wider than repair approval.
  const canClose = session.role === 'admin' || session.role === 'developer'

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid exception id' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const updates: string[] = []

  if (typeof body.status === 'string') {
    if (!PATCHABLE_STATUSES.has(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${[...PATCHABLE_STATUSES].join(', ')}` }, { status: 400 })
    }
    if ((body.status === 'RESOLVED' || body.status === 'IGNORED') && !canClose) {
      return NextResponse.json({ error: 'Only admin/developer can resolve or ignore an exception' }, { status: 403 })
    }
    updates.push(`status = '${body.status}'`)
    if (body.status === 'RESOLVED') {
      updates.push(`resolved_at = NOW()`, `resolved_by = '${session.userId}'::uuid`)
    }
  }

  if (typeof body.assignedTo === 'string') {
    if (!UUID_RE.test(body.assignedTo)) return NextResponse.json({ error: 'Invalid assignedTo' }, { status: 400 })
    updates.push(`assigned_to = '${body.assignedTo}'::uuid`)
  }

  if (typeof body.resolutionNotes === 'string') {
    updates.push(`resolution_notes = '${body.resolutionNotes.replace(/'/g, "''")}'`)
  }

  if (!updates.length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  try {
    await hasuraRunSql(`UPDATE reconciliation_exceptions SET ${updates.join(', ')} WHERE id = '${id}'::uuid`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update exception' }, { status: 500 })
  }
}
