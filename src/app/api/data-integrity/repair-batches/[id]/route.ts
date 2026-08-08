import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_VIEW, UUID_RE } from '@/lib/dataIntegrity/auth'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// Read-only. There is deliberately no PATCH/POST on this route in Phase 1 —
// approving or executing a repair batch has no implementation anywhere in
// this release (see docs/data-integrity/REPAIR_GOVERNANCE.md).
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
