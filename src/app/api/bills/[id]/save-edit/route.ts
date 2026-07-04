import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraQuery, hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id: billId } = await params
  if (!UUID_RE.test(billId)) return NextResponse.json({ error: 'Invalid bill ID' }, { status: 400 })

  const body = await request.json()
  const { company_id, warehouse_id, supplier_id, bill_number, bill_date, notes, free_item_ids, new_items } = body

  // Validate bill is active
  const check = await hasuraQuery(
    `query CheckBill($id: uuid!) { purchase_bills_by_pk(id: $id) { status } }`,
    { id: billId }
  )
  const bill = (check as any).purchase_bills_by_pk
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  if (bill.status !== 'active') return NextResponse.json({ error: 'Only active bills can be edited this way' }, { status: 400 })

  // Delete the free items being removed/replaced (must be valid UUIDs). The
  // tr_bill_item_deleted trigger fires PURCHASE_CANCEL for each row automatically —
  // do not also call reverse_purchase_item() here, or the reversal is double-counted.
  const validFreeIds: string[] = (free_item_ids ?? []).filter((id: unknown) => typeof id === 'string' && UUID_RE.test(id))
  if (validFreeIds.length) {
    const idList = validFreeIds.map(id => `'${id}'`).join(',')
    await hasuraRunSql(`DELETE FROM purchase_bill_items WHERE id IN (${idList}) AND bill_id = '${billId}'`)
  }

  // Update bill header
  await hasuraQuery(
    `mutation UpdateBillHeader($id: uuid!, $company_id: uuid, $warehouse_id: uuid, $supplier_id: uuid, $bill_number: String!, $bill_date: date!, $notes: String) {
      update_purchase_bills_by_pk(pk_columns: {id: $id}, _set: {
        company_id: $company_id, warehouse_id: $warehouse_id, supplier_id: $supplier_id,
        bill_number: $bill_number, bill_date: $bill_date, notes: $notes
      }) { id }
    }`,
    {
      id: billId,
      company_id: company_id || null, warehouse_id: warehouse_id || null,
      supplier_id: supplier_id || null, bill_number, bill_date,
      notes: notes || null,
    }
  )

  // Insert new free items (fn_bill_item_to_ledger trigger fires PURCHASE_IN for each)
  if (new_items?.length) {
    await hasuraQuery(
      `mutation InsertItems($objects: [purchase_bill_items_insert_input!]!) {
        insert_purchase_bill_items(objects: $objects) { affected_rows }
      }`,
      { objects: new_items.map((item: any) => ({ ...item, bill_id: billId })) }
    )
  }

  return NextResponse.json({ success: true })
}
