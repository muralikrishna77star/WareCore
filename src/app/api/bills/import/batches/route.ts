import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, createHash } from 'node:crypto'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { ALLOWED_ROLES } from '@/lib/purchaseImport/auth'
import { parseWorkbook } from '@/lib/purchaseImport/parseWorkbook'
import { resolveRowIndependent } from '@/lib/purchaseImport/resolve'
import { fetchMasterDataSnapshot } from '@/lib/purchaseImport/fetchSnapshot'
import { buildStageInsertScript, type StagedRowInput } from '@/lib/purchaseImport/buildStageInsertScript'
import { rowsToObjects } from '@/lib/purchaseImport/db'

const BATCH_STATUSES = new Set(['STAGED', 'IMPORTED', 'CANCELLED'])

// Uploads a file, stages every row (independently resolved/validated — see
// resolveRowIndependent()), and creates a batch. No purchase_bills/
// purchase_bill_items rows are touched here — that only happens at
// POST .../batches/[id]/import once every row is valid and reviewed.
export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  const confirmDuplicate = formData?.get('confirmDuplicate') === 'true'

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const fileHash = createHash('sha256').update(buffer).digest('hex')

    // Check ALL prior batches with this hash regardless of status —
    // including IMPORTED, since silently re-importing an already-imported
    // file would mint a second, different set of bill numbers (a real
    // double-billing risk, not a cosmetic one).
    const dupResult = await hasuraRunSql(
      `SELECT id, batch_number, status, created_at FROM purchase_import_batches WHERE file_hash = '${fileHash}' ORDER BY created_at DESC`
    )
    const duplicates = rowsToObjects(dupResult)
    if (duplicates.length && !confirmDuplicate) {
      return NextResponse.json({
        duplicate: true,
        matchingBatches: duplicates.map((d) => ({ id: d.id, batchNumber: d.batch_number, status: d.status, createdAt: d.created_at })),
      })
    }

    const { rows, errors: parseErrors } = await parseWorkbook(buffer)
    if (parseErrors.length) return NextResponse.json({ error: 'Could not read the file.', errors: parseErrors }, { status: 400 })
    if (!rows.length) return NextResponse.json({ error: 'No data rows found in the file.' }, { status: 400 })

    const snapshot = await fetchMasterDataSnapshot()
    const stagedRows: StagedRowInput[] = rows.map((row) => ({
      rowNumber: row.rowNumber,
      parsedRow: row,
      resolution: resolveRowIndependent(row, snapshot),
    }))

    const batchId = randomUUID()
    const script = buildStageInsertScript(
      {
        id: batchId,
        fileName: file.name,
        fileHash,
        fileSizeBytes: buffer.length,
        rowCount: rows.length,
        createdBy: session.userId,
        duplicateOfBatchId: confirmDuplicate && duplicates.length ? duplicates[0].id : null,
      },
      stagedRows
    )
    await hasuraRunSql(script)

    return NextResponse.json({ batchId }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create import batch' }, { status: 500 })
  }
}

// History list for the /bills/import landing page.
export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  if (status && !BATCH_STATUSES.has(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  const statusFilter = status ? `WHERE b.status = '${status}'` : ''

  try {
    const result = await hasuraRunSql(`
      SELECT
        b.id, b.batch_number, b.file_name, b.status, b.row_count, b.created_at, b.imported_at,
        (SELECT COUNT(*) FROM purchase_import_rows r WHERE r.batch_id = b.id AND r.is_valid) AS valid_rows,
        (SELECT COUNT(*) FROM purchase_import_rows r WHERE r.batch_id = b.id AND r.reviewed) AS reviewed_rows
      FROM purchase_import_batches b
      ${statusFilter}
      ORDER BY b.created_at DESC
      LIMIT 100
    `)
    return NextResponse.json({ batches: rowsToObjects(result) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to list import batches' }, { status: 500 })
  }
}
