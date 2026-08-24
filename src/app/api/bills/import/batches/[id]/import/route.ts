import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import { sqlTextOrNull } from '@/lib/dataIntegrity/sqlSafe'
import { ALLOWED_ROLES } from '@/lib/purchaseImport/auth'
import { rowsToObjects, parseStagingRow, sqlJsonb, sqlBool } from '@/lib/purchaseImport/db'
import { resolveImport, resolveRowIndependent, resolveNewItems } from '@/lib/purchaseImport/resolve'
import { fetchMasterDataSnapshot } from '@/lib/purchaseImport/fetchSnapshot'
import { buildInsertScript, buildNewItemsInsertScript } from '@/lib/purchaseImport/buildInsertScript'

// Final commit. Requires the batch STAGED and EVERY row valid+reviewed —
// all-or-nothing, no partial import. Re-resolves everything fresh against
// current master data (resolveImport() is the single authoritative gate,
// same function the original one-shot commit route used) rather than
// trusting whatever was cached at staging time, since staging can sit for a
// while before import.
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
    if (batches[0].status !== 'STAGED') return NextResponse.json({ error: `Batch is ${batches[0].status}, not STAGED` }, { status: 400 })

    const rowsResult = await hasuraRunSql(`SELECT * FROM purchase_import_rows WHERE batch_id = '${id}'::uuid ORDER BY row_number`)
    const rows = rowsToObjects(rowsResult).map(parseStagingRow)
    if (!rows.length) return NextResponse.json({ error: 'Batch has no rows' }, { status: 400 })

    const notReady = rows.filter((r) => !r.is_valid || !r.reviewed)
    if (notReady.length) {
      return NextResponse.json(
        { error: `${notReady.length} row(s) are not both valid and reviewed yet — nothing was imported.`, rowNumbers: notReady.map((r) => r.row_number) },
        { status: 400 }
      )
    }

    // Authoritative re-resolution against FRESH master data — the single
    // gate resolveImport() already enforces for the (now-retired) one-shot
    // commit route. Every row individually validating at staging/correction
    // time does not guarantee the WHOLE FILE still resolves cleanly (e.g. a
    // referenced master record was deactivated after staging). Duplicate
    // material/size/quantity/rate lines are deliberately NOT an error here —
    // resolveImport() only ever raises the same per-field problems
    // resolveRowIndependent() below also catches, so the two never disagree
    // about which rows are actually invalid.
    const freshSnapshot = await fetchMasterDataSnapshot()
    const parsedRows = rows.map((r) => r.current_data)
    const { bills, errors } = resolveImport(parsedRows, freshSnapshot)

    if (errors.length || !bills.length) {
      // Don't dead-end: re-validate the affected rows individually so the
      // review screen shows WHY, and force reviewed=false on them so a
      // stale approval can never be silently re-attempted.
      const affectedRowNumbers = new Set(errors.map((e) => e.rowNumber).filter((n): n is number => n !== null))
      for (const row of rows) {
        if (!affectedRowNumbers.has(row.row_number)) continue
        const resolution = resolveRowIndependent(row.current_data, freshSnapshot)
        await hasuraRunSql(`
          UPDATE purchase_import_rows SET
            resolved_field_ids = ${sqlJsonb(resolution.resolved)},
            validation_errors = ${sqlJsonb(resolution.errors)},
            is_valid = ${sqlBool(resolution.isValid)},
            reviewed = false, reviewed_by = NULL, reviewed_at = NULL
          WHERE id = '${row.id}'::uuid
        `)
      }
      const message = `${affectedRowNumbers.size} row(s) need another look — they passed earlier but failed final validation. Their errors have been updated.`
      await hasuraRunSql(`UPDATE purchase_import_batches SET last_import_error = ${sqlTextOrNull(message)}, last_import_attempted_at = NOW() WHERE id = '${id}'::uuid`)
      return NextResponse.json({ error: message, rowNumbers: [...affectedRowNumbers] }, { status: 409 })
    }

    // Item Master rows for any purchased material/size combo that doesn't
    // have one yet — otherwise the purchase posts to stock_ledger fine but
    // stays permanently unreachable from the Item Stock Ledger report's
    // item picker. Computed from the SAME freshSnapshot used to resolve the
    // bills, so "which combos are new" can't drift from what was actually
    // just resolved.
    const newItems = resolveNewItems(bills, freshSnapshot)
    const newItemsWithIds = newItems.map((i) => ({ ...i, id: randomUUID() }))
    const newItemsScript = buildNewItemsInsertScript(newItemsWithIds)

    // Every purchased material/size combo now resolves to an Item Master id
    // — either one that already existed, or one just allocated above — so
    // buildInsertScript() can set purchase_bill_items.item_master_id on
    // every line. Without this, imported lines post to stock_ledger fine
    // but stay invisible to anything that requires item_master_id, e.g. Job
    // Work's "available to send" query.
    const itemMasterIdByCombo = new Map<string, string>()
    for (const im of freshSnapshot.itemMaster) itemMasterIdByCombo.set(`${im.material_type_id}|${im.material_size_id ?? ''}`, im.id)
    for (const ni of newItemsWithIds) itemMasterIdByCombo.set(`${ni.materialTypeId}|${ni.materialSizeId ?? ''}`, ni.id)

    const billsWithIds = bills.map((b) => ({ ...b, id: randomUUID() }))
    const insertScript = buildInsertScript(billsWithIds, session.userId, itemMasterIdByCombo)
    const batchUpdateSql = `
      UPDATE purchase_import_batches SET status = 'IMPORTED', imported_at = NOW(), imported_by = '${session.userId}'::uuid
      WHERE id = '${id}'::uuid AND status = 'STAGED';
    `
    // Link every staging row to the real bill its line became, via each
    // ResolvedLine's rowNumber (traced straight back to the staging
    // row_number by resolveImport) — lets the review screen offer a "View
    // Purchase" link into the actual bill once imported, instead of only
    // ever showing the frozen staging snapshot.
    const rowLinkSql = billsWithIds
      .map((b) => {
        const rowNumbers = b.lines.map((l) => l.rowNumber).join(',')
        return `UPDATE purchase_import_rows SET purchase_bill_id = '${b.id}'::uuid WHERE batch_id = '${id}'::uuid AND row_number = ANY(ARRAY[${rowNumbers}]);`
      })
      .join('\n')
    // New items + bills + row links + batch status flip in the SAME atomic
    // script — "items exist", "bills exist", "rows link to them", and
    // "batch marked imported" can never disagree, and a failure anywhere
    // rolls back the whole thing.
    await hasuraRunSql(`${newItemsScript}\n${insertScript}\n${rowLinkSql}\n${batchUpdateSql}`)

    return NextResponse.json({
      bills: billsWithIds.map((b) => ({
        id: b.id, billNumber: b.billNumber,
        companyLabel: b.companyLabel, warehouseLabel: b.warehouseLabel, supplierLabel: b.supplierLabel,
        billDate: b.billDate, lineCount: b.lines.length,
        totalQuantity: b.totalQuantity, totalAmount: b.totalAmount,
      })),
      totalBills: billsWithIds.length,
      totalLines: billsWithIds.reduce((s, b) => s + b.lines.length, 0),
      totalQuantity: Number(billsWithIds.reduce((s, b) => s + b.totalQuantity, 0).toFixed(3)),
      totalAmount: Number(billsWithIds.reduce((s, b) => s + b.totalAmount, 0).toFixed(2)),
      newItemsCreated: newItems.map((i) => ({ itemCode: i.itemCode, itemName: i.itemName })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed — nothing was committed.'
    await hasuraRunSql(`UPDATE purchase_import_batches SET last_import_error = ${sqlTextOrNull(message)}, last_import_attempted_at = NOW() WHERE id = '${id}'::uuid`).catch(() => {})
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
