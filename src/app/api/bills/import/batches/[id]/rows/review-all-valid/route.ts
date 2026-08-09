import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import { ALLOWED_ROLES } from '@/lib/purchaseImport/auth'
import { rowsToObjects } from '@/lib/purchaseImport/db'

// Bulk-marks every currently-valid, unreviewed row in the batch reviewed —
// necessary so a 200-row file with 195 clean rows doesn't require 195
// manual clicks. Only rows that already passed exact-match validation are
// ever affected; invalid rows are untouched and still block final import.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  try {
    const batchResult = await hasuraRunSql(`SELECT status FROM purchase_import_batches WHERE id = '${id}'::uuid`)
    const batches = rowsToObjects(batchResult)
    if (!batches.length) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    if (batches[0].status !== 'STAGED') return NextResponse.json({ error: `Cannot review rows in a ${batches[0].status} batch` }, { status: 400 })

    const result = await hasuraRunSql(`
      UPDATE purchase_import_rows SET reviewed = true, reviewed_by = '${session.userId}'::uuid, reviewed_at = NOW()
      WHERE batch_id = '${id}'::uuid AND is_valid = true AND reviewed = false
      RETURNING id
    `)
    return NextResponse.json({ reviewedCount: rowsToObjects(result).length })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to review rows' }, { status: 500 })
  }
}
