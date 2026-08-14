import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TOLERANCE = 0.001

type Row = string[]

function parseRows(result: { result: Row[] }): Row[] {
  return result.result.slice(1)
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Every entry_type that moves stock to/from a job-work vendor — kept in sync
// with src/lib/stockLedger.ts's VENDOR_MOVEMENT_TYPES (duplicated here since
// this runs as a raw SQL literal, not importable into the query string).
const VENDOR_MOVEMENT_TYPES_SQL =
  "ARRAY['JOB_WORK_OUT','JOB_WORK_RETURN_IN','JOB_WORK_CANCEL','JOB_WORK_TRANSFER_OUT','JOB_WORK_TRANSFER_IN']"

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
    if (from > to) {
      return NextResponse.json({ error: 'from date must not be after to date' }, { status: 400 })
    }

    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)
    const limit = Math.min(300, Math.max(1, parseInt(searchParams.get('limit') || '100', 10) || 100))

    // A "today" `to` date value is the only case where the vendor cross-check
    // (against v_stock_at_vendors, a live/current job_work_items aggregate)
    // is meaningful — see the CTE comment below.
    const todayStr = new Date().toISOString().split('T')[0]
    const vendorCheckApplies = to >= todayStr

    const sql = `
      WITH target_items AS (
        -- Only items with at least one stock_ledger row on or before 'to' —
        -- catalog entries never purchased/used yet have nothing to
        -- reconcile and would just be noise in the results list.
        SELECT DISTINCT im.id, im.item_code, im.item_name, im.material_type_id, im.material_size_id, im.size_label, im.unit
        FROM item_master im
        JOIN stock_ledger sl
          ON sl.material_type_id = im.material_type_id
         AND sl.material_size_id IS NOT DISTINCT FROM im.material_size_id
        WHERE im.is_active = true
          AND sl.entry_date <= '${to}'
        ORDER BY im.item_code
        LIMIT ${limit} OFFSET ${offset}
      ),
      ledger AS (
        SELECT
          ti.id AS item_id,
          sl.entry_date,
          sl.created_at,
          sl.quantity,
          (sl.entry_type = ANY(${VENDOR_MOVEMENT_TYPES_SQL})) AS is_vendor
        FROM target_items ti
        JOIN stock_ledger sl
          ON sl.material_type_id = ti.material_type_id
         AND sl.material_size_id IS NOT DISTINCT FROM ti.material_size_id
        WHERE sl.entry_date <= '${to}'
      ),
      opening_closing AS (
        SELECT
          item_id,
          COALESCE(SUM(quantity) FILTER (WHERE entry_date < '${from}'), 0) AS opening_balance,
          COALESCE(SUM(CASE WHEN is_vendor THEN -quantity ELSE 0 END) FILTER (WHERE entry_date < '${from}'), 0) AS vendor_opening_balance,
          COALESCE(SUM(quantity), 0) AS closing_balance,
          COALESCE(SUM(CASE WHEN is_vendor THEN -quantity ELSE 0 END), 0) AS vendor_closing_balance,
          COUNT(*) FILTER (WHERE entry_date >= '${from}') AS txn_count
        FROM ledger
        GROUP BY item_id
      ),
      -- A "vendor direct sale" posts its virtual-return and matching sale-out
      -- legs in the same instant (identical created_at, same DB transaction)
      -- — ORDER BY entry_date, created_at alone can't break that tie
      -- consistently, so a window function over individual rows can show a
      -- false momentary dip to negative depending on which leg sorts first.
      -- Grouping same-instant rows into one atomic step before accumulating
      -- fixes that without hiding a real cross-transaction dip.
      ledger_grouped AS (
        SELECT item_id, entry_date, created_at,
          SUM(quantity) AS qty,
          SUM(CASE WHEN is_vendor THEN -quantity ELSE 0 END) AS vendor_qty
        FROM ledger
        GROUP BY item_id, entry_date, created_at
      ),
      -- Cumulative running balance at every atomic step, ordered
      -- chronologically from the dawn of the ledger (not just from 'from')
      -- so the in-window MIN below reflects the item's true historical
      -- trajectory, not one artificially reset to 0 at the window start.
      running AS (
        SELECT
          item_id, entry_date,
          SUM(qty) OVER (PARTITION BY item_id ORDER BY entry_date, created_at ROWS UNBOUNDED PRECEDING) AS running_balance,
          SUM(vendor_qty) OVER (PARTITION BY item_id ORDER BY entry_date, created_at ROWS UNBOUNDED PRECEDING) AS running_vendor_balance
        FROM ledger_grouped
      ),
      window_min AS (
        SELECT
          item_id,
          MIN(running_balance) FILTER (WHERE entry_date >= '${from}') AS min_balance_in_window,
          MIN(running_vendor_balance) FILTER (WHERE entry_date >= '${from}') AS min_vendor_balance_in_window
        FROM running
        GROUP BY item_id
      ),
      -- The one genuinely independent cross-check available (see REC-018):
      -- v_stock_at_vendors is derived from job_work_items.quantity_sent/
      -- received, not from stock_ledger at all. It reflects CURRENT vendor
      -- holdings, so it's only comparable when 'to' is today or later.
      vendor_expected AS (
        SELECT ti.id AS item_id, COALESCE(SUM(v.pending_quantity), 0) AS vendor_expected
        FROM target_items ti
        LEFT JOIN v_stock_at_vendors v
          ON v.material_type_id = ti.material_type_id
         AND v.size_label IS NOT DISTINCT FROM ti.size_label
        GROUP BY ti.id
      )
      SELECT
        ti.id, ti.item_code, ti.item_name, ti.unit,
        COALESCE(oc.opening_balance, 0),
        COALESCE(oc.vendor_opening_balance, 0),
        COALESCE(oc.closing_balance, 0),
        COALESCE(oc.vendor_closing_balance, 0),
        COALESCE(oc.txn_count, 0),
        wm.min_balance_in_window,
        wm.min_vendor_balance_in_window,
        ve.vendor_expected
      FROM target_items ti
      LEFT JOIN opening_closing oc ON oc.item_id = ti.id
      LEFT JOIN window_min wm ON wm.item_id = ti.id
      LEFT JOIN vendor_expected ve ON ve.item_id = ti.id
      ORDER BY ti.item_code
    `

    const countSql = `
      SELECT COUNT(DISTINCT im.id)
      FROM item_master im
      JOIN stock_ledger sl
        ON sl.material_type_id = im.material_type_id
       AND sl.material_size_id IS NOT DISTINCT FROM im.material_size_id
      WHERE im.is_active = true
        AND sl.entry_date <= '${to}'
    `

    const [rowsRes, countRes] = await Promise.all([hasuraRunSql(sql), hasuraRunSql(countSql)])
    const totalCount = Number(parseRows(countRes)[0]?.[0] ?? 0)

    const items = parseRows(rowsRes).map((r) => {
      const [
        id, itemCode, itemName, unit,
        openingBalanceStr, vendorOpeningStr, closingBalanceStr, vendorClosingStr, txnCountStr,
        minBalanceStr, minVendorBalanceStr, vendorExpectedStr,
      ] = r

      const openingBalance = num(openingBalanceStr) ?? 0
      const vendorOpeningBalance = num(vendorOpeningStr) ?? 0
      const closingBalance = num(closingBalanceStr) ?? 0
      const vendorClosingBalance = num(vendorClosingStr) ?? 0
      const txnCount = Number(txnCountStr ?? 0)
      // No in-window rows means the running-balance CTE never touched this
      // item, so fall back to the opening figure itself as the floor.
      const minBalance = Math.min(openingBalance, num(minBalanceStr) ?? openingBalance)
      const minVendorBalance = Math.min(vendorOpeningBalance, num(minVendorBalanceStr) ?? vendorOpeningBalance)
      const vendorExpected = num(vendorExpectedStr) ?? 0

      const reasons: string[] = []
      if (minBalance < -TOLERANCE) {
        reasons.push(`Warehouse stock went negative during the period (lowest: ${minBalance.toFixed(3)})`)
      }
      if (minVendorBalance < -TOLERANCE) {
        reasons.push(`Vendor-held stock went negative during the period (lowest: ${minVendorBalance.toFixed(3)})`)
      }
      let vendorMismatch = false
      if (vendorCheckApplies) {
        const vendorDiff = vendorClosingBalance - vendorExpected
        if (Math.abs(vendorDiff) > TOLERANCE) {
          vendorMismatch = true
          reasons.push(
            `Vendor balance from ledger (${vendorClosingBalance.toFixed(3)}) doesn't match job-work records (${vendorExpected.toFixed(3)})`
          )
        }
      }

      return {
        id,
        itemCode,
        itemName,
        unit,
        openingBalance,
        closingBalance,
        vendorOpeningBalance,
        vendorClosingBalance,
        vendorExpected: vendorCheckApplies ? vendorExpected : null,
        minBalance,
        minVendorBalance,
        txnCount,
        valid: reasons.length === 0,
        reasons,
        vendorMismatch,
      }
    })

    return NextResponse.json({ items, totalCount, offset, limit, hasMore: offset + items.length < totalCount })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reconciliation scan failed'
    console.error('[stock/reconcile-items]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
