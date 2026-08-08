import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_PROPOSE_REPAIR, UUID_RE } from '@/lib/dataIntegrity/auth'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// Creates a repair_batches row in DRAFT status ONLY — a proposal document
// for a human to review, nothing more. This route cannot execute anything:
// it never touches stock_ledger or any other production table, and there is
// no code path anywhere in this release that transitions a batch past
// APPROVED. See docs/data-integrity/REPAIR_GOVERNANCE.md.
export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_PROPOSE_REPAIR.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const exceptionId = typeof body.exceptionId === 'string' ? body.exceptionId : ''
  const proposedAction = typeof body.proposedAction === 'string' ? body.proposedAction.trim() : ''

  if (!UUID_RE.test(exceptionId)) return NextResponse.json({ error: 'Invalid exceptionId' }, { status: 400 })
  if (!proposedAction) return NextResponse.json({ error: 'proposedAction is required' }, { status: 400 })

  try {
    const exceptionResult = await hasuraRunSql(`SELECT * FROM reconciliation_exceptions WHERE id = '${exceptionId}'::uuid`)
    const exceptions = rowsToObjects(exceptionResult)
    if (!exceptions.length) return NextResponse.json({ error: 'Exception not found' }, { status: 404 })

    const insertResult = await hasuraRunSql(`
      INSERT INTO repair_batches (exception_id, proposed_action, proposal, before_snapshot, status, requested_by, requested_at)
      VALUES (
        '${exceptionId}'::uuid,
        '${proposedAction.replace(/'/g, "''")}',
        '${JSON.stringify(typeof body.proposal === 'object' && body.proposal ? body.proposal : {}).replace(/'/g, "''")}'::jsonb,
        '${JSON.stringify(exceptions[0]).replace(/'/g, "''")}'::jsonb,
        'DRAFT',
        '${session.userId}'::uuid,
        NOW()
      )
      RETURNING id, repair_batch_number, status
    `)
    await hasuraRunSql(`UPDATE reconciliation_exceptions SET status = 'REPAIR_PROPOSED' WHERE id = '${exceptionId}'::uuid AND status NOT IN ('RESOLVED', 'IGNORED')`)

    return NextResponse.json({ repairBatch: rowsToObjects(insertResult)[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create repair proposal' }, { status: 500 })
  }
}
