import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import { ALLOWED_ROLES } from '@/lib/purchaseImport/auth'
import { rowsToObjects, parseStagingRow } from '@/lib/purchaseImport/db'

// Marks/unmarks one row reviewed. A human can never wave through a row
// that's still invalid — see the 400 below.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id, rowId } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(rowId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  if (typeof body.reviewed !== 'boolean') return NextResponse.json({ error: 'reviewed (boolean) is required' }, { status: 400 })

  try {
    const batchResult = await hasuraRunSql(`SELECT status FROM purchase_import_batches WHERE id = '${id}'::uuid`)
    const batches = rowsToObjects(batchResult)
    if (!batches.length) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    if (batches[0].status !== 'STAGED') return NextResponse.json({ error: `Cannot review a row in a ${batches[0].status} batch` }, { status: 400 })

    const rowResult = await hasuraRunSql(`SELECT * FROM purchase_import_rows WHERE id = '${rowId}'::uuid AND batch_id = '${id}'::uuid`)
    const rows = rowsToObjects(rowResult)
    if (!rows.length) return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    const row = parseStagingRow(rows[0])

    if (body.reviewed && !row.is_valid) {
      return NextResponse.json({ error: 'Cannot mark an invalid row as reviewed — fix its errors first.' }, { status: 400 })
    }

    await hasuraRunSql(`
      UPDATE purchase_import_rows SET
        reviewed = ${body.reviewed},
        reviewed_by = ${body.reviewed ? `'${session.userId}'::uuid` : 'NULL'},
        reviewed_at = ${body.reviewed ? 'NOW()' : 'NULL'}
      WHERE id = '${rowId}'::uuid
    `)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update review status' }, { status: 500 })
  }
}
