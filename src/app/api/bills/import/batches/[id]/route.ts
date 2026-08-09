import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import { ALLOWED_ROLES } from '@/lib/purchaseImport/auth'
import { rowsToObjects, parseStagingRow } from '@/lib/purchaseImport/db'
import { findDuplicateLines, type DuplicateCheckEntry } from '@/lib/purchaseImport/resolve'

// Batch + every staging row + non-blocking cross-row duplicate warnings
// (the same check resolveImport() enforces as a hard error at commit time —
// surfaced here early so the review screen can flag it before Import).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  try {
    const batchResult = await hasuraRunSql(`SELECT * FROM purchase_import_batches WHERE id = '${id}'::uuid`)
    const batches = rowsToObjects(batchResult)
    if (!batches.length) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

    const rowsResult = await hasuraRunSql(`SELECT * FROM purchase_import_rows WHERE batch_id = '${id}'::uuid ORDER BY row_number`)
    const rows = rowsToObjects(rowsResult).map(parseStagingRow)

    const duplicateEntries: DuplicateCheckEntry[] = rows
      .filter((r) => r.is_valid && r.resolved_field_ids)
      .map((r) => ({
        rowNumber: r.row_number,
        companyId: r.resolved_field_ids!.companyId!,
        warehouseId: r.resolved_field_ids!.warehouseId!,
        supplierId: r.resolved_field_ids!.supplierId!,
        billDate: r.current_data.billDate,
        billRef: r.current_data.billRef,
        materialTypeId: r.resolved_field_ids!.materialTypeId!,
        materialSizeId: r.resolved_field_ids!.materialSizeId,
        quantity: r.current_data.quantity ?? 0,
        rate: r.current_data.rate ?? 0,
      }))
    const batchWarnings = findDuplicateLines(duplicateEntries)

    const counts = {
      total: rows.length,
      valid: rows.filter((r) => r.is_valid).length,
      reviewed: rows.filter((r) => r.reviewed).length,
      readyToImport: rows.length > 0 && rows.every((r) => r.is_valid && r.reviewed),
    }

    return NextResponse.json({ batch: batches[0], rows, batchWarnings, counts })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load batch' }, { status: 500 })
  }
}

// Permanently removes a batch and its staging rows (ON DELETE CASCADE) — for
// cleaning up a batch that turned out to be the wrong file, so the user can
// fix it and upload fresh without the old attempt cluttering the batch
// history. Never allowed on an IMPORTED batch: that batch is the audit
// record for real purchase_bills already created from it, and deleting the
// batch row does NOT touch those bills — removing the batch would just
// sever the audit trail while leaving the actual financial records intact,
// which is confusing at best. Cancel (STAGED -> CANCELLED) already exists
// for "stop, don't import this" while keeping a record; this is for
// actually discarding one, from either STAGED or CANCELLED.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  try {
    const batchResult = await hasuraRunSql(`SELECT status FROM purchase_import_batches WHERE id = '${id}'::uuid`)
    const batches = rowsToObjects(batchResult)
    if (!batches.length) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    if (batches[0].status === 'IMPORTED') {
      return NextResponse.json({ error: 'Cannot delete an imported batch — it is the audit record for bills already created from it.' }, { status: 400 })
    }

    await hasuraRunSql(`DELETE FROM purchase_import_batches WHERE id = '${id}'::uuid AND status <> 'IMPORTED'`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to delete batch' }, { status: 500 })
  }
}
