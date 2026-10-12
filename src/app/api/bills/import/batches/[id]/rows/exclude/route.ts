import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import { sqlTextOrNull } from '@/lib/dataIntegrity/sqlSafe'
import { ALLOWED_ROLES } from '@/lib/purchaseImport/auth'
import { rowsToObjects } from '@/lib/purchaseImport/db'

// Skips (or brings back) one or more rows of a STAGED batch (migration 161).
// A skipped row stays in the batch as a record but is left out of the
// import, so a file with a few unwanted lines no longer has to be deleted
// and re-uploaded. Body: { rowIds: string[], excluded: boolean, reason?: string }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  if (typeof body.excluded !== 'boolean') return NextResponse.json({ error: 'excluded (boolean) is required' }, { status: 400 })
  const rowIds: unknown = body.rowIds
  if (!Array.isArray(rowIds) || rowIds.length === 0) return NextResponse.json({ error: 'Select at least one row.' }, { status: 400 })
  // Validate every id before it is embedded in SQL.
  if (!rowIds.every((r) => typeof r === 'string' && UUID_RE.test(r))) return NextResponse.json({ error: 'Invalid row selection — reload and try again.' }, { status: 400 })
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null

  try {
    const batchResult = await hasuraRunSql(`SELECT status FROM purchase_import_batches WHERE id = '${id}'::uuid`)
    const batches = rowsToObjects(batchResult)
    if (!batches.length) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    if (batches[0].status !== 'STAGED') {
      return NextResponse.json({ error: `This batch is ${batches[0].status.toLowerCase()} — its rows can no longer be skipped or included.` }, { status: 400 })
    }

    const idList = (rowIds as string[]).map((r) => `'${r}'::uuid`).join(',')
    const userSql = UUID_RE.test(session.userId) ? `'${session.userId}'::uuid` : 'NULL'
    const result = await hasuraRunSql(
      body.excluded
        ? `UPDATE purchase_import_rows
           SET excluded = true, excluded_by = ${userSql}, excluded_at = NOW(), exclusion_reason = ${sqlTextOrNull(reason)}
           WHERE batch_id = '${id}'::uuid AND id IN (${idList})
           RETURNING id`
        : `UPDATE purchase_import_rows
           SET excluded = false, excluded_by = NULL, excluded_at = NULL, exclusion_reason = NULL
           WHERE batch_id = '${id}'::uuid AND id IN (${idList})
           RETURNING id`
    )
    return NextResponse.json({ updated: rowsToObjects(result).length })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update rows' }, { status: 500 })
  }
}
