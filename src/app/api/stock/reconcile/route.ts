import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])

// Direct SQL using a CTE so we get the inserted row count back.
// Uses FILTER(WHERE entry_type='PURCHASE_IN') for metadata columns so
// company/warehouse/material always come from the original purchase entry.
// HAVING guards prevent NULL violations on stock_ledger NOT NULL columns.
const RECONCILE_SQL = `
WITH inserted AS (
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, purchase_line_id
  )
  SELECT
    'PURCHASE_CANCEL',
    company_id, warehouse_id, material_type_id, material_size_id, size_label,
    -net_qty,
    'purchase_bill', reference_id, COALESCE(reference_number, 'RECONCILE'),
    'Stock reconciliation - phantom entry correction',
    CURRENT_DATE,
    purchase_line_id
  FROM (
    SELECT
      sl.purchase_line_id,
      SUM(sl.quantity) AS net_qty,
      MAX(sl.company_id)       FILTER (WHERE sl.entry_type = 'PURCHASE_IN') AS company_id,
      MAX(sl.warehouse_id)     FILTER (WHERE sl.entry_type = 'PURCHASE_IN') AS warehouse_id,
      MAX(sl.material_type_id) FILTER (WHERE sl.entry_type = 'PURCHASE_IN') AS material_type_id,
      MAX(sl.material_size_id) FILTER (WHERE sl.entry_type = 'PURCHASE_IN') AS material_size_id,
      MAX(sl.size_label)       FILTER (WHERE sl.entry_type = 'PURCHASE_IN') AS size_label,
      MAX(sl.reference_id)     FILTER (WHERE sl.entry_type = 'PURCHASE_IN') AS reference_id,
      MAX(sl.reference_number) FILTER (WHERE sl.entry_type = 'PURCHASE_IN') AS reference_number
    FROM stock_ledger sl
    WHERE sl.purchase_line_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM purchase_bill_items pbi
        WHERE pbi.purchase_line_id = sl.purchase_line_id
      )
    GROUP BY sl.purchase_line_id
    HAVING SUM(sl.quantity) > 0
      AND MAX(sl.company_id)       FILTER (WHERE sl.entry_type = 'PURCHASE_IN') IS NOT NULL
      AND MAX(sl.warehouse_id)     FILTER (WHERE sl.entry_type = 'PURCHASE_IN') IS NOT NULL
      AND MAX(sl.material_type_id) FILTER (WHERE sl.entry_type = 'PURCHASE_IN') IS NOT NULL
  ) phantoms
  RETURNING id
)
SELECT COUNT(*) AS count FROM inserted
`

export async function POST(request: NextRequest) {
  try {
    const session = await verifySessionCookie(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const result = await hasuraRunSql(RECONCILE_SQL)
    const count = Number(result?.result?.[1]?.[0] ?? 0)
    return NextResponse.json({ success: true, reconciled: count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reconciliation failed'
    console.error('[reconcile]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
