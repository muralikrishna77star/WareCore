import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type Row = string[]

function parseRows(result: { result: Row[] }): Row[] {
  return result.result.slice(1)
}

export async function GET(request: NextRequest) {
  try {
    const session = await verifySessionCookie(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: 'from and to must be YYYY-MM-DD dates' }, { status: 400 })
    }

    // ── Category totals: live source table vs stock_ledger, same window ──────
    const totalsSql = `
      -- Sums purchase_bill_items.received_quantity (what actually drives
      -- PURCHASE_IN, per migration 105), not purchase_bills.total_quantity
      -- (the invoiced figure, maintained separately for billing) — those two
      -- can now legitimately differ by a small weighbridge/underbilling
      -- variance without that showing up here as a false mismatch.
      SELECT 'purchases' AS category,
        (SELECT COALESCE(SUM(COALESCE(pbi.received_quantity, pbi.quantity)), 0) FROM purchase_bill_items pbi JOIN purchase_bills pb ON pb.id = pbi.bill_id WHERE pb.status = 'active' AND pb.bill_date BETWEEN '${from}' AND '${to}') AS source_qty,
        (SELECT COALESCE(SUM(quantity), 0) FROM stock_ledger WHERE entry_type = 'PURCHASE_IN' AND entry_date BETWEEN '${from}' AND '${to}') AS ledger_qty
      UNION ALL
      SELECT 'sales',
        (SELECT COALESCE(SUM(total_quantity), 0) FROM dispatch_orders WHERE status = 'active' AND dispatch_date BETWEEN '${from}' AND '${to}'),
        (SELECT COALESCE(SUM(ABS(quantity)), 0) FROM stock_ledger WHERE entry_type = 'SALE_OUT' AND entry_date BETWEEN '${from}' AND '${to}')
      UNION ALL
      -- is_transfer_line = false excludes destination lines created by a vendor
      -- transfer (migration 056) — those post JOB_WORK_TRANSFER_IN, not
      -- JOB_WORK_OUT, so counting their quantity_sent here double-counted
      -- against a ledger total that never included them.
      SELECT 'job_work',
        (SELECT COALESCE(SUM(jwi.quantity_sent), 0) FROM job_work_items jwi JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id WHERE jwi.is_transfer_line = false AND jwo.dispatch_date BETWEEN '${from}' AND '${to}'),
        (SELECT COALESCE(SUM(ABS(quantity)), 0) FROM stock_ledger WHERE entry_type = 'JOB_WORK_OUT' AND entry_date BETWEEN '${from}' AND '${to}')
      UNION ALL
      SELECT 'purchase_cancellations',
        (SELECT COALESCE(SUM(total_quantity), 0) FROM purchase_cancellations WHERE cancelled_at::date BETWEEN '${from}' AND '${to}'),
        (SELECT COALESCE(SUM(ABS(quantity)), 0) FROM stock_ledger WHERE entry_type = 'PURCHASE_CANCEL' AND entry_date BETWEEN '${from}' AND '${to}')
      UNION ALL
      SELECT 'sale_cancellations',
        (SELECT COALESCE(SUM(total_quantity), 0) FROM dispatch_cancellations WHERE cancelled_at::date BETWEEN '${from}' AND '${to}'),
        (SELECT COALESCE(SUM(ABS(quantity)), 0) FROM stock_ledger WHERE entry_type = 'SALE_CANCEL' AND entry_date BETWEEN '${from}' AND '${to}')
      UNION ALL
      -- Job work cancellations no longer post a JOB_WORK_CANCEL ledger row at
      -- all (migration 061 deletes the order's ledger rows outright instead
      -- of reversing them) — ledger_qty is always 0 here going forward. This
      -- row is purely archive-side reporting now, not a reconciliation check.
      SELECT 'job_work_cancellations',
        (SELECT COALESCE(SUM(jwci.quantity_sent), 0) FROM job_work_cancellation_items jwci JOIN job_work_cancellations jwc ON jwc.id = jwci.cancellation_id WHERE jwc.cancelled_at::date BETWEEN '${from}' AND '${to}'),
        0
    `

    // ── Explained residuals: an IN/OUT ledger row dated in-window whose order
    // was later deleted/cancelled OUTSIDE this window. The original entry
    // correctly stays as history (so it still counts on the ledger side),
    // but the live source row is gone — and the reversing CANCEL entry landed
    // in a different window, so it can't net out here either. This isn't a
    // stale/orphaned row (it IS validly archived) — just a legitimate,
    // permanent artifact of comparing two different date fields per window.
    // Carries the archive record's own id so the UI can link straight to it.
    //
    // job_work has no branch here: delete_job_work_order() now deletes the
    // order's stock_ledger rows outright instead of reversing them (see
    // migration 061), so a cancelled order's JOB_WORK_OUT row disappears
    // immediately regardless of window boundaries — this residual can no
    // longer occur for job_work.
    const explainedSql = `
      SELECT 'purchases' AS category, pc.id AS cancellation_id, sl.reference_number,
        sl.quantity AS qty, pc.cancelled_at::date AS cancelled_date
      FROM stock_ledger sl
      JOIN purchase_cancellations pc ON pc.original_bill_id = sl.reference_id
      WHERE sl.entry_type = 'PURCHASE_IN' AND sl.entry_date BETWEEN '${from}' AND '${to}'
        AND sl.reference_type = 'purchase_bill'
        AND NOT EXISTS (SELECT 1 FROM purchase_bills b WHERE b.id = sl.reference_id)
      UNION ALL
      SELECT 'sales', dc.id, sl.reference_number, ABS(sl.quantity), dc.cancelled_at::date
      FROM stock_ledger sl
      JOIN dispatch_cancellations dc ON dc.original_order_id = sl.reference_id
      WHERE sl.entry_type = 'SALE_OUT' AND sl.entry_date BETWEEN '${from}' AND '${to}'
        AND sl.reference_type = 'dispatch'
        AND NOT EXISTS (SELECT 1 FROM dispatch_orders d WHERE d.id = sl.reference_id)
      ORDER BY category, cancelled_date DESC
    `

    // ── Stale records: ledger entries pointing at an order that no longer
    // exists either live or in its cancellation archive ──────────────────────
    const staleSql = `
      SELECT sl.id, sl.entry_type, sl.reference_type, sl.reference_number, sl.quantity,
             sl.entry_date, mt.code AS material_code, sl.size_label, pbi.rate
      FROM stock_ledger sl
      LEFT JOIN material_types mt ON mt.id = sl.material_type_id
      LEFT JOIN LATERAL (
        SELECT rate FROM purchase_bill_items WHERE purchase_line_id = sl.purchase_line_id LIMIT 1
      ) pbi ON true
      WHERE sl.entry_date BETWEEN '${from}' AND '${to}'
        AND (
          (sl.reference_type = 'purchase_bill'
            AND NOT EXISTS (SELECT 1 FROM purchase_bills b WHERE b.id = sl.reference_id)
            AND NOT EXISTS (SELECT 1 FROM purchase_cancellations pc WHERE pc.original_bill_id = sl.reference_id))
          OR
          (sl.reference_type = 'dispatch'
            AND NOT EXISTS (SELECT 1 FROM dispatch_orders d WHERE d.id = sl.reference_id)
            AND NOT EXISTS (SELECT 1 FROM dispatch_cancellations dc WHERE dc.original_order_id = sl.reference_id))
          OR
          (sl.reference_type = 'job_work'
            AND NOT EXISTS (SELECT 1 FROM job_work_orders j WHERE j.id = sl.reference_id)
            AND NOT EXISTS (SELECT 1 FROM job_work_cancellations jc WHERE jc.original_order_id = sl.reference_id))
        )
      ORDER BY sl.entry_date DESC
      LIMIT 500
    `

    // ── Duplicate rows: an order line whose Purchase In / Sale Out / Job Work
    // Out rows add up to more than the order says (the edit-dedup bug class
    // fixed in migrations 041/052). Several rows alone are not a duplicate —
    // two sale lines can draw on one purchase line, Edit Order posts a
    // correction row for a changed Qty Sent, and a purchase edit posts
    // PURCHASE_CANCEL + a fresh PURCHASE_IN — so the net is compared with the
    // order's own quantity. ──────────────────────────────────────────────────
    const duplicatesSql = `
      WITH dup AS (
        SELECT sl.reference_type, sl.reference_id, max(sl.reference_number) AS reference_number,
               CASE WHEN sl.entry_type = 'PURCHASE_CANCEL' THEN 'PURCHASE_IN' ELSE sl.entry_type END AS entry_type,
               sl.purchase_line_id, sl.material_size_id, max(sl.size_label) AS size_label,
               count(*) FILTER (WHERE sl.entry_type <> 'PURCHASE_CANCEL') AS row_count,
               sum(sl.quantity) AS net_qty, max(sl.entry_date) AS latest_entry_date
        FROM stock_ledger sl
        WHERE sl.entry_type IN ('PURCHASE_IN', 'PURCHASE_CANCEL', 'SALE_OUT', 'JOB_WORK_OUT')
          AND sl.entry_date BETWEEN '${from}' AND '${to}'
        GROUP BY 1, 2, 4, 5, 6
        HAVING count(*) FILTER (WHERE sl.entry_type <> 'PURCHASE_CANCEL') > 1
      ), src AS (
        SELECT dup.*,
          CASE dup.entry_type
            WHEN 'PURCHASE_IN' THEN (SELECT COALESCE(SUM(COALESCE(p.received_quantity, p.quantity)), 0)
              FROM purchase_bill_items p JOIN purchase_bills b ON b.id = p.bill_id
              WHERE p.bill_id = dup.reference_id AND b.status <> 'cancelled'
                AND p.purchase_line_id IS NOT DISTINCT FROM dup.purchase_line_id
                AND p.material_size_id IS NOT DISTINCT FROM dup.material_size_id)
            WHEN 'SALE_OUT' THEN -(SELECT COALESCE(SUM(di.quantity), 0)
              FROM dispatch_items di JOIN dispatch_orders d ON d.id = di.dispatch_order_id
              WHERE di.dispatch_order_id = dup.reference_id AND d.status <> 'cancelled'
                AND di.purchase_line_id IS NOT DISTINCT FROM dup.purchase_line_id
                AND di.material_size_id IS NOT DISTINCT FROM dup.material_size_id)
            WHEN 'JOB_WORK_OUT' THEN -(SELECT COALESCE(SUM(ji.quantity_sent), 0)
              FROM job_work_items ji
              WHERE ji.job_work_order_id = dup.reference_id AND NOT COALESCE(ji.is_transfer_line, false)
                AND ji.purchase_line_id IS NOT DISTINCT FROM dup.purchase_line_id
                AND ji.material_size_id IS NOT DISTINCT FROM dup.material_size_id)
          END AS source_qty
        FROM dup
      )
      SELECT src.reference_type, src.reference_number, src.entry_type, src.purchase_line_id, src.size_label,
             src.row_count, src.net_qty, src.latest_entry_date, pbi.rate, src.source_qty
      FROM src
      LEFT JOIN LATERAL (
        SELECT rate FROM purchase_bill_items WHERE purchase_line_id = src.purchase_line_id LIMIT 1
      ) pbi ON true
      WHERE abs(src.net_qty - src.source_qty) > 0.0005
      ORDER BY src.latest_entry_date DESC
      LIMIT 500
    `

    const [totalsRes, explainedRes, staleRes, dupRes] = await Promise.all([
      hasuraRunSql(totalsSql),
      hasuraRunSql(explainedSql),
      hasuraRunSql(staleSql),
      hasuraRunSql(duplicatesSql),
    ])

    const explainedRoute: Record<string, string> = {
      purchases: '/purchase-cancellations',
      sales: '/sale-cancellations',
    }
    const explainedRecords = parseRows(explainedRes).map(
      ([category, cancellationId, referenceNumber, qty, cancelledDate]) => ({
        category,
        cancellationId,
        referenceNumber,
        qty: Number(qty),
        cancelledDate,
        url: `${explainedRoute[category] ?? ''}/${cancellationId}`,
      })
    )

    const explainedByCategory = new Map<string, { explainedQty: number; explainedCount: number }>()
    for (const rec of explainedRecords) {
      const prev = explainedByCategory.get(rec.category) ?? { explainedQty: 0, explainedCount: 0 }
      explainedByCategory.set(rec.category, { explainedQty: prev.explainedQty + rec.qty, explainedCount: prev.explainedCount + 1 })
    }

    const totals = parseRows(totalsRes).map(([category, sourceQty, ledgerQty]) => {
      const source = Number(sourceQty)
      const ledger = Number(ledgerQty)
      const diff = Math.round((source - ledger) * 1000) / 1000
      const matches = Math.abs(source - ledger) < 0.001
      const explained = explainedByCategory.get(category)
      const explainedQty = explained?.explainedQty ?? 0
      return {
        category,
        sourceQty: source,
        ledgerQty: ledger,
        diff,
        matches,
        explainedQty,
        explainedCount: explained?.explainedCount ?? 0,
        // Fully explained when the residual diff matches the explained qty in
        // magnitude (diff is always source - ledger, and these orders are
        // always missing from source but present in ledger, so diff is
        // negative — explainedQty is a positive magnitude).
        fullyExplained: !matches && explainedQty > 0 && Math.abs(Math.abs(diff) - explainedQty) < 0.001,
      }
    })

    const staleRecords = parseRows(staleRes).map(
      ([id, entryType, referenceType, referenceNumber, quantity, entryDate, materialCode, sizeLabel, rate]) => ({
        id, entryType, referenceType, referenceNumber, quantity: Number(quantity), entryDate, materialCode, sizeLabel,
        rate: rate ? Number(rate) : null,
      })
    )

    const duplicateGroups = parseRows(dupRes).map(
      ([referenceType, referenceNumber, entryType, purchaseLineId, sizeLabel, rowCount, netQty, latestEntryDate, rate, sourceQty]) => ({
        referenceType, referenceNumber, entryType, purchaseLineId, sizeLabel,
        rowCount: Number(rowCount), netQty: Number(netQty), latestEntryDate,
        rate: rate && rate !== 'NULL' ? Number(rate) : null,
        orderQty: Number(sourceQty),
      })
    )

    return NextResponse.json({ totals, explainedRecords, staleRecords, duplicateGroups })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed'
    console.error('[stock/verify]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
