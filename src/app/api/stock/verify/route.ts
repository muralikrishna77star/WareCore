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
      SELECT 'purchases' AS category,
        (SELECT COALESCE(SUM(total_quantity), 0) FROM purchase_bills WHERE status = 'active' AND bill_date BETWEEN '${from}' AND '${to}') AS source_qty,
        (SELECT COALESCE(SUM(quantity), 0) FROM stock_ledger WHERE entry_type = 'PURCHASE_IN' AND entry_date BETWEEN '${from}' AND '${to}') AS ledger_qty
      UNION ALL
      SELECT 'sales',
        (SELECT COALESCE(SUM(total_quantity), 0) FROM dispatch_orders WHERE status = 'active' AND dispatch_date BETWEEN '${from}' AND '${to}'),
        (SELECT COALESCE(SUM(ABS(quantity)), 0) FROM stock_ledger WHERE entry_type = 'SALE_OUT' AND entry_date BETWEEN '${from}' AND '${to}')
      UNION ALL
      SELECT 'job_work',
        (SELECT COALESCE(SUM(jwi.quantity_sent), 0) FROM job_work_items jwi JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id WHERE jwo.dispatch_date BETWEEN '${from}' AND '${to}'),
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
      SELECT 'job_work_cancellations',
        (SELECT COALESCE(SUM(jwci.quantity_sent), 0) FROM job_work_cancellation_items jwci JOIN job_work_cancellations jwc ON jwc.id = jwci.cancellation_id WHERE jwc.cancelled_at::date BETWEEN '${from}' AND '${to}'),
        (SELECT COALESCE(SUM(ABS(quantity)), 0) FROM stock_ledger WHERE entry_type = 'JOB_WORK_CANCEL' AND entry_date BETWEEN '${from}' AND '${to}')
    `

    // ── Stale records: ledger entries pointing at an order that no longer
    // exists either live or in its cancellation archive ──────────────────────
    const staleSql = `
      SELECT sl.id, sl.entry_type, sl.reference_type, sl.reference_number, sl.quantity,
             sl.entry_date, mt.code AS material_code, sl.size_label
      FROM stock_ledger sl
      LEFT JOIN material_types mt ON mt.id = sl.material_type_id
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

    // ── Duplicate rows: more than one IN-type ledger row for the same order
    // line (the edit-dedup bug class fixed in migrations 041/052) ────────────
    const duplicatesSql = `
      SELECT reference_type, reference_number, entry_type, purchase_line_id, size_label,
             count(*) AS row_count, sum(quantity) AS net_qty, max(entry_date) AS latest_entry_date
      FROM stock_ledger
      WHERE entry_type IN ('PURCHASE_IN', 'SALE_OUT', 'JOB_WORK_OUT')
        AND entry_date BETWEEN '${from}' AND '${to}'
      GROUP BY reference_type, reference_id, reference_number, entry_type, purchase_line_id, size_label
      HAVING count(*) > 1
      ORDER BY max(entry_date) DESC
      LIMIT 500
    `

    const [totalsRes, staleRes, dupRes] = await Promise.all([
      hasuraRunSql(totalsSql),
      hasuraRunSql(staleSql),
      hasuraRunSql(duplicatesSql),
    ])

    const totals = parseRows(totalsRes).map(([category, sourceQty, ledgerQty]) => {
      const source = Number(sourceQty)
      const ledger = Number(ledgerQty)
      return {
        category,
        sourceQty: source,
        ledgerQty: ledger,
        diff: Math.round((source - ledger) * 1000) / 1000,
        matches: Math.abs(source - ledger) < 0.001,
      }
    })

    const staleRecords = parseRows(staleRes).map(
      ([id, entryType, referenceType, referenceNumber, quantity, entryDate, materialCode, sizeLabel]) => ({
        id, entryType, referenceType, referenceNumber, quantity: Number(quantity), entryDate, materialCode, sizeLabel,
      })
    )

    const duplicateGroups = parseRows(dupRes).map(
      ([referenceType, referenceNumber, entryType, purchaseLineId, sizeLabel, rowCount, netQty, latestEntryDate]) => ({
        referenceType, referenceNumber, entryType, purchaseLineId, sizeLabel,
        rowCount: Number(rowCount), netQty: Number(netQty), latestEntryDate,
      })
    )

    return NextResponse.json({ totals, staleRecords, duplicateGroups })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed'
    console.error('[stock/verify]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
