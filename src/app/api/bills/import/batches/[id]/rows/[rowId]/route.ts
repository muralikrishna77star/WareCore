import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import { ALLOWED_ROLES } from '@/lib/purchaseImport/auth'
import { rowsToObjects, parseStagingRow, sqlJsonb, sqlBool } from '@/lib/purchaseImport/db'
import { resolveRowIndependent } from '@/lib/purchaseImport/resolve'
import { fetchMasterDataSnapshot } from '@/lib/purchaseImport/fetchSnapshot'
import type { ParsedRow } from '@/lib/purchaseImport/types'

// The "logical" fields a correction may set — mirrors ParsedRow's own
// fields, not the *Raw mirror fields (billDateRaw/quantityRaw/rateRaw),
// which this route derives automatically so current_data never gets out of
// sync with itself.
const CORRECTABLE_FIELDS = new Set<keyof ParsedRow>([
  'company', 'warehouse', 'supplier', 'billDate', 'billRef', 'materialType',
  'size', 'quantity', 'unit', 'rate', 'taxRate', 'lineNotes', 'billNotes',
])

// Corrects one or more fields on one staging row: merges into current_data,
// re-validates against a FRESH master-data snapshot (never trusts whatever
// was cached from staging time), and — critically — always resets
// reviewed=false, since a correction invalidates any prior review. Appends
// to correction_history for audit.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id, rowId } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(rowId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const fields = body?.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return NextResponse.json({ error: 'fields object is required' }, { status: 400 })
  }
  const unknownKeys = Object.keys(fields).filter((k) => !CORRECTABLE_FIELDS.has(k as keyof ParsedRow))
  if (unknownKeys.length) return NextResponse.json({ error: `Unknown/uncorrectable field(s): ${unknownKeys.join(', ')}` }, { status: 400 })

  try {
    const batchResult = await hasuraRunSql(`SELECT status FROM purchase_import_batches WHERE id = '${id}'::uuid`)
    const batches = rowsToObjects(batchResult)
    if (!batches.length) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    if (batches[0].status !== 'STAGED') return NextResponse.json({ error: `Cannot edit a row in a ${batches[0].status} batch` }, { status: 400 })

    const rowResult = await hasuraRunSql(`SELECT * FROM purchase_import_rows WHERE id = '${rowId}'::uuid AND batch_id = '${id}'::uuid`)
    const rows = rowsToObjects(rowResult)
    if (!rows.length) return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    const existing = parseStagingRow(rows[0])

    const changes: Record<string, { old: unknown; new: unknown }> = {}
    const next: ParsedRow = { ...existing.current_data }
    for (const [key, value] of Object.entries(fields)) {
      const field = key as keyof ParsedRow
      if (existing.current_data[field] === value) continue
      changes[key] = { old: existing.current_data[field], new: value }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(next as any)[field] = value
      if (field === 'billDate') next.billDateRaw = value === null || value === '' ? '' : String(value)
      if (field === 'quantity') next.quantityRaw = value === null || value === '' ? '' : String(value)
      if (field === 'rate') next.rateRaw = value === null || value === '' ? '' : String(value)
    }

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ isValid: existing.is_valid, errors: existing.validation_errors })
    }

    const snapshot = await fetchMasterDataSnapshot()
    const resolution = resolveRowIndependent(next, snapshot)
    const newHistory = [...existing.correction_history, { at: new Date().toISOString(), by: session.userId, changes }]

    await hasuraRunSql(`
      UPDATE purchase_import_rows SET
        current_data = ${sqlJsonb(next)},
        resolved_field_ids = ${sqlJsonb(resolution.resolved)},
        validation_errors = ${sqlJsonb(resolution.errors)},
        is_valid = ${sqlBool(resolution.isValid)},
        reviewed = false, reviewed_by = NULL, reviewed_at = NULL,
        correction_history = ${sqlJsonb(newHistory)}
      WHERE id = '${rowId}'::uuid
    `)

    return NextResponse.json({ isValid: resolution.isValid, errors: resolution.errors })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update row' }, { status: 500 })
  }
}
