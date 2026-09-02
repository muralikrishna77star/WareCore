import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff', 'sales_manager'])

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const dateRe = /^\d{4}-\d{2}-\d{2}$/

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!uuidRe.test(id)) return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 })

  const body = await request.json()
  const {
    invoice_number, dispatch_date, vehicle_number, driver_name, notes,
    company_id, warehouse_id, customer_id, sale_ref_id,
    status, total_quantity, total_amount,
    items,
  } = body

  if (!dispatch_date) return NextResponse.json({ error: 'dispatch_date is required' }, { status: 400 })
  if (!dateRe.test(dispatch_date)) return NextResponse.json({ error: 'dispatch_date must be YYYY-MM-DD' }, { status: 400 })
  if (!Array.isArray(items)) return NextResponse.json({ error: 'items must be an array' }, { status: 400 })

  const escape = (v: string | null | undefined) =>
    v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`

  const itemsJson = JSON.stringify(items)
  const escapedItems = itemsJson.replace(/'/g, "''")

  // total_quantity/total_amount land in an unquoted ::numeric slot — force
  // them through Number() so only a safe numeric literal can ever reach the
  // SQL string, not arbitrary attacker-controlled text.
  const totalQuantityNum = Number(total_quantity)
  const totalAmountNum = Number(total_amount)
  const safeTotalQuantity = Number.isFinite(totalQuantityNum) ? totalQuantityNum : 0
  const safeTotalAmount = Number.isFinite(totalAmountNum) ? totalAmountNum : 0

  const sql = `
    SELECT edit_dispatch_order(
      '${id}'::uuid,
      ${escape(invoice_number)}::text,
      '${dispatch_date}'::date,
      ${escape(vehicle_number)}::text,
      ${escape(driver_name)}::text,
      ${escape(notes)}::text,
      ${company_id && uuidRe.test(company_id) ? `'${company_id}'::uuid` : 'NULL::uuid'},
      ${warehouse_id && uuidRe.test(warehouse_id) ? `'${warehouse_id}'::uuid` : 'NULL::uuid'},
      ${customer_id && uuidRe.test(customer_id) ? `'${customer_id}'::uuid` : 'NULL::uuid'},
      ${escape(sale_ref_id)}::text,
      ${escape(status || 'active')}::text,
      ${safeTotalQuantity}::numeric,
      ${safeTotalAmount}::numeric,
      '${escapedItems}'::jsonb
    )
  `

  try {
    const result = await hasuraRunSql(sql)
    const json = JSON.parse(result?.result?.[1]?.[0] ?? '{}') as { success: boolean; error?: string }
    if (!json.success) return NextResponse.json({ error: json.error ?? 'Edit failed' }, { status: 400 })
    // edit_dispatch_order() doesn't know who's calling it — record the editor
    // as a separate statement rather than threading session.userId through
    // the function's signature.
    await hasuraRunSql(`UPDATE dispatch_orders SET updated_by = '${session.userId}' WHERE id = '${id}'::uuid`)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Edit failed'
    console.error('[dispatch-save-edit]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
