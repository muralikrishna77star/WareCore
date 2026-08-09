import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_PROPOSE_REPAIR, UUID_RE } from '@/lib/dataIntegrity/auth'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// Repair types whose proposal payload this route knows how to derive itself
// from the exception's own evidence, rather than trusting whatever the
// client sends. See docs/data-integrity/REPAIR_GOVERNANCE.md — the
// execution function re-derives everything fresh at execution time anyway,
// so this proposal JSON is informational/audit only, never authoritative.
const KNOWN_PROPOSED_ACTIONS = new Set(['ARCHIVE_DUPLICATE_LEDGER_ROW'])

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
    const exceptionResult = await hasuraRunSql(`
      SELECT e.*, r.rule_code FROM reconciliation_exceptions e
      LEFT JOIN reconciliation_rules r ON r.id = e.rule_id
      WHERE e.id = '${exceptionId}'::uuid
    `)
    const exceptions = rowsToObjects(exceptionResult)
    if (!exceptions.length) return NextResponse.json({ error: 'Exception not found' }, { status: 404 })
    const exception = exceptions[0]

    let proposal: Record<string, unknown> = typeof body.proposal === 'object' && body.proposal ? body.proposal : {}

    if (proposedAction === 'ARCHIVE_DUPLICATE_LEDGER_ROW') {
      if (exception.rule_code !== 'REC-001') {
        return NextResponse.json({ error: 'ARCHIVE_DUPLICATE_LEDGER_ROW is only valid for REC-001 exceptions' }, { status: 400 })
      }
      let evidence: Record<string, unknown> = {}
      try {
        evidence = JSON.parse(exception.evidence || '{}')
      } catch {
        evidence = {}
      }
      if (evidence.confidence !== 'CONFIRMED') {
        return NextResponse.json(
          { error: `Evidence confidence is ${evidence.confidence ?? 'unknown'}, not CONFIRMED — this repair type requires CONFIRMED` },
          { status: 400 }
        )
      }
      const ids = Array.isArray(evidence.duplicate_ledger_ids) ? (evidence.duplicate_ledger_ids as string[]) : []
      proposal = { kept_ledger_id: ids[0] ?? null, archived_ledger_ids: ids.slice(1) }
    } else if (KNOWN_PROPOSED_ACTIONS.has(proposedAction)) {
      // Unreachable today (only one known action exists) — kept so adding a
      // second known action later doesn't silently fall through to the
      // "trust body.proposal" branch below without a deliberate decision.
      return NextResponse.json({ error: `No proposal-derivation rule wired up for ${proposedAction}` }, { status: 500 })
    }

    const insertResult = await hasuraRunSql(`
      INSERT INTO repair_batches (exception_id, proposed_action, proposal, before_snapshot, status, requested_by, requested_at)
      VALUES (
        '${exceptionId}'::uuid,
        '${proposedAction.replace(/'/g, "''")}',
        '${JSON.stringify(proposal).replace(/'/g, "''")}'::jsonb,
        '${JSON.stringify(exception).replace(/'/g, "''")}'::jsonb,
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
