import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOLERANCE = 0.001
const VENDOR_MOVEMENT_TYPES_SQL =
  "ARRAY['JOB_WORK_OUT','JOB_WORK_RETURN_IN','JOB_WORK_CANCEL','JOB_WORK_TRANSFER_OUT','JOB_WORK_TRANSFER_IN']"

type Row = string[]
function parseRows(result: { result: Row[] }): Row[] {
  return result.result.slice(1)
}
function num(v: string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function sqlLiteral(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

export interface DiagnosisFinding {
  pattern: 'missing_transfer_leg' | 'purchase_variance' | 'phantom_return' | 'transfer_timing_false_positive'
  title: string
  detail: string
}

export async function GET(request: NextRequest) {
  try {
    const session = await verifySessionCookie(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('id') || ''
    if (!UUID_RE.test(itemId)) return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })

    const itemRes = await hasuraRunSql(
      `SELECT material_type_id, material_size_id, size_label, item_code, item_name FROM item_master WHERE id = '${itemId}'`
    )
    const itemRow = parseRows(itemRes)[0]
    if (!itemRow) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    const [materialTypeId, materialSizeId, sizeLabel, itemCode, itemName] = itemRow
    const materialSizeSql = materialSizeId ? sqlLiteral(materialSizeId) : 'NULL'
    const sizeLabelSql = sizeLabel ? sqlLiteral(sizeLabel) : 'NULL'

    const [aggRes, timingRes, transferLegRes, phantomRes, purchaseRes] = await Promise.all([
      // Basic aggregates, for context in the response.
      hasuraRunSql(`
        WITH ledger AS (
          SELECT sl.quantity, (sl.entry_type = ANY(${VENDOR_MOVEMENT_TYPES_SQL})) AS is_vendor
          FROM stock_ledger sl
          WHERE sl.material_type_id = '${materialTypeId}' AND sl.material_size_id IS NOT DISTINCT FROM ${materialSizeSql}
        )
        SELECT
          COALESCE((SELECT SUM(quantity) FROM ledger), 0) AS closing_balance,
          COALESCE((SELECT SUM(CASE WHEN is_vendor THEN -quantity ELSE 0 END) FROM ledger), 0) AS vendor_closing_balance,
          COALESCE((SELECT SUM(pending_quantity) FROM v_stock_at_vendors WHERE material_type_id = '${materialTypeId}' AND size_label IS NOT DISTINCT FROM ${sizeLabelSql}), 0) AS vendor_expected
      `),
      // Pattern: transfer legs backfilled far apart in created_at (false-positive negative dip).
      hasuraRunSql(`
        SELECT src_ledger.reference_number AS out_ref, dest_ledger.reference_number AS in_ref,
          dest.quantity_sent, src_ledger.created_at AS out_created_at, dest_ledger.created_at AS in_created_at,
          ABS(EXTRACT(EPOCH FROM (dest_ledger.created_at - src_ledger.created_at))) / 3600.0 AS hours_apart
        FROM job_work_items dest
        JOIN job_work_items src ON src.id = dest.source_job_work_item_id
        JOIN job_work_orders dest_order ON dest_order.id = dest.job_work_order_id
        JOIN job_work_orders src_order ON src_order.id = src.job_work_order_id
        JOIN stock_ledger dest_ledger ON dest_ledger.reference_id = dest_order.id AND dest_ledger.entry_type = 'JOB_WORK_TRANSFER_IN' AND dest_ledger.quantity = dest.quantity_sent
        JOIN stock_ledger src_ledger ON src_ledger.reference_id = src_order.id AND src_ledger.entry_type = 'JOB_WORK_TRANSFER_OUT' AND src_ledger.quantity = -dest.quantity_sent
        WHERE dest.material_type_id = '${materialTypeId}' AND dest.material_size_id IS NOT DISTINCT FROM ${materialSizeSql}
          AND dest.is_transfer_line = true
          AND ABS(EXTRACT(EPOCH FROM (dest_ledger.created_at - src_ledger.created_at))) > 3600
      `),
      // Pattern: quantity_transferred_out set but no destination line references it back.
      hasuraRunSql(`
        SELECT src.job_line_id, src.quantity_transferred_out, jwo.reference_number, s.name AS vendor_name
        FROM job_work_items src
        JOIN job_work_orders jwo ON jwo.id = src.job_work_order_id
        JOIN suppliers s ON s.id = jwo.vendor_id
        WHERE src.material_type_id = '${materialTypeId}' AND src.material_size_id IS NOT DISTINCT FROM ${materialSizeSql}
          AND src.quantity_transferred_out > ${TOLERANCE}
          AND NOT EXISTS (SELECT 1 FROM job_work_items dest WHERE dest.source_job_work_item_id = src.id)
      `),
      // Pattern: quantity_received with no ledger (vendor-direct-sale) or output-item backing.
      hasuraRunSql(`
        SELECT x.job_line_id, x.quantity_received, x.reference_number, x.vendor_direct_sum, x.output_sum,
          (x.quantity_received - x.vendor_direct_sum - x.output_sum) AS unbacked
        FROM (
          SELECT jwi.job_line_id, jwi.quantity_received, jwo.reference_number,
            COALESCE((
              SELECT SUM(sl.quantity) FROM stock_ledger sl
              WHERE sl.entry_type = 'JOB_WORK_RETURN_IN' AND sl.notes = 'Vendor direct sale — virtual return'
                AND sl.reference_id = jwi.job_work_order_id AND sl.purchase_line_id IS NOT DISTINCT FROM jwi.purchase_line_id
            ), 0) AS vendor_direct_sum,
            COALESCE((
              SELECT SUM(jwoi.quantity) FROM job_work_output_items jwoi WHERE jwoi.source_job_line_id = jwi.job_line_id
            ), 0) AS output_sum
          FROM job_work_items jwi
          JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
          WHERE jwi.material_type_id = '${materialTypeId}' AND jwi.material_size_id IS NOT DISTINCT FROM ${materialSizeSql}
            AND jwi.quantity_received > ${TOLERANCE}
        ) x
        WHERE (x.quantity_received - x.vendor_direct_sum - x.output_sum) > ${TOLERANCE}
      `),
      // Pattern: a purchase line whose downstream consumption exceeds its received quantity.
      // "Consumed" = NET material currently sent to job work (SUM(quantity_sent -
      // quantity_received - quantity_transferred_out), so a purchase line that was
      // sent out, fully returned, then legitimately re-sent for a separate job
      // work engagement nets to ~0, not double-counted — GI0524-0021/0029 showed
      // this exact shape) PLUS plain warehouse sales (SALE_OUT from a
      // non-vendor-direct dispatch only — a vendor-direct-sale SALE_OUT is
      // excluded because it's how job-work-out material already counted above
      // gets disposed of, not a second draw on the same line, as CR00431/GA00128
      // both showed).
      hasuraRunSql(`
        WITH lines AS (
          SELECT pbi.purchase_line_id, pbi.quantity AS invoiced_quantity, COALESCE(pbi.received_quantity, pbi.quantity) AS received_quantity
          FROM purchase_bill_items pbi
          JOIN purchase_bills pb ON pb.id = pbi.bill_id
          WHERE pbi.material_type_id = '${materialTypeId}' AND pbi.material_size_id IS NOT DISTINCT FROM ${materialSizeSql}
            AND pb.status = 'active' AND pbi.purchase_line_id IS NOT NULL
        ),
        consumption AS (
          SELECT l.purchase_line_id, l.invoiced_quantity, l.received_quantity,
            COALESCE((
              SELECT SUM(jwi.quantity_sent - COALESCE(jwi.quantity_received, 0) - jwi.quantity_transferred_out)
              FROM job_work_items jwi WHERE jwi.purchase_line_id = l.purchase_line_id AND jwi.is_transfer_line = false
            ), 0)
            + COALESCE((
                SELECT SUM(ABS(sl.quantity)) FROM stock_ledger sl
                JOIN dispatch_orders do_ ON do_.id = sl.reference_id
                WHERE sl.purchase_line_id = l.purchase_line_id AND sl.entry_type = 'SALE_OUT' AND COALESCE(do_.is_vendor_direct, false) = false
              ), 0) AS consumed
          FROM lines l
        )
        SELECT purchase_line_id, invoiced_quantity, received_quantity, consumed
        FROM consumption
        WHERE (consumed - received_quantity) > ${TOLERANCE}
      `),
    ])

    const aggRow = parseRows(aggRes)[0] ?? ['0', '0', '0']
    const closingBalance = num(aggRow[0])
    const vendorClosingBalance = num(aggRow[1])
    const vendorExpected = num(aggRow[2])

    const findings: DiagnosisFinding[] = []

    for (const r of parseRows(timingRes)) {
      const [outRef, inRef, qty, outCreated, inCreated, hours] = r
      findings.push({
        pattern: 'transfer_timing_false_positive',
        title: `Transfer legs recorded ${num(hours).toFixed(1)}h apart (${outRef} → ${inRef})`,
        detail: `${qty} MT transferred out on ${outRef} (recorded ${outCreated}) and received on ${inRef} (recorded ${inCreated}) — if a mismatch reason mentions "went negative during the period" but closing/vendor balances already agree below, this is likely a false positive from the two legs being entered far apart in time, not a real quantity problem. Fixed before for CR00640/GI00057 by aligning the later leg's created_at with the earlier one's.`,
      })
    }

    for (const r of parseRows(transferLegRes)) {
      const [jobLineId, qty, refNumber, vendorName] = r
      findings.push({
        pattern: 'missing_transfer_leg',
        title: `${qty} MT marked transferred out (${refNumber}, line ${jobLineId}) with no destination line`,
        detail: `This line at ${vendorName} shows quantity_transferred_out = ${qty}, but no other job work line anywhere references it as a transfer source — the destination leg (and its ledger postings) may never have been created. Fixed this way for GI00069.`,
      })
    }

    for (const r of parseRows(phantomRes)) {
      const [jobLineId, qtyReceived, refNumber, vendorDirectSum, outputSum, unbacked] = r
      findings.push({
        pattern: 'phantom_return',
        title: `${jobLineId} (${refNumber}) shows ${unbacked} MT of quantity_received with no backing`,
        detail: `quantity_received is ${qtyReceived}, but only ${vendorDirectSum} MT (vendor-direct-sale) + ${outputSum} MT (output items) is actually backed by a ledger/output record — ${unbacked} MT has no evidence of ever really returning or converting. Confirm whether this material is still physically at the vendor before resetting quantity_received. Fixed this way for GI00053.`,
      })
    }

    for (const r of parseRows(purchaseRes)) {
      const [purchaseLineId, invoicedQty, receivedQty, consumed] = r
      const shortfall = num(consumed) - num(receivedQty)
      findings.push({
        pattern: 'purchase_variance',
        title: `Purchase line ${purchaseLineId} oversold by ${shortfall.toFixed(3)} MT`,
        detail: `Invoiced ${invoicedQty} MT (received_quantity currently ${receivedQty} MT), but ${consumed} MT has been sent to job work or sold downstream — ${shortfall.toFixed(3)} MT more than recorded. If this is a genuine weighbridge/underbilling variance, raising received_quantity on this line to ${(num(receivedQty) + shortfall).toFixed(3)} would close the gap. Verify the physical delivery before changing it — CR00431 initially looked like this but the real cause turned out to be a sale invoice needing correction instead. Fixed this way for CR00431/GA00128.`,
      })
    }

    return NextResponse.json({
      itemCode,
      itemName,
      closingBalance,
      vendorClosingBalance,
      vendorExpected,
      findings,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Diagnosis failed'
    console.error('[stock/reconcile-items/diagnose]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
